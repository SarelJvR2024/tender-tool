"""
Bridge between the web app's tender_engine_jobs table (migration
0018_general_tender_preparation.sql) and the general (non-SANRAL) engine:
engine/general/requirements.py (what does this tender need?) and
engine/general/build_general_pack.py (fill the forms, merge the pack).

Same shape as engine/cv/process_cv_jobs.py and the SANRAL
engine/pack/process_pack_jobs.py, deliberately: the Tender Workspace only
inserts a 'requested' row (Vercel can't run Python or LibreOffice); this
script claims it (requested -> generating, conditional on it still being
'requested', so two workers never take the same job) and fulfils it:

  extract_requirements
    1. downloads the tender's published documents (tenders.document_urls -
       the buyer's own eTenders links, public and unauthenticated);
    2. runs requirements.extract_requirements() over them;
    3. stores the manifest on tenders.document_requirements, and the
       experience-evidence / locality rules on tenders.evaluation_rules (only
       when that is empty or was carried over from the discovery outlook -
       a rule seeded from the full document by
       engine/seed_tender_evaluation_rules.py is never overwritten).

  generate_pack
    1. reads the tender + manifest, the company row (vault), this tender's
       answers and uploads (tender_answers), the chosen signatory (people),
       the Experience Library items the tender's own rule accepts, and the
       newest CV of each person tagged for a role the tender names;
    2. downloads the files those rows point at from Storage;
    3. calls build_general_pack.build_general_pack();
    4. refuses to mark the job ready unless pdf_merge.verify_pack() reads the
       merged PDF back cleanly (page count, stamps, contents entries,
       bookmarks);
    5. uploads the PDF + filled .docx forms + completion guide + provenance to
       'submission-packs' under <company_id>/tenders/<tender_id>/<job_id>/,
       writes the provenance to field_provenance (so the Tender Workspace's
       readiness report shows what was filled / assumed / left for a human),
       and marks the job ready with the pack manifest.

CLI contract (engine/worker/run_bridges.py drives it as the 'general' bridge):
    python3 engine/general/process_general_jobs.py [--once | --loop [--interval S] [--max-cycles N]] [--work-dir DIR]
Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (service role).

engine/general/test_general_bridge.py runs this end to end against an
in-memory fake of the Supabase REST/Storage API with real tender documents -
no live project exists in this environment.
"""
import argparse
import datetime
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.abspath(os.path.join(HERE, ".."))
for p in (HERE, ENGINE_DIR, os.path.join(ENGINE_DIR, "worker")):
    if p not in sys.path:
        sys.path.insert(0, p)

import requirements as req  # noqa: E402
import build_general_pack as bgp  # noqa: E402

DEFAULT_WORK_DIR = os.path.join(ENGINE_DIR, "..", "out", "general_jobs")
PACK_BUCKET = "submission-packs"
VAULT_BUCKET = "company-documents"
CV_BUCKET = "cv-documents"
EXPERIENCE_BUCKET = "experience-documents"

# experience_items.document_type values per evidence code - the same table as
# app/lib/experienceEvidence.ts DOC_TYPES_FOR. Award letters are kept when a
# tender wants appointment AND completion proof (they ARE the appointment).
DOC_TYPES_FOR = {
    "performance_report": ["performance_report"],
    "reference_letter": ["reference_letter"],
    "completion_certificate": ["completion_certificate", "closeout_report"],
    "award_letter": ["award_letter"],
    "affidavit": [],
}

VAULT_COLUMNS = ["sars_tcs_pin_document_path", "bee_proof_document_path", "coid_letter_document_path",
                 "bank_confirmation_letter_path", "pi_insurance_document_path"]


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


class Supabase:
    """The slice of PostgREST + Storage this bridge needs, over urllib (same
    env vars and service-role bypass as every other engine/ writer)."""

    def __init__(self, url, key):
        self.url, self.key = url.rstrip("/"), key

    def _req(self, method, path, body=None, headers=None, raw=None):
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}"}
        h.update(headers or {})
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        if data is not None and "Content-Type" not in h:
            h["Content-Type"] = "application/json"
        r = urllib.request.Request(self.url + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(r, timeout=120) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path.split('?')[0]} failed: {e.code} {e.read().decode(errors='replace')[:300]}")

    @staticmethod
    def _q(filters, extra=None):
        parts = [f"{k}=eq.{urllib.parse.quote(str(v), safe='')}" for k, v in (filters or {}).items()]
        parts += extra or []
        return ("?" + "&".join(parts)) if parts else ""

    def select(self, table, filters=None, order=None):
        extra = ["select=*"] + ([f"order={order}"] if order else [])
        out = self._req("GET", f"/rest/v1/{table}{self._q(filters, extra)}")
        return json.loads(out) if out else []

    def update(self, table, filters, body):
        out = self._req("PATCH", f"/rest/v1/{table}{self._q(filters)}", body, {"Prefer": "return=representation"})
        return json.loads(out) if out else []

    def upsert(self, table, rows, on_conflict):
        out = self._req("POST", f"/rest/v1/{table}?on_conflict={on_conflict}", rows,
                        {"Prefer": "return=representation,resolution=merge-duplicates"})
        return json.loads(out) if out else []

    def download(self, bucket, path, dest):
        data = self._req("GET", f"/storage/v1/object/{bucket}/{urllib.parse.quote(path)}")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(data)
        return dest

    def upload(self, bucket, path, local, content_type):
        with open(local, "rb") as f:
            self._req("POST", f"/storage/v1/object/{bucket}/{urllib.parse.quote(path)}", raw=f.read(),
                      headers={"Content-Type": content_type, "x-upsert": "true"})


# ---------------------------------------------------------------------------
# Tender documents
# ---------------------------------------------------------------------------

def download_tender_documents(tender, dest_dir, fetch=None):
    """Downloads each tenders.document_urls entry once (cached per tender).
    Returns (paths, notes). A link that fails is noted, not fatal - one bad
    link must not hide the rest (same rule as assess_tender.fetch_pdf_text)."""
    os.makedirs(dest_dir, exist_ok=True)
    fetch = fetch or _http_get
    paths, notes = [], []
    for i, d in enumerate(tender.get("document_urls") or []):
        url = d.get("url")
        if not url:
            continue
        title = d.get("title") or f"document_{i}"
        name = re.sub(r"[^A-Za-z0-9._ ()-]+", "_", title)[:120] or f"document_{i}"
        if "." not in name[-6:]:
            name += ".pdf"
        dest = os.path.join(dest_dir, name)
        if not os.path.exists(dest):
            try:
                data = fetch(url)
                with open(dest, "wb") as f:
                    f.write(data)
            except Exception as e:
                notes.append(f"{title}: download failed ({e})")
                continue
        paths.append(dest)
    return paths, notes


def _http_get(url):
    r = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (tender-tool general engine)"})
    with urllib.request.urlopen(r, timeout=90) as resp:
        return resp.read()


def run_extraction(client, job, work_root, fetch=None):
    tender = client.select("tenders", {"id": job["tender_id"]})[0]
    work = os.path.join(work_root, "tenders", tender["id"])
    docs_dir = os.path.join(work, "docs")
    paths, notes = download_tender_documents(tender, docs_dir, fetch)
    if not paths:
        raise RuntimeError("No tender documents could be downloaded" + (": " + "; ".join(notes) if notes else " - no document links on file."))
    scratch = os.path.join(work, "extract")
    shutil.rmtree(scratch, ignore_errors=True)
    manifest = req.extract_requirements([docs_dir], work_dir=scratch, source_label=tender.get("ocid") or tender.get("slug"))
    clean = req.strip_local(manifest)
    if notes:
        clean["gaps"] = clean.get("gaps", []) + [f"Couldn't download: {n}" for n in notes]
    patch = {"document_requirements": clean}
    existing = tender.get("evaluation_rules") or {}
    if not existing or str(existing.get("source_document", "")).startswith("discovery outlook"):
        patch["evaluation_rules"] = {
            "experience_evidence": clean["experience_evidence"],
            "locality": clean["locality"],
            "source_document": "; ".join(sorted({d["name"] for d in clean["documents"] if d["chars"] > 0}))[:500],
            "extracted_at": clean["extracted_at"],
        }
    client.update("tenders", {"id": tender["id"]}, patch)
    return {"forms": len(clean["forms"]), "returnables": len(clean["returnables"]), "questions": len(clean["questions"])}


# ---------------------------------------------------------------------------
# Pack
# ---------------------------------------------------------------------------

def _within(item, rule, closing):
    comp = item.get("completion_date")
    if rule.get("since_year") and (not comp or int(comp[:4]) < int(rule["since_year"])):
        return False
    if rule.get("window_years"):
        if not comp:
            return False
        ref = datetime.date.fromisoformat((closing or _now())[:10])
        if datetime.date.fromisoformat(comp[:10]) < ref.replace(year=ref.year - int(rule["window_years"])):
            return False
    return True


def gather_pack_inputs(client, job, tender, manifest, work):
    company = client.select("companies", {"id": job["company_id"]})[0]
    answer_rows = client.select("tender_answers", {"company_id": job["company_id"], "tender_id": tender["id"]})
    answers = {a["field_key"]: a["value"] for a in answer_rows if a.get("value") is not None}
    files_dir = os.path.join(work, "files")
    files = {}
    for col in VAULT_COLUMNS:
        if company.get(col):
            files["vault:" + col] = client.download(VAULT_BUCKET, company[col], os.path.join(files_dir, "vault", os.path.basename(company[col])))
    for a in answer_rows:
        if a.get("storage_path") and a["field_key"].startswith("upload:"):
            files[a["field_key"]] = client.download(VAULT_BUCKET, a["storage_path"], os.path.join(files_dir, "uploads", os.path.basename(a["storage_path"])))

    signatory = None
    sid = answers.get("signatory_person_id")
    if sid:
        ppl = client.select("people", {"id": sid, "company_id": job["company_id"]})
        if ppl:
            signatory = {"name": ppl[0]["name"], "capacity": ppl[0].get("signatory_capacity") or ppl[0].get("role")}

    # experience the tender's own rule accepts (never SANRAL's B6 by default)
    evidence = []
    rules = (tender.get("evaluation_rules") or {}).get("experience_evidence", {}).get("rules") or manifest["experience_evidence"].get("rules") or []
    if rules:
        rule = rules[0]
        accepted = {t for e in rule.get("accepted_evidence", []) for t in DOC_TYPES_FOR.get(e, [])}
        items = [i for i in client.select("experience_items", {"company_id": job["company_id"]}, order="completion_date.desc")
                 if i.get("tagged_at") and i.get("document_type") in accepted and _within(i, rule, tender.get("closing_date"))]
        for i in items[:max(int(rule.get("projects_required") or 5), 1) + 2]:
            title = f"{i['project_name']} ({i['document_type'].replace('_', ' ')})"
            if i.get("storage_path"):
                evidence.append({"title": title, "path": client.download(EXPERIENCE_BUCKET, i["storage_path"],
                                                                        os.path.join(files_dir, "experience", os.path.basename(i["storage_path"])))})
            else:
                evidence.append({"title": title, "path": None, "missing_reason": "captured without a document - upload it in the Experience Library"})

    # CVs of people tagged for the roles the tender names
    cvs = []
    for role in manifest.get("roles", []):
        for tag in client.select("person_role_eligibility", {"company_id": job["company_id"], "role_code": role["role_code"]}):
            person = (client.select("people", {"id": tag["person_id"]}) or [{}])[0]
            gen = [g for g in client.select("generated_cvs", {"person_id": tag["person_id"], "status": "ready"}, order="requested_at.desc")
                   if g.get("storage_path_pdf")]
            up = client.select("cv_uploads", {"person_id": tag["person_id"]}, order="created_at.desc")
            title = f"CV - {person.get('name', 'unknown')} ({role['role_code'].split('.', 1)[-1].replace('_', ' ')})"
            if any(c["title"] == title for c in cvs):
                continue
            src = (CV_BUCKET, gen[0]["storage_path_pdf"]) if gen else ((CV_BUCKET, up[0]["storage_path"]) if up else None)
            if src:
                cvs.append({"title": title, "path": client.download(src[0], src[1], os.path.join(files_dir, "cvs", os.path.basename(src[1])))})
            else:
                cvs.append({"title": title, "path": None, "missing_reason": "no CV uploaded or generated for this person"})
    return company, answers, files, signatory, evidence, cvs


def run_pack(client, job, work_root, fetch=None):
    tender = client.select("tenders", {"id": job["tender_id"]})[0]
    manifest = tender.get("document_requirements")
    if not manifest:
        raise RuntimeError("This tender's documents haven't been read yet - run 'Read this tender's documents' first.")
    work = os.path.join(work_root, "packs", job["id"])
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    paths, _ = download_tender_documents(tender, os.path.join(work_root, "tenders", tender["id"], "docs"), fetch)
    docs_dir = os.path.join(work_root, "tenders", tender["id"], "docs")
    local = bgp.local_docs_for(manifest, [docs_dir] if paths else [], os.path.join(work, "src"))
    company, answers, files, signatory, evidence, cvs = gather_pack_inputs(client, job, tender, manifest, work)
    out_pdf = os.path.join(work, "submission_pack.pdf")
    res = bgp.build_general_pack(
        manifest=manifest, local_docs=local, company=company, signatory=signatory, answers=answers,
        tender={"contract_no": tender.get("contract_no"), "buyer": tender.get("buyer"), "description": tender.get("description"),
                "closing_date": tender.get("closing_date")},
        files=files, work_dir=work, out_pdf=out_pdf, evidence_items=evidence, cvs=cvs)
    pm = res["manifest"]
    if pm["verify_problems"]:
        raise RuntimeError("Pack failed its read-back check: " + "; ".join(pm["verify_problems"][:5]))

    prefix = f"{job['company_id']}/tenders/{tender['id']}/{job['id']}"
    pdf_path = f"{prefix}/submission_pack.pdf"
    client.upload(PACK_BUCKET, pdf_path, out_pdf, "application/pdf")
    output_files = {}
    for name, local_path in res["outputs"].items():
        ct = "application/json" if name.endswith(".json") else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        client.upload(PACK_BUCKET, f"{prefix}/{name}", local_path, ct)
        output_files[name] = f"{prefix}/{name}"

    if job.get("tender_pack_id") and res["provenance"]:
        seen = {}
        for e in res["provenance"]:
            seen[e["field_key"]] = e  # last write wins (a field filled in two documents)
        client.upsert("field_provenance", [{"tender_pack_id": job["tender_pack_id"], **{k: e[k] for k in ("field_key", "status", "value", "reason", "source")}}
                                          for e in seen.values()], "tender_pack_id,field_key")
    return {"storage_path_pdf": pdf_path, "output_files": output_files, "page_count": pm["page_count"],
            "manifest": {k: pm[k] for k in ("sections", "omitted", "by_hand", "form_results", "provenance_summary", "contents_pages")}}


# ---------------------------------------------------------------------------
# Job loop
# ---------------------------------------------------------------------------

def process_job(client, job, work_root, fetch=None):
    claimed = client.update("tender_engine_jobs", {"id": job["id"], "status": "requested"},
                            {"status": "generating", "started_at": _now()})
    if not claimed:
        return False  # another worker took it
    try:
        if job["kind"] == "extract_requirements":
            summary = run_extraction(client, job, work_root, fetch)
            client.update("tender_engine_jobs", {"id": job["id"]}, {"status": "ready", "completed_at": _now()})
            print(f"[ready] extract {job['id']}: {summary}")
        elif job["kind"] == "generate_pack":
            result = run_pack(client, job, work_root, fetch)
            client.update("tender_engine_jobs", {"id": job["id"]}, {"status": "ready", "completed_at": _now(), **result})
            print(f"[ready] pack {job['id']}: {result['page_count']} pages -> {result['storage_path_pdf']}")
        else:
            raise RuntimeError(f"unknown job kind {job['kind']}")
    except Exception as e:
        client.update("tender_engine_jobs", {"id": job["id"]}, {"status": "failed", "error_message": str(e)[:1000], "completed_at": _now()})
        print(f"[failed] {job['kind']} {job['id']}: {e}")
    return True


def poll_once(client, work_root, fetch=None):
    jobs = client.select("tender_engine_jobs", {"engine": "general", "status": "requested"}, order="requested_at.asc")
    if not jobs:
        print("No pending general engine jobs.")
        return 0
    n = 0
    for job in sorted(jobs, key=lambda j: (j["kind"] != "extract_requirements", j.get("requested_at") or "")):
        n += 1 if process_job(client, job, work_root, fetch) else 0
    return n


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="process whatever is queued, then exit (the default)")
    mode.add_argument("--loop", "--daemon", dest="loop", action="store_true", help="keep polling until stopped")
    ap.add_argument("--interval", type=int, default=30)
    ap.add_argument("--max-cycles", type=int, default=None)
    ap.add_argument("--work-dir", default=DEFAULT_WORK_DIR)
    args = ap.parse_args(argv)
    url, key = os.environ.get("NEXT_PUBLIC_SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this.")
        return 1
    client = Supabase(url, key)
    work = os.path.abspath(args.work_dir)
    if not args.loop:
        poll_once(client, work)
        return 0
    from poll_loop import poll_forever
    poll_forever(lambda: poll_once(client, work), interval=args.interval, max_cycles=args.max_cycles, name="general")
    return 0


if __name__ == "__main__":
    sys.exit(main())
