"""
Bridge for spec item 31 (admin review console): runs admin_harness.py's existing
logic and upserts one row per (test_company, tender_ref, kind) into the web
app's admin_harness_runs table (app/supabase/migrations/0005_admin_harness_results.sql,
renamed by 0006, extended by 0022_admin_harness_review.sql), so Sarel can see
harness results - and the documents each run actually generated - at /admin
instead of only in a terminal.

Deliberately imports and calls admin_harness.main() directly rather than shelling
out to it - its main() is already a plain function that returns a clean
{"clean": [...], "flagged": [...], "failed": [...]} structure (each entry a
(run_key, message) tuple, run_key = "<test_company>__<tender_slug>"), plus a
"pack" entry of the same shape with --pack, so no refactoring of
admin_harness.py was needed to reuse it.

Two kinds of row (0022's `kind` column):
  - forms: admin_harness.py's form-fill check. Its documents are the filled
    C.1.1.1 / C.1.2.3 / A-Forms .docx files in admin_harness.RUN_OUT_DIR/<run_key>/;
    each is converted to PDF (LibreOffice, one soffice call per run) so the
    console can show it inline. Without LibreOffice the .docx is uploaded as-is
    and the console offers it as a download instead.
  - pack (--pack only): the merged submission-pack PDF from
    admin_harness.PACK_RUN_OUT_DIR/<run_key>/pack/. A pack refused by the real
    gates (e.g. new_co) has no PDF; the row says why.
Generated documents go to the private 'admin-harness-artifacts' bucket at
"<kind>/<test_company>/<tender_ref>/<file>" and are listed in the row's
`artifacts` column. Only files written by THIS invocation are uploaded (mtime
check), so a leftover from an earlier run can never be shown as this run's
output. A failed run gets no artifacts.

The per-run summary is read back from admin_harness.py's own baseline JSON files
(state/admin_harness_baselines/ and state/admin_harness_pack_baselines/) - the
one place that shape is already persisted - rather than recomputing it here.

Reviews: the console's "mark reviewed" lives on the same row. A re-run with the
same result keeps the review; a different result clears it (0022's trigger, in
the database, so this script needs no review logic of its own).

Connection pattern (urllib + REST upsert via Prefer: resolution=merge-duplicates)
copied from engine/seed_supabase_company.py. Requires the same env vars:
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

Usage: python3 write_admin_harness_results.py [--reset] [--pack] [--pack-tenders SLUG,...|all]
"""
import os
import sys
import glob
import json
import time
import argparse
import subprocess
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone

import admin_harness

HERE = os.path.dirname(os.path.abspath(__file__))
BUCKET = "admin-harness-artifacts"
PDF = "application/pdf"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
FORMS_DOCS = [  # (file written by admin_harness.run_one, label shown in the console)
    ("A_Forms_FILLED.docx", "A-Forms bundle"),
    ("C.1.1.1_Form_of_Offer_FILLED.docx", "C.1.1.1 Form of Offer"),
    ("C.1.2.3_Contract_Data_FILLED.docx", "C.1.2.3 Contract Data"),
]


class SupabaseRest:
    def __init__(self, url, service_key):
        self.url, self.key = url.rstrip("/"), service_key

    def _req(self, method, path, body=None, headers=None, raw=None):
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}"}
        h.update(headers or {})
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        if data is not None and "Content-Type" not in h:
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path.split('?')[0]} failed: {e.code} {e.read().decode(errors='replace')[:300]}")

    def upsert(self, table, rows, on_conflict):
        # on_conflict is required: without it PostgREST resolves on the primary
        # key (id), which these rows never carry, so a second run would hit the
        # unique constraint instead of updating.
        self._req("POST", f"/rest/v1/{table}?on_conflict={on_conflict}", rows,
                  {"Prefer": "return=minimal,resolution=merge-duplicates"})

    def upload(self, bucket, path, local, content_type):
        with open(local, "rb") as f:
            self._req("POST", f"/storage/v1/object/{bucket}/{urllib.parse.quote(path)}", raw=f.read(),
                      headers={"Content-Type": content_type, "x-upsert": "true"})


def run_key_parts(run_key):
    # run_key is "<test_company>__<tender_slug>" - admin_harness.py's own format.
    test_company, _, tender_ref = run_key.partition("__")
    return test_company, tender_ref


def summary_for(run_key, store_dir):
    baseline_path = os.path.join(store_dir, f"{run_key}.json")
    if os.path.exists(baseline_path):
        return json.load(open(baseline_path))
    return {}


def _fresh(path, since):
    return os.path.exists(path) and os.path.getmtime(path) >= since


def forms_documents(run_key, since):
    """[(local_path, label, content_type)] for one form-fill run: each filled
    .docx as a PDF, or the .docx itself if LibreOffice isn't available."""
    out_dir = os.path.join(admin_harness.RUN_OUT_DIR, run_key)
    docs = [(os.path.join(out_dir, f), label) for f, label in FORMS_DOCS if _fresh(os.path.join(out_dir, f), since)]
    if not docs:
        return []
    preview_dir = os.path.join(out_dir, "preview")
    os.makedirs(preview_dir, exist_ok=True)
    # A private LibreOffice profile: a soffice already running elsewhere on the
    # host (another bridge, a harness run) otherwise makes this call fail. One
    # retry, because the very first start of a fresh profile can also fail.
    cmd = ["soffice", f"-env:UserInstallation=file://{os.path.join(admin_harness.RUN_OUT_DIR, '.lo_profile')}",
           "--headless", "--convert-to", "pdf", "--outdir", preview_dir] + [d for d, _ in docs]
    for attempt in (1, 2):
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=300)
            break
        except Exception as e:
            if attempt == 2:
                print(f"  WARNING {run_key}: PDF preview conversion failed ({e}) - uploading the .docx files instead")
    out = []
    for docx, label in docs:
        pdf = os.path.join(preview_dir, os.path.basename(docx)[:-len(".docx")] + ".pdf")
        out.append((pdf, label, PDF) if _fresh(pdf, since) else (docx, label + " (.docx)", DOCX))
    return out


def pack_documents(run_key, since):
    pdfs = [p for p in glob.glob(os.path.join(admin_harness.PACK_RUN_OUT_DIR, run_key, "pack", "*_Submission_Pack.pdf"))
            if _fresh(p, since)]
    return [(p, "Submission pack (merged PDF)", PDF) for p in pdfs]


def build_rows(result, kind, store_dir, since, upload):
    """One admin_harness_runs row per run in `result`, uploading each run's
    documents through upload(bucket_path, local_path, content_type)."""
    now = datetime.now(timezone.utc).isoformat()
    documents = forms_documents if kind == "forms" else pack_documents
    rows = []
    for status, entries in (("ok", result["clean"]), ("flagged", result["flagged"]), ("failed", result["failed"])):
        for run_key, msg in entries:
            test_company, tender_ref = run_key_parts(run_key)
            artifacts = []
            if status != "failed":
                for local, label, ctype in documents(run_key, since):
                    path = f"{kind}/{test_company}/{tender_ref}/{os.path.basename(local)}"
                    upload(path, local, ctype)
                    artifacts.append({"label": label, "path": path, "content_type": ctype})
            rows.append({
                "test_company": test_company,
                "tender_ref": tender_ref,
                "kind": kind,
                # Run failures (exceptions, not shape mismatches) still get a
                # visible row - better Sarel sees "RUN FAILED" than nothing.
                "status": "flagged" if status == "failed" else status,
                "summary": {} if status == "failed" else summary_for(run_key, store_dir),
                "details": f"RUN FAILED: {msg}" if status == "failed" else msg,
                "artifacts": artifacts,
                "run_at": now,
            })
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reset", action="store_true", help="wipe stored baselines and start fresh")
    ap.add_argument("--pack", action="store_true", help="also run and record the submission-pack check (needs LibreOffice)")
    ap.add_argument("--pack-tenders", help="comma-separated tender slugs, or 'all'")
    args = ap.parse_args()

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
              "(see app/.env.local.example) before running this.")
        sys.exit(1)
    client = SupabaseRest(url, key)

    since = time.time() - 1
    result = admin_harness.main(reset=args.reset, pack=args.pack, pack_tenders=args.pack_tenders)
    upload = lambda path, local, ctype: client.upload(BUCKET, path, local, ctype)  # noqa: E731
    rows = build_rows(result, "forms", admin_harness.DEFAULT_STORE, since, upload)
    if result.get("pack"):
        rows += build_rows(result["pack"], "pack", admin_harness.DEFAULT_PACK_STORE, since, upload)

    if not rows:
        print("No harness rows to write (no test company profiles found).")
        return

    print(f"Upserting {len(rows)} admin_harness_runs rows "
          f"({sum(len(r['artifacts']) for r in rows)} documents uploaded)...")
    client.upsert("admin_harness_runs", rows, "test_company,tender_ref,kind")
    print("Done.")


if __name__ == "__main__":
    main()
