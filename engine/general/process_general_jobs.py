"""
Bridge between the web app's job queue - pack_generation_jobs rows with
engine = 'general' (migration 0018 created a separate tender_engine_jobs
table; the unified-queue migration folded it into pack_generation_jobs and
left tender_engine_jobs as a compatibility view) - and the general
(non-SANRAL) engine:
engine/general/requirements.py (what does this tender need?) and
engine/general/build_general_pack.py (fill the forms, merge the pack).

Same shape as engine/cv/process_cv_jobs.py and the SANRAL
engine/pack/process_pack_jobs.py, deliberately: the Tender Workspace only
inserts a 'requested' row (Vercel can't run Python or LibreOffice); this
script claims it (requested -> generating, conditional on it still being
'requested', so two workers never take the same job) and fulfils it:

  extract_requirements
    1. downloads the tender's published documents (tenders.document_urls -
       the buyer's own eTenders links, public and unauthenticated), plus, on a
       shared tender, the requesting company's own private documents
       (tender_private_documents, 0032 - read into a per-company folder, and
       the result stored on that company's tender_packs row only);
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
sys.path.insert(0, os.path.join(ENGINE_DIR, "intake"))
import classify_tender as intake  # noqa: E402
sys.path.insert(0, os.path.join(ENGINE_DIR, "alerts"))
import system_alerts  # noqa: E402


class JobRefusal(RuntimeError):
    """The bridge refusing a job on purpose, with a message the user can act
    on (no readable documents, wrong engine, not read yet...). Recorded in
    system_alerts as a warning, not an error: the product working as meant,
    but worth a look because a refusal can hide a real bug."""

DEFAULT_WORK_DIR = os.path.join(ENGINE_DIR, "..", "out", "general_jobs")
JOBS_TABLE = "pack_generation_jobs"  # one queue for every engine; ours are engine = 'general'
ENGINE = "general"
PACK_BUCKET = "submission-packs"
VAULT_BUCKET = "company-documents"
TENDER_DOCS_BUCKET = "tender-documents"  # 0017; manual uploads under manual/<company>/<tender>/ (0024)
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


# SAST (UTC+2) - calendar-day fallback ONLY (see _within() below). _now()
# above stays true UTC on purpose: it timestamps real DB rows
# (downloaded_at/analysed_at/started_at/completed_at), where the correct
# value is the real instant, not a shifted one. Same local-constant
# convention as watch_deadlines.py/generate_cv.py, not a cross-directory
# import.
SAST = datetime.timezone(datetime.timedelta(hours=2))


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
        parts = [f"{k}=is.null" if v is None else f"{k}=eq.{urllib.parse.quote(str(v), safe='')}"
                 for k, v in (filters or {}).items()]
        parts += extra or []
        return ("?" + "&".join(parts)) if parts else ""

    def select(self, table, filters=None, order=None):
        extra = ["select=*"] + ([f"order={order}"] if order else [])
        out = self._req("GET", f"/rest/v1/{table}{self._q(filters, extra)}")
        return json.loads(out) if out else []

    def update(self, table, filters, body):
        out = self._req("PATCH", f"/rest/v1/{table}{self._q(filters)}", body, {"Prefer": "return=representation"})
        return json.loads(out) if out else []

    def insert(self, table, row):
        out = self._req("POST", f"/rest/v1/{table}", row, {"Prefer": "return=representation"})
        rows = json.loads(out) if out else []
        return rows[0] if rows else None

    def delete(self, table, filters):
        self._req("DELETE", f"/rest/v1/{table}{self._q(filters)}")

    def upsert(self, table, rows, on_conflict):
        out = self._req("POST", f"/rest/v1/{table}?on_conflict={on_conflict}", rows,
                        {"Prefer": "return=representation,resolution=merge-duplicates"})
        return json.loads(out) if out else []

    def rpc(self, fn, args=None):
        out = self._req("POST", f"/rest/v1/rpc/{fn}", args or {})
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

def download_tender_documents(tender, dest_dir, fetch=None, client=None, sources=None):
    """Downloads each tenders.document_urls entry once (cached per tender):
    a public link (eTenders OCDS release, 0018) over HTTP, or a document a
    person uploaded themselves (manual load, 0024: {title, storage_path,
    bucket}) from Storage. Returns (paths, notes). A document that fails is
    noted, not fatal - one bad link must not hide the rest (same rule as
    assess_tender.fetch_pdf_text). `sources`, when given, is filled with
    local path -> the entry it came from."""
    os.makedirs(dest_dir, exist_ok=True)
    fetch = fetch or _http_get
    paths, notes, used = [], [], set()
    for i, d in enumerate(tender.get("document_urls") or []):
        url, storage_path = d.get("url"), d.get("storage_path")
        if not url and not storage_path:
            continue
        title = d.get("title") or (os.path.basename(storage_path) if storage_path else f"document_{i}")
        name = re.sub(r"[^A-Za-z0-9._ ()-]+", "_", title)[:120] or f"document_{i}"
        if "." not in name[-6:]:
            name += ".pdf"
        base, ext = os.path.splitext(name)
        n = 2
        while name.lower() in used:  # two uploads with the same file name
            name, n = f"{base} ({n}){ext}", n + 1
        used.add(name.lower())
        dest = os.path.join(dest_dir, name)
        if not os.path.exists(dest):
            try:
                if storage_path:
                    if client is None:
                        raise RuntimeError("no Storage client to fetch an uploaded document")
                    client.download(d.get("bucket") or TENDER_DOCS_BUCKET, storage_path, dest)
                else:
                    data = fetch(url)
                    with open(dest, "wb") as f:
                        f.write(data)
            except Exception as e:
                notes.append(f"{title}: download failed ({e})")
                continue
        if sources is not None:
            sources[os.path.realpath(dest)] = d
        paths.append(dest)
    return paths, notes


def _http_get(url):
    r = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (tender-tool general engine)"})
    with urllib.request.urlopen(r, timeout=90) as resp:
        return resp.read()


def profile_from_company(client, company_id):
    """assess_tender's profile shape, from the company's own rows instead of a
    local JSON file. Shared with the Discovery fan-out
    (engine/discovery/company_profiles.py), so the intake and the national feed
    build a company's profile the same way: disciplines from its tagged
    Experience Library items, CIDB from companies.cidb_grading (0018), offices
    from company_offices (0015) else derived from the registered address."""
    import company_profiles
    return company_profiles.profile_from_company_rows(client, company_id)


def _template_storage_path(tender, doc_type, local, sources):
    """Reuse the uploaded object when the template was uploaded as its own
    file; a template that came out of a zip is uploaded on its own."""
    src = sources.get(os.path.realpath(local))
    if src and src.get("storage_path") and (src.get("bucket") or TENDER_DOCS_BUCKET) == TENDER_DOCS_BUCKET:
        return src["storage_path"], False
    ext = os.path.splitext(local)[1].lower()
    if tender.get("source") == "manual" and tender.get("owner_company_id"):
        return f"manual/{tender['owner_company_id']}/{tender['id']}/intake/{doc_type}{ext}", True
    return f"{tender.get('slug') or tender['id']}/{doc_type}{ext}", True


def register_sanral_tender(client, tender, decision, sources):
    """SANRAL route: the blank templates -> tender_documents (what
    engine/pack/process_pack_jobs.py reads), the template's SETUP positions ->
    tender_requirements (what the compliance report reads), and the
    fingerprint check, reported but never stored as a baseline."""
    files = decision["sanral_files"]
    tech = files["technical_xlsm"]
    setup = intake.read_setup(tech)
    fp = intake.check_fingerprint(tech, decision["family"])
    for doc_type, local in files.items():
        path, needs_upload = _template_storage_path(tender, doc_type, local, sources)
        if needs_upload:
            ct = "application/vnd.ms-excel.sheet.macroEnabled.12" if local.lower().endswith(".xlsm") else \
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            client.upload(TENDER_DOCS_BUCKET, path, local, ct)
        # company_id null: the shared copy - the buyer's own published file,
        # the one source every company may build from (0045). Companies'
        # own uploads (company_id set) are theirs and are not touched here.
        client.upsert("tender_documents", [{"tender_id": tender["id"], "doc_type": doc_type, "company_id": None,
                                            "storage_path": path, "downloaded_at": _now()}],
                      "tender_id,doc_type,company_id")
    client.delete("tender_requirements", {"tender_id": tender["id"], "company_id": None})
    rows = []
    for p in setup["positions"]:
        base = {"tender_id": tender["id"], "company_id": None, "position_code": p["code"], "position_description": p["description"],
                "managerial": p["managerial"]}
        rows.append({**base, "is_alternate": False})
        if p["has_alternate"]:
            rows.append({**base, "is_alternate": True})
    if rows:
        client.upsert("tender_requirements", rows, "tender_id,position_code,is_alternate,company_id")
    return setup, fp


def record_fit(client, job, tender, all_text, documents=None):
    """assess_tender + score_outlook on the tender's own text, for THIS
    company, into discovered_opportunities - the same row a discovered tender
    has, so /discovery and the workspace read fit the same way. A discovered
    tender's own Discovery verdict is left alone (only linked); a manual
    tender's row is written (and rewritten when documents are added)."""
    existing = client.select("discovered_opportunities", {"company_id": job["company_id"], "tender_id": tender["id"]})
    if not existing and tender.get("ocid"):
        existing = client.select("discovered_opportunities", {"company_id": job["company_id"], "ocid": tender["ocid"]})
    if existing and tender.get("source") != "manual":
        if not existing[0].get("tender_id"):
            client.update("discovered_opportunities", {"id": existing[0]["id"]}, {"tender_id": tender["id"]})
        return existing[0].get("verdict")
    profile = profile_from_company(client, job["company_id"])
    fit = intake.assess_fit_from_text(tender.get("title"), tender.get("description"), all_text, profile,
                                      documents=documents)
    row = {"company_id": job["company_id"], "contract_number": tender.get("contract_no"), "buyer": tender.get("buyer"),
           "title": tender.get("title"), "closing_date": tender.get("closing_date"), "categories": fit["categories"],
           "document_depth": fit["document_depth"], "verdict": fit["verdict"], "reasons": fit["reasons"],
           "description": tender.get("description"), "score_outlook": fit["score_outlook"],
           "source": "manual" if tender.get("source") == "manual" else "etenders_ocds", "tender_id": tender["id"]}
    if existing:
        client.update("discovered_opportunities", {"id": existing[0]["id"]}, row)
    else:
        client.insert("discovered_opportunities", {**row, "ocid": tender.get("ocid"), "document_urls": []})
    return fit["verdict"]


def private_documents_for(client, company_id, tender):
    """This company's own documents for a SHARED tender (tender_private_documents,
    migration 0032) as document_urls-shaped entries - [] for a manual tender
    (already private; its documents are in tenders.document_urls). Every path
    is re-checked against the company's own prefix before anything is
    downloaded with the service role (the table has the same CHECK)."""
    if tender.get("owner_company_id"):
        return []
    prefix = f"private/{company_id}/{tender['id']}/"
    out = []
    for r in client.select("tender_private_documents", {"company_id": company_id, "tender_id": tender["id"]},
                           order="created_at.asc"):
        sp = r.get("storage_path") or ""
        if not sp.startswith(prefix) or ".." in sp:
            raise RuntimeError(f"private document {r.get('id')} is not under this company's own folder - refusing to read it")
        out.append({"id": r["id"], "title": r.get("title") or os.path.basename(sp), "storage_path": sp,
                    "bucket": TENDER_DOCS_BUCKET})
    return out


def private_work_dir(work_root, company_id, tender_id):
    """Per-COMPANY working folder: the tenders/<id>/docs cache is shared by every
    company's jobs on this worker, so private documents never go there."""
    return os.path.join(work_root, "companies", company_id, "tenders", tender_id)


def job_tender(client, job):
    """The job's tender - refused when it is another company's private
    (manual) tender: the service role would otherwise read its documents."""
    rows = client.select("tenders", {"id": job["tender_id"]})
    if not rows or rows[0].get("owner_company_id") not in (None, job["company_id"]):
        raise RuntimeError("tender not found")
    return rows[0]


def own_pack(client, job):
    """The job company's own tender_packs row for the job's tender, looked up
    by (company_id, tender_id) - unique since 0001. job.tender_pack_id is
    written by the client, so it is never used to find the pack."""
    rows = client.select("tender_packs", {"company_id": job["company_id"], "tender_id": job["tender_id"]})
    rows = [r for r in rows if r.get("company_id") == job["company_id"] and r.get("tender_id") == job["tender_id"]]
    return rows[0] if rows else None


def recent_corrections(client, limit=5):
    """Up to `limit` of the most recent admin corrections/false-positives
    (requirement_extraction_reviews, migration 0074) - the input to
    requirements.extract_requirements()'s past_corrections honesty check (see
    that function's own module comment for exactly what this can and can't
    do: "most recent N corrections globally" is the simple, cheap heuristic
    used here, not a buyer- or form-specific lookup - requirements.py's own
    matching on item identity still narrows it to something relevant).
    Best-effort: a lookup failure must never block a real extraction."""
    try:
        out = client._req("GET", "/rest/v1/requirement_extraction_reviews"
                           "?select=item_snapshot,verdict,corrected_value"
                           "&verdict=in.(corrected,false_positive)"
                           f"&order=created_at.desc&limit={int(limit)}")
        rows = json.loads(out) if out else []
    except Exception:
        return []
    return [{"item_type": (r.get("item_snapshot") or {}).get("item_type"),
             "item_snapshot": r.get("item_snapshot") or {},
             "verdict": r.get("verdict"), "corrected_value": r.get("corrected_value")} for r in rows]


def run_extraction(client, job, work_root, fetch=None):
    """The intake + requirements step every tender's documents go through,
    however the tender arrived (Discovery, or a manual load - 0024).

    With private documents (0032: this company's own files on a SHARED
    tender) the published documents and those are read together, and the
    result - manifest and intake record - goes to THIS company's tender_packs
    row only. Nothing read from a private document is written to the shared
    tenders row, tender_documents or tender_requirements, which every company
    pursuing the tender can see."""
    tender = job_tender(client, job)
    work = os.path.join(work_root, "tenders", tender["id"])
    docs_dir = os.path.join(work, "docs")
    sources = {}
    paths, notes = download_tender_documents(tender, docs_dir, fetch, client=client, sources=sources)
    private = private_documents_for(client, job["company_id"], tender)
    dirs = [docs_dir]
    scratch = os.path.join(work, "extract")
    if private:
        pwork = private_work_dir(work_root, job["company_id"], tender["id"])
        pdir = os.path.join(pwork, "private_docs")
        shutil.rmtree(pdir, ignore_errors=True)  # a removed private document must not linger
        ppaths, pnotes = download_tender_documents({"document_urls": private}, pdir, fetch, client=client, sources=sources)
        paths, notes, dirs = paths + ppaths, notes + [f"(private) {n}" for n in pnotes], dirs + [pdir]
        scratch = os.path.join(pwork, "extract")
    if not paths:
        raise JobRefusal("No tender documents could be downloaded" + (": " + "; ".join(notes) if notes else " - no document links on file."))
    shutil.rmtree(scratch, ignore_errors=True)
    manifest = req.extract_requirements(dirs, work_dir=scratch, source_label=tender.get("ocid") or tender.get("slug"),
                                        keep_text=True, past_corrections=recent_corrections(client), buyer=tender.get("buyer"))
    all_text = manifest.get("_all_text") or ""
    decision = intake.classify_documents(manifest["documents"], tender.get("buyer"), all_text)
    readable = [d for d in manifest["documents"] if d["chars"] > 0 and not d["unreadable"]]
    if decision["route"] != "sanral" and not readable:
        # Fail loudly: a manifest built from zero readable text would claim
        # "this tender uses no standard forms" and ask no questions - a
        # silent wrong answer, not an empty one.
        why = "; ".join(f"{d['name']}: {d['unreadable'] or 'no text found'}" for d in manifest["documents"])[:700]
        raise JobRefusal("None of this tender's documents could be read, so nothing about what it requires could be "
                           f"checked ({why}). Upload a text PDF or Word copy - scanned pages are only read when OCR can read "
                           "them clearly (each reason above says why it couldn't).")
    clean = req.strip_local(manifest)
    if notes:
        clean["gaps"] = clean.get("gaps", []) + [f"Couldn't download: {n}" for n in notes]

    intake_rec = {k: decision[k] for k in ("route", "family", "signal", "sanral_hint", "workbooks", "sanral_documents")}
    intake_rec["notes"] = list(decision["notes"]) + [f"Couldn't download: {n}" for n in notes]
    intake_rec["readable_documents"] = len(readable)
    intake_rec["unreadable_documents"] = [{"document": d["name"], "reason": d["unreadable"]} for d in manifest["documents"] if d["unreadable"]] + \
        [{"document": w["document"], "reason": w["error"]} for w in decision["workbooks"] if w["kind"] == "unreadable"]
    intake_rec["analysed_at"] = _now()
    if private:
        pack = own_pack(client, job)
        if not pack:
            raise JobRefusal("This company has no tender pack for this tender - start working on it first.")
        intake_rec["private_documents"] = [d["id"] for d in private]
        intake_rec["notes"].append(f"Read together with {len(private)} of your private document(s) - this reading is kept "
                                   "with your company's copy of the tender, not shown to other companies.")
        if decision["route"] == "sanral":
            intake_rec["notes"].append("A SANRAL Technical Submission workbook was found among the documents. The SANRAL "
                                       "submission pack uses the tender's blank templates - upload them under Blank tender "
                                       "templates on this page.")
        client.update("tender_packs", {"id": pack["id"]}, {"document_requirements": clean, "intake": intake_rec})
        verdict = record_fit(client, job, tender, all_text, documents=manifest["documents"])
        return {"route": decision["route"], "family": tender.get("family"), "verdict": verdict, "private_documents": len(private),
                "forms": len(clean["forms"]), "returnables": len(clean["returnables"]), "questions": len(clean["questions"])}
    patch = {"document_requirements": clean}
    if decision["route"] == "sanral":
        setup, fp = register_sanral_tender(client, tender, decision, sources)
        intake_rec["setup"] = setup
        intake_rec["fingerprint"] = fp
        intake_rec["notes"] += intake.discrepancies({"contract_no": tender.get("contract_no"), "closing_date": tender.get("closing_date")}, setup)
        patch["family"] = decision["family"]
        if not tender.get("nra_reference"):
            nra = intake.find_nra_reference(all_text)
            if nra:
                patch["nra_reference"] = nra
                intake_rec["notes"].append(f"NRA reference {nra} read from the tender documents.")
            else:
                intake_rec["notes"].append("No NRA reference found (it's on SANRAL's Book 1 cover, e.g. 'NRA: 2026/0071') - "
                                           "upload Book 1, otherwise the envelope covers and the authority letter are left out of the pack.")
        if not tender.get("contract_no") and setup.get("contract_no"):
            patch["contract_no"] = setup["contract_no"]
        if not tender.get("closing_date") and setup.get("closing_date"):
            # The time from the tender's OWN notice ("The closing time and date
            # for receipt of tenders is 12:00 on ..."), not a fixed one
            # (Form-Field-Audit 2026-10-18: 12:00 was always assumed - R.396's
            # time, not every SANRAL tender's).
            closing_time = intake.find_closing_time(all_text)
            notice_time = closing_time["value"] if closing_time else None
            patch["closing_date"] = f"{setup['closing_date']}T{notice_time or '12:00'}:00+02:00"
            intake_rec["notes"].append(
                f"Closing date taken from the workbook's SETUP sheet ({setup['closing_date']}); "
                + (f"the time ({notice_time}) from the Tender Notice." if notice_time else
                   "no closing time found in the documents read - 12:00 was used as a placeholder, check the "
                   "Tender Notice and correct it."))
            if closing_time and closing_time["ambiguous"]:
                # A real, common shape: an addendum extending the deadline on
                # top of Book 1's own original notice. Which one this picked
                # is not a "latest wins" choice (QA pass, 2026-10-23 - see
                # find_closing_time()'s own docstring) - said plainly rather
                # than trusted silently.
                intake_rec["notes"].append(
                    f"More than one different closing time was found across the documents read - {notice_time} was "
                    "used, but check the Tender Notice and any addenda for the actual, correct closing time before "
                    "relying on this.")
        # The tender box address, for the envelope covers (read, never assumed).
        delivery = intake.find_delivery_address(all_text)
        if delivery:
            intake_rec["delivery_address"] = delivery
            if delivery["ambiguous"]:
                intake_rec["notes"].append(
                    "More than one different tender-box delivery address was found across the documents read - the "
                    f"address above ({delivery['quote']}) was used, but check Book 1's Tender Notice and any addenda "
                    "for the actual, correct venue before relying on this for the envelope covers.")
        else:
            intake_rec["notes"].append("No tender-box delivery address found in the documents read (it's in Book 1's "
                                       "Tender Notice) - the envelope covers will be printed without one.")
    elif tender.get("family") in (None, "", "UNKNOWN") or tender.get("family") in intake.SANRAL_FAMILIES:
        patch["family"] = intake.GENERAL_FAMILY
    patch["intake"] = intake_rec

    existing = tender.get("evaluation_rules") or {}
    if not existing or str(existing.get("source_document", "")).startswith("discovery outlook"):
        patch["evaluation_rules"] = {
            "experience_evidence": clean["experience_evidence"],
            "locality": clean["locality"],
            # audit Q5: the tender's own C3.1.11 minimums (tenderCompliance.ts
            # uses them; R.396's table only as a labelled fallback)
            "key_person_minimums": clean.get("key_person_minimums"),
            # The tender's own functionality minimum (score_outlook THRESHOLD_RE),
            # so the SANRAL estimate stops assuming R.396's 70 for every tender
            # (Book 1 Annexure A: 70, 80 or 85 per tender - regulatory review G7).
            "functionality": (clean.get("scoring") or {}).get("functionality"),
            "source_document": "; ".join(sorted({d["name"] for d in clean["documents"] if d["chars"] > 0}))[:500],
            "extracted_at": clean["extracted_at"],
        }
    client.update("tenders", {"id": tender["id"]}, patch)
    verdict = record_fit(client, job, {**tender, **patch}, all_text, documents=manifest["documents"])
    return {"route": decision["route"], "family": patch.get("family", tender.get("family")), "verdict": verdict,
            "forms": len(clean["forms"]), "returnables": len(clean["returnables"]), "questions": len(clean["questions"])}


# ---------------------------------------------------------------------------
# Pack
# ---------------------------------------------------------------------------

def _years_before(day, years):
    """day minus whole years; 29 Feb lands on 28 Feb in a non-leap year (the
    same as Postgres' `date - make_interval(years => n)`, which the app's own
    find_matching_experience uses). date.replace(year=...) raised ValueError
    for a 29 Feb closing date and killed the whole pack job."""
    try:
        return day.replace(year=day.year - years)
    except ValueError:
        return day.replace(year=day.year - years, day=28)


def _within(item, rule, closing):
    """Is one Experience Library row inside the tender's rule? Called in a
    filter over every row the company has, so a row whose completion date
    can't be read is treated like one with no date (not within - the same
    answer it already got), with an alert, rather than crashing the pack job
    for every other row too."""
    comp = item.get("completion_date")
    comp_day = None
    if comp:
        try:
            comp_day = datetime.date.fromisoformat(str(comp)[:10])
        except ValueError:
            system_alerts.record("general", f"Experience item {item.get('id')}'s completion date ('{comp}') is not a "
                                 "valid date - left out of this pack's experience evidence until it's corrected.",
                                 "warning", context={"experience_item_id": item.get("id"), "completion_date": comp})
    if rule.get("since_year") and (not comp_day or comp_day.year < int(rule["since_year"])):
        return False
    if rule.get("window_years"):
        if not comp_day:
            return False
        # A missing/unreadable closing date falls back to today (Finding 9c)
        # - "today" must be the real SAST calendar day, not _now()'s UTC one:
        # during the 00:00-01:59 SAST window UTC "today" is still yesterday,
        # which would move the window-years cutoff a day early and let a
        # stale Experience Library row (completed exactly one day too long
        # ago) through as recent-enough evidence - confirmed live by mocking
        # that window and reproducing the wrong True (QA pass, 2026-10-21).
        today_sast = datetime.datetime.now(SAST).date().isoformat()
        try:
            ref = datetime.date.fromisoformat(str(closing or today_sast)[:10])
        except ValueError:
            ref = datetime.date.fromisoformat(today_sast)
        if comp_day < _years_before(ref, int(rule["window_years"])):
            return False
    return True


def own_path(path, company_id, what):
    """A client-written storage path, checked before the service role
    downloads it (no Storage RLS for the service key): it must sit under the
    job company's own folder, else another company's file would end up in
    this pack (POPIA-Security-Audit.md; migration 0043 has the same CHECK)."""
    p = path or ""
    if not p.startswith(f"{company_id}/") or ".." in p or "//" in p:
        raise RuntimeError(f"{what}: the stored file path is not under this company's own folder - refusing to read it. "
                           "Upload the document again on its page.")
    return p


def provenance_pack_id(client, job):
    """The tender_packs row field provenance is written to: always the job
    company's OWN pack for this tender. job.tender_pack_id is client-written,
    so it is never trusted on its own."""
    pack = own_pack(client, job)
    return pack["id"] if pack and pack.get("tender_id") == job.get("tender_id") else None


def gather_pack_inputs(client, job, tender, manifest, work, prefer_manifest_rules=False):
    company = client.select("companies", {"id": job["company_id"]})[0]
    answer_rows = client.select("tender_answers", {"company_id": job["company_id"], "tender_id": tender["id"]})
    answers = {a["field_key"]: a["value"] for a in answer_rows if a.get("value") is not None}
    files_dir = os.path.join(work, "files")
    files = {}
    for col in VAULT_COLUMNS:
        if company.get(col):
            own_path(company[col], job["company_id"], "Vault document")
            files["vault:" + col] = client.download(VAULT_BUCKET, company[col], os.path.join(files_dir, "vault", os.path.basename(company[col])))
    for a in answer_rows:
        if a.get("storage_path") and a["field_key"].startswith("upload:"):
            own_path(a["storage_path"], job["company_id"], "Tender upload")
            files[a["field_key"]] = client.download(VAULT_BUCKET, a["storage_path"], os.path.join(files_dir, "uploads", os.path.basename(a["storage_path"])))

    signatory = None
    sid = answers.get("signatory_person_id")
    if sid:
        ppl = client.select("people", {"id": sid, "company_id": job["company_id"]})
        if ppl:
            # Capacity = the People page's signatory capacity only. It used to
            # fall back to the person's job title ("role"), which then went onto
            # SBD 1 "capacity under which this bid is signed" logged confirmed
            # (form-field audit 2026-10-18); not on file now stays blank/missing,
            # and the workspace already says "no signatory capacity on file".
            signatory = {"name": ppl[0]["name"], "capacity": ppl[0].get("signatory_capacity"),
                         # MBD 4 3.2 "Identity Number" of the representative (typed onto flat PDFs)
                         "id_number": ppl[0].get("id_number")}

    # experience the tender's own rule accepts (never SANRAL's B6 by default)
    evidence = []
    shared_rules = (tender.get("evaluation_rules") or {}).get("experience_evidence", {}).get("rules")
    own_rules = manifest["experience_evidence"].get("rules")
    # A company's own reading (private documents) is the fuller one - its rule first.
    rules = ((own_rules or shared_rules) if prefer_manifest_rules else (shared_rules or own_rules)) or []
    if rules:
        rule = rules[0]
        accepted = {t for e in rule.get("accepted_evidence", []) for t in DOC_TYPES_FOR.get(e, [])}
        items = [i for i in client.select("experience_items", {"company_id": job["company_id"]}, order="completion_date.desc")
                 if i.get("tagged_at") and i.get("document_type") in accepted and _within(i, rule, tender.get("closing_date"))]
        for i in items[:max(int(rule.get("projects_required") or 5), 1) + 2]:
            title = f"{i['project_name']} ({i['document_type'].replace('_', ' ')})"
            if i.get("storage_path"):
                own_path(i["storage_path"], job["company_id"], "Experience document")
                evidence.append({"title": title, "path": client.download(EXPERIENCE_BUCKET, i["storage_path"],
                                                                        os.path.join(files_dir, "experience", os.path.basename(i["storage_path"])))})
            else:
                evidence.append({"title": title, "path": None, "missing_reason": "captured without a document - upload it in the Experience Library"})

    # CVs of people tagged for the roles the tender names
    cvs = []
    for role in manifest.get("roles", []):
        for tag in client.select("person_role_eligibility", {"company_id": job["company_id"], "role_code": role["role_code"]}):
            # Scoped to this company: a person's CVs are only the ones this
            # company attached (another company could name the same people.id).
            person = (client.select("people", {"id": tag["person_id"], "company_id": job["company_id"]}) or [None])[0]
            if person is None:
                continue
            gen = [g for g in client.select("generated_cvs", {"person_id": tag["person_id"], "company_id": job["company_id"],
                                                              "status": "ready"}, order="requested_at.desc")
                   if g.get("storage_path_pdf")]
            up = client.select("cv_uploads", {"person_id": tag["person_id"], "company_id": job["company_id"]},
                               order="created_at.desc")
            title = f"CV - {person.get('name', 'unknown')} ({role['role_code'].split('.', 1)[-1].replace('_', ' ')})"
            if any(c["title"] == title for c in cvs):
                continue
            src = (CV_BUCKET, gen[0]["storage_path_pdf"]) if gen else ((CV_BUCKET, up[0]["storage_path"]) if up else None)
            if src:
                own_path(src[1], job["company_id"], f"CV for {person.get('name')}")
                cvs.append({"title": title, "path": client.download(src[0], src[1], os.path.join(files_dir, "cvs", os.path.basename(src[1])))})
            else:
                cvs.append({"title": title, "path": None, "missing_reason": "no CV uploaded or generated for this person"})
    return company, answers, files, signatory, evidence, cvs


def run_pack(client, job, work_root, fetch=None):
    tender = job_tender(client, job)
    if tender.get("family") in intake.SANRAL_FAMILIES:
        raise JobRefusal("This is a SANRAL tender (its Technical Submission workbook was recognised) - generate it with the "
                           "SANRAL 'Submission pack' card, not the general pack.")
    # This company's own reading (with its private documents, 0032) wins.
    pack = own_pack(client, job)
    private_manifest = (pack or {}).get("document_requirements")
    manifest = private_manifest or tender.get("document_requirements")
    if not manifest:
        raise JobRefusal("This tender's documents haven't been read yet - run 'Read this tender's documents' first.")
    work = os.path.join(work_root, "packs", job["id"])
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work, exist_ok=True)
    paths, _ = download_tender_documents(tender, os.path.join(work_root, "tenders", tender["id"], "docs"), fetch, client=client)
    docs_dir = os.path.join(work_root, "tenders", tender["id"], "docs")
    dirs = [docs_dir] if paths else []
    if private_manifest:
        private = private_documents_for(client, job["company_id"], tender)
        if private:
            pdir = os.path.join(private_work_dir(work_root, job["company_id"], tender["id"]), "private_docs")
            ppaths, _ = download_tender_documents({"document_urls": private}, pdir, fetch, client=client)
            if ppaths:
                dirs.append(pdir)
    local = bgp.local_docs_for(manifest, dirs, os.path.join(work, "src"))
    company, answers, files, signatory, evidence, cvs = gather_pack_inputs(client, job, tender, manifest, work,
                                                                           prefer_manifest_rules=bool(private_manifest))
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

    prov_pack = provenance_pack_id(client, job)
    if prov_pack and res["provenance"]:
        seen = {}
        for e in res["provenance"]:
            seen[e["field_key"]] = e  # last write wins (a field filled in two documents)
        client.upsert("field_provenance", [{"tender_pack_id": prov_pack, **{k: e[k] for k in ("field_key", "status", "value", "reason", "source")}}
                                          for e in seen.values()], "tender_pack_id,field_key")
    return {"storage_path_pdf": pdf_path, "output_files": output_files, "page_count": pm["page_count"],
            "manifest": {k: pm[k] for k in ("sections", "omitted", "by_hand", "form_results", "provenance_summary", "contents_pages",
                                            "checklist", "checklist_summary")}}


# ---------------------------------------------------------------------------
# Job loop
# ---------------------------------------------------------------------------

STALE_AFTER_MINUTES = 60  # same threshold as process_cv_jobs.py / process_pack_jobs.py's
                          # own fail_stale_jobs() - a worker killed mid-job (OOM, host
                          # crash, container restart) otherwise leaves this row in
                          # 'generating' forever with no retry and no trace (confirmed
                          # this queue had no stale-job recovery at all, unlike its two
                          # sibling queues on the same pack_generation_jobs table).


def fail_stale_jobs(client, now=None):
    """A worker killed mid-job leaves its row in 'generating' forever - started_at
    (already set by process_job's own claim, no migration needed) makes that
    detectable here, mirroring process_pack_jobs.py's own fail_stale_jobs()
    exactly, just scoped to engine='general' on the same shared table. Deliberately
    not re-queued: a job that crashed the worker once would crash it again in a loop,
    same rule the other two queues already follow."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(minutes=STALE_AFTER_MINUTES)
    for job in client.select(JOBS_TABLE, {"status": "generating", "engine": ENGINE}):
        started = job.get("started_at")
        if started and datetime.datetime.fromisoformat(started.replace("Z", "+00:00")) < cutoff:
            client.update(JOBS_TABLE, {"id": job["id"], "status": "generating"}, {
                "status": "failed", "completed_at": _now(),
                "error_message": f"The general engine stopped mid-job (no result after {STALE_AFTER_MINUTES} "
                                 "minutes). Nothing was produced - request it again."})
            print(f"[failed] {job['id']}: stale 'generating' since {started}")
            system_alerts.record("general", f"A general engine job was stuck in 'generating' for over "
                                            f"{STALE_AFTER_MINUTES} minutes (the worker died mid-job) and was "
                                            "marked failed", "error",
                                 context={"job_id": job["id"], "kind": job.get("kind"),
                                          "company_id": job.get("company_id"), "tender_id": job.get("tender_id"),
                                          "started_at": started})


def process_job(client, job, work_root, fetch=None):
    claimed = client.update(JOBS_TABLE, {"id": job["id"], "status": "requested", "engine": ENGINE},
                            {"status": "generating", "started_at": _now()})
    if not claimed:
        return False  # another worker took it
    try:
        if job["kind"] == "extract_requirements":
            summary = run_extraction(client, job, work_root, fetch)
            client.update(JOBS_TABLE, {"id": job["id"]}, {"status": "ready", "completed_at": _now()})
            print(f"[ready] extract {job['id']}: {summary}")
        elif job["kind"] == "generate_pack":
            result = run_pack(client, job, work_root, fetch)
            client.update(JOBS_TABLE, {"id": job["id"]}, {"status": "ready", "completed_at": _now(), **result})
            print(f"[ready] pack {job['id']}: {result['page_count']} pages -> {result['storage_path_pdf']}")
        else:
            raise RuntimeError(f"unknown job kind {job['kind']}")
    except Exception as e:
        system_alerts.record("general", f"General engine {job.get('kind')} job failed: "
                                        f"{e if isinstance(e, JobRefusal) else f'{type(e).__name__}: {e}'}",
                             "warning" if isinstance(e, JobRefusal) else "error", exc=e,
                             context={"job_id": job["id"], "kind": job.get("kind"), "company_id": job.get("company_id"),
                                      "tender_id": job.get("tender_id")})
        try:
            client.update(JOBS_TABLE, {"id": job["id"]}, {"status": "failed", "error_message": str(e)[:1000], "completed_at": _now()})
        except Exception as e2:
            system_alerts.record("general", f"Could not mark a failed general job as failed: {type(e2).__name__}: {e2}",
                                 "error", exc=e2, context={"job_id": job["id"]})
        print(f"[failed] {job['kind']} {job['id']}: {e}")
    return True


def poll_once(client, work_root, fetch=None):
    fail_stale_jobs(client)
    jobs = client.select(JOBS_TABLE, {"engine": ENGINE, "status": "requested"}, order="requested_at.asc")
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
    poll_forever(lambda: poll_once(client, work), interval=args.interval, max_cycles=args.max_cycles, name="general", alert_source="general")
    return 0


if __name__ == "__main__":
    sys.exit(main())
