"""
Stream 4 (discovery): the daily run.

Design choice, stated plainly rather than buried in code: this does NOT
resubmit the personal-data download form for all ~137 open tenders every
single day. It fetches the cheap, PII-free list + detail metadata for
every open tender daily (that's free - no form, no identity data), diffs
it against yesterday's snapshot, and only touches the identity-gated
download form for tenders that are NEW since the last run or whose pack
CHANGED (last_updated/file_size/file_count differ). That still means a new
tender is caught the same day it appears - "as soon as possible" - without
submitting Sarel's name/company/phone/email to SANRAL ~137 times a day
forever for packs that haven't changed since yesterday.

Pipeline per run:
  1. list_tenders.fetch_tenders()      - full list, all open tenders
  2. detail.fetch_detail(slug) each    - file size/count/last-updated
  3. diff against state/discovery_state.json (previous run)
  4. for each new/changed tender: download_documents.download_one()
  5. unzip each downloaded pack into its own fresh directory
  6. fingerprint.py every .xlsm found inside (Stream 1 - never silent)
  7. write the new state snapshot + a run report

Identity (fullname/company/phone/email) is read from --contact-file, a
local JSON file that is NOT committed to the repo (see .gitignore) - never
pass it on the command line in a way that lands in shell history/logs any
more than necessary, and never hardcode it into this script.

Usage:
    python3 run_discovery.py --contact-file ../config/contact.json \
        --state-dir ../state --incoming-dir ../templates/incoming
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import detail as detail_mod
import list_tenders as list_mod

HERE = os.path.dirname(os.path.abspath(__file__))


def load_state(state_dir):
    path = os.path.join(state_dir, "discovery_state.json")
    if os.path.exists(path):
        return json.load(open(path)), path
    return {}, path


def save_state(path, state):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(state, open(path, "w"), indent=2, sort_keys=True)


def changed(prev_entry, detail_entry):
    if prev_entry is None:
        return "new"
    for field in ("file_size", "file_count", "last_updated"):
        if prev_entry.get(field) != detail_entry.get(field):
            return f"changed ({field}: {prev_entry.get(field)!r} -> {detail_entry.get(field)!r})"
    return None


def unzip_and_fingerprint(saved_path, incoming_dir, slug, fingerprint_store):
    extract_dir = os.path.join(incoming_dir, slug, datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    os.makedirs(extract_dir, exist_ok=True)
    report = {"extract_dir": extract_dir, "workbooks": []}

    if zipfile.is_zipfile(saved_path):
        with zipfile.ZipFile(saved_path) as z:
            z.extractall(extract_dir)
    else:
        shutil.copy(saved_path, extract_dir)

    for root, _, files in os.walk(extract_dir):
        for fname in files:
            if fname.lower().endswith(".xlsm"):
                fpath = os.path.join(root, fname)
                proc = subprocess.run(
                    [sys.executable, os.path.join(HERE, "..", "fingerprint.py"),
                     fpath, "--store", fingerprint_store],
                    capture_output=True, text=True,
                )
                report["workbooks"].append({
                    "file": fpath, "returncode": proc.returncode,
                    "stdout": proc.stdout.strip(), "stderr": proc.stderr.strip(),
                })
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--contact-file", required=True,
                     help="local JSON file with fullname/company/phone/email - never committed")
    ap.add_argument("--state-dir", default=os.path.join(HERE, "..", "..", "state"))
    ap.add_argument("--incoming-dir", default=os.path.join(HERE, "..", "..", "templates", "incoming"))
    ap.add_argument("--fingerprint-store", default=os.path.join(HERE, "..", "..", "fingerprints"))
    ap.add_argument("--dry-run", action="store_true",
                     help="report what would be downloaded, without touching the download form")
    args = ap.parse_args()

    contact = json.load(open(args.contact_file))
    for field in ("fullname", "company", "phone", "email"):
        if not contact.get(field):
            sys.exit(f"--contact-file is missing required field: {field}")

    state, state_path = load_state(args.state_dir)
    rows, total, total_filtered = list_mod.fetch_tenders(page_size=200)
    print(f"[{datetime.now(timezone.utc).isoformat()}] {len(rows)} open tenders "
          f"(total_filtered={total_filtered})", file=sys.stderr)

    new_state = {}
    to_download = []
    for row in rows:
        slug = row["slug"]
        if not slug:
            continue
        try:
            d = detail_mod.fetch_detail(slug)
        except Exception as e:
            print(f"  {slug}: detail fetch FAILED - {e}", file=sys.stderr)
            continue
        entry = {**row, **d}
        prev = state.get(slug)
        reason = changed(prev, d)
        if reason:
            to_download.append((slug, reason))
        new_state[slug] = entry

    print(f"{len(to_download)} tender(s) new or changed, out of {len(new_state)} open", file=sys.stderr)
    for slug, reason in to_download:
        print(f"  -> {slug}: {reason}", file=sys.stderr)

    results = []
    if not args.dry_run and to_download:
        from download_documents import sync_playwright, download_one
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                page = browser.new_page(accept_downloads=True)
                for slug, reason in to_download:
                    try:
                        r = download_one(page, slug, contact["fullname"], contact["company"],
                                          contact["phone"], contact["email"], args.incoming_dir)
                    except Exception as e:
                        r = {"slug": slug, "success": False, "error": str(e)}
                    r["reason"] = reason
                    if r["success"]:
                        r["fingerprint_report"] = unzip_and_fingerprint(
                            r["saved_path"], args.incoming_dir, slug, args.fingerprint_store)
                    results.append(r)
                    print(f"  {slug}: {'OK' if r['success'] else 'FAILED - ' + str(r.get('error'))[:200]}",
                          file=sys.stderr)
            finally:
                browser.close()
    elif to_download:
        print("(--dry-run: not touching the download form)", file=sys.stderr)

    save_state(state_path, new_state)

    report = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "total_open_tenders": len(new_state),
        "new_or_changed": [{"slug": s, "reason": r} for s, r in to_download],
        "download_results": results,
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
