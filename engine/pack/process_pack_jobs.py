"""
Bridge between the web app's pack_generation_jobs table
(app/supabase/migrations/0017_pack_generation_jobs.sql) and the real SANRAL
fill engines, via engine/pack/assemble_pack.py.

Same shape as engine/cv/process_cv_jobs.py, deliberately: the Tender
Workspace's "Generate submission pack" button only inserts a 'requested' row
(Vercel can't run Python or LibreOffice). This script - run by hand, cron, or
whatever scheduler drives process_cv_jobs.py - finds 'requested' rows, claims
each one (requested -> generating, conditional on it still being 'requested',
so two workers never build the same job), and then:

  1. reads the tender, the company, the tender pack and its confirmed
     positions, the people/projects, the blank SANRAL templates
     (tender_documents -> 'tender-documents' bucket), the vault documents
     ('company-documents'), and per position the newest ready generated CV
     (generated_cvs -> 'cv-documents') or else the person's newest as-is CV
     upload (cv_uploads);
  2. adapts those Supabase rows into the profile/pack shapes the CLI engines
     already read, and builds pack.yaml with engine/pack_generator/
     confirm_pack.py's own confirm() - so its human-confirmation gate
     (every position needs a confirmed person) still applies, here fed from
     tender_pack_assignments.confirmed_person_id;
  3. calls assemble_pack.build_submission_pack(), which runs the real
     fill_conventional/fill_tender, print_reports, fill_financial,
     run_forms_pipeline, fill_authority_letter and make_envelope_covers, and
     merges everything into one PDF with a contents page and page numbers;
  4. reads both merged PDFs back (pdf_merge.verify_pack) - the technical pack
     and the separate Envelope 2 (Financial) PDF; a job is only marked
     'ready' if the page count, the page-number stamps, the contents page
     entries and the bookmarks all check out in each;
  5. uploads both PDFs + filled workbooks + ACTIONS_TO_SIGN.md + manifest to
     'submission-packs' and marks the row 'ready' (or 'failed' with the
     reason - e.g. confirm_pack.py's or fingerprint.py's own refusal text).

Every poll also fills in tender_requirements for any tender whose blank
Technical workbook has been uploaded (Tender Workspace, tender_documents) but
whose key positions haven't been read yet: straight from that workbook's own
SETUP sheet (suggest_pack.read_required_positions - the same reader the pack
build's confirm gate uses), never guessed. That is what lists the positions
on the Tender Workspace's Key positions card for a person to confirm.

Same CLI contract as process_cv_jobs.py: one-shot (process whatever is queued,
then exit) is the default and `--once` says so explicitly - that is what
engine/worker/run_bridges.py calls; `--loop` keeps polling via the shared
engine/worker/poll_loop.py.

Usage:
    python3 engine/pack/process_pack_jobs.py [--once | --loop [--interval S] [--max-cycles N]]
                                             [--work-dir DIR] [--keep]
Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (service role - this
runs outside RLS, like every other engine/ writer).
"""
import os
import re
import sys
import json
import shutil
import argparse
import datetime
import tempfile
import urllib.parse
import urllib.request
import urllib.error

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.abspath(os.path.join(HERE, ".."))
for p in (ENGINE_DIR, os.path.join(ENGINE_DIR, "pack_generator"), os.path.join(ENGINE_DIR, "cv"),
          os.path.join(ENGINE_DIR, "worker"), HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

import confirm_pack  # noqa: E402
from suggest_pack import read_required_positions  # noqa: E402
from sanral_fill import Workbook  # noqa: E402
from assemble_pack import build_submission_pack  # noqa: E402
from pdf_merge import verify_pack  # noqa: E402
from poll_loop import poll_forever, DEFAULT_INTERVAL_SECONDS  # noqa: E402

DEFAULT_WORK_DIR = os.path.join(ENGINE_DIR, "..", "out", "pack_jobs")
# pack_generation_jobs is the one job queue for every engine (unified-queue
# migration): this bridge takes only the SANRAL rows; engine = 'general' rows
# belong to engine/general/process_general_jobs.py.
ENGINE = "sanral"

# tender_documents.doc_type -> file name the engines expect (fill_docx_forms.py /
# run_forms_pipeline.py read these exact names from one directory).
FORM_FILES = {
    "a_forms": "A_Forms.docx",
    "c111_form_of_offer": "C.1.1.1_Form_of_Offer.docx",
    "c123_contract_data": "C.1.2.3_Contract_Data.docx",
}

# companies.<column> holding each vault document's uploaded copy (0014), keyed
# the way assemble_pack.VAULT_ORDER / ISO_KEY name them, with its expiry column.
VAULT_COLUMNS = {
    "sars_tcs_pin": ("sars_tcs_pin_document_path", "sars_tcs_pin_expiry"),
    "bee_proof": ("bee_proof_document_path", "bee_proof_expiry"),
    "pi_insurance": ("pi_insurance_document_path", "pi_insurance_expiry"),
    "bank_letter": ("bank_confirmation_letter_path", "bank_confirmation_letter_valid_until"),
    "coid_letter": ("coid_letter_document_path", "coid_letter_of_good_standing_expiry"),
    "iso_9001": ("iso_9001_document_path", "iso_9001_expiry"),
}

CONTENT_TYPES = {".pdf": "application/pdf", ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
                 ".md": "text/markdown", ".json": "application/json"}


# ============================================================================
# Supabase access (REST + Storage, service role) - same env vars and request
# pattern as process_cv_jobs.py / write_admin_harness_results.py. Kept behind
# a small interface so engine/pack/bridge_selftest.py can drive the exact same
# process_job() against a locally replayed schema.
# ============================================================================

NOT_NULL = object()


class SupabaseRest:
    def __init__(self, url, key):
        self.url, self.key = url.rstrip("/"), key

    def _req(self, method, path, body=None, headers=None, raw=None):
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}"}
        h.update(headers or {})
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(f"{self.url}{path}", data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path} failed: {e.code} {e.read().decode()[:300]}")

    @staticmethod
    def _filters(filters):
        parts = []
        for col, v in (filters or {}).items():
            if v is NOT_NULL:
                parts.append(f"{col}=not.is.null")
            elif isinstance(v, (list, tuple)):
                parts.append(f"{col}=in.({','.join(urllib.parse.quote(str(x)) for x in v)})")
            else:
                parts.append(f"{col}=eq.{urllib.parse.quote(str(v))}")
        return parts

    def select(self, table, filters=None, order=None):
        q = ["select=*"] + self._filters(filters) + ([f"order={order}"] if order else [])
        return json.loads(self._req("GET", f"/rest/v1/{table}?{'&'.join(q)}") or b"[]")

    def insert(self, table, row):
        out = self._req("POST", f"/rest/v1/{table}", row,
                        {"Content-Type": "application/json", "Prefer": "return=representation"})
        return (json.loads(out or b"[]") or [None])[0]

    def update(self, table, filters, body):
        q = self._filters(filters)
        out = self._req("PATCH", f"/rest/v1/{table}?{'&'.join(q)}", body,
                        {"Content-Type": "application/json", "Prefer": "return=representation"})
        return json.loads(out or b"[]")

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


# ============================================================================
# Adapters: Supabase rows -> the profile/pack shapes the CLI engines read.
# The inverse of engine/seed_supabase_company.py's mapping.
# ============================================================================

def _num(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def adapt_company(row):
    pi = None
    if row.get("pi_insurance_cover_zar") is not None and row.get("pi_insurance_policy_number"):
        pi = {"insurer": row.get("pi_insurance_insurer"), "policy_number": row["pi_insurance_policy_number"],
              "limit_of_indemnity_zar": _num(row["pi_insurance_cover_zar"]),
              "period_from": "(start date not on file)", "period_to": row.get("pi_insurance_expiry")}
    return {
        "legal_name": row["legal_name"],
        "csd_trading_name": row.get("csd_trading_name"),
        "cipc_registration_number": row.get("cipc_registration_number") or "",
        "vat_number": row.get("vat_number"),
        "income_tax_number": row.get("income_tax_number"),
        "paye_number": row.get("paye_number"),
        "csd_supplier_number": row.get("csd_supplier_number"),
        "coid_registration_number": row.get("coid_registration_number"),
        "coid_letter_of_good_standing_number": row.get("coid_letter_of_good_standing_number"),
        "coid_letter_of_good_standing_expiry": row.get("coid_letter_of_good_standing_expiry"),
        "bee_level": row.get("bee_level"),
        "black_ownership_pct": _num(row.get("black_ownership_pct")),
        "bee_procurement_recognition_pct": _num(row.get("bee_procurement_recognition_pct")),
        "status": row.get("status"),
        "bee_proof_type": row.get("bee_proof_type"),
        "bee_proof_expiry": row.get("bee_proof_expiry"),
        "sars_tcs_pin": row.get("sars_tcs_pin"),
        "sars_tcs_pin_expiry": row.get("sars_tcs_pin_expiry"),
        "professional_indemnity_insurance": pi,
        "iso_9001": {"certified": row.get("iso_9001_certified"),
                     "certificate_number": row.get("iso_9001_certificate_number"),
                     "expiry": row.get("iso_9001_expiry")},
        "registered_address": row.get("registered_address") or "",
        "postal_address": row.get("postal_address"),
        "head_office_per_form_b3": row.get("head_office"),
        "other_offices": row.get("other_offices"),
        "ecsa_registered_staff_count": row.get("ecsa_registered_staff_count"),
        "sacpcmp_registered_staff_count": row.get("sacpcmp_registered_staff_count"),
        "total_employees": row.get("total_employees"),
        "typical_jv_share_pct": _num(row.get("typical_jv_share_pct")),
        "bank": {"bank_name": row.get("bank_name"), "branch_code": row.get("bank_branch_code"),
                 "confirmation_letter_date": row.get("bank_confirmation_letter_date")},
        "director": {"name": row.get("director_name") or ""},
    }


def adapt_person(row, projects):
    return {
        "name": row["name"],
        "id_number": row.get("id_number") or "",
        "description": row.get("description") or "",
        "role": row.get("role"),
        "signatory_capacity": row.get("signatory_capacity"),
        "phone": row.get("phone") or "",
        "qualifications": {k: row.get(k) for k in (
            "ecsa_level", "ecsa_number", "ecsa_date", "sacpcmp_number", "sacpcmp_date", "highest_level",
            "highest_description", "highest_institution", "highest_graduated", "initial_description",
            "initial_institution", "initial_graduated")},
        "projects": [{
            "client_and_number": p["client_and_number"],
            "client_type": p.get("client_type"),
            "project_type": p.get("project_type"),
            "position_code": p.get("position_code"),
            "position_held": p.get("position_held"),
            "value_rm": _num(p.get("value_rm")),
            "contact": p.get("contact_name"),
            "contact_phone": p.get("contact_phone"),
            "contact_email": p.get("contact_email"),
            "start": p.get("start_date"),
            "end": p.get("end_date"),
        } for p in projects],
    }


def _strip_nulls_for_confirm(proj):
    # confirm_pack.py checks `"client_type" not in proj` - a key present with a
    # None value would slip past that check and reach the filler as None. Drop
    # the None-valued keys so the real gate sees them as missing.
    return {k: v for k, v in proj.items() if v is not None}


# ============================================================================
# One job
# ============================================================================

def _ts():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def gather(client, job, work):
    """Downloads/reads everything for one job into `work`. Returns the kwargs
    for build_submission_pack() plus the path of the confirmed pack.yaml."""
    tender = (client.select("tenders", {"id": job["tender_id"]}) or [None])[0]
    if not tender:
        raise ValueError("tender not found")
    company = (client.select("companies", {"id": job["company_id"]}) or [None])[0]
    if not company:
        raise ValueError("company not found")
    pack_rows = client.select("tender_packs", {"id": job["tender_pack_id"]})
    if not pack_rows or pack_rows[0]["company_id"] != job["company_id"]:
        raise ValueError("tender pack not found for this company")
    tender_pack = pack_rows[0]

    # Blank SANRAL templates for this tender.
    docs = {d["doc_type"]: d["storage_path"] for d in client.select("tender_documents", {"tender_id": tender["id"]})}
    if "technical_xlsm" not in docs:
        raise ValueError("The blank Technical Submission workbook for this tender has not been uploaded "
                         "(tender_documents.technical_xlsm) - nothing to fill.")
    missing_forms = [t for t in FORM_FILES if t not in docs]
    if missing_forms:
        raise ValueError(f"Blank returnable forms not uploaded for this tender: {', '.join(missing_forms)}")
    tpl_dir = os.path.join(work, "templates")
    technical = client.download("tender-documents", docs["technical_xlsm"], os.path.join(tpl_dir, "technical.xlsm"))
    financial = (client.download("tender-documents", docs["financial_xlsm"], os.path.join(tpl_dir, "financial.xlsm"))
                 if "financial_xlsm" in docs else None)
    forms_dir = os.path.join(tpl_dir, "forms")
    for doc_type, fname in FORM_FILES.items():
        client.download("tender-documents", docs[doc_type], os.path.join(forms_dir, fname))

    # Confirmed positions vs. what the template's own SETUP sheet requires.
    assignments = client.select("tender_pack_assignments", {"tender_pack_id": tender_pack["id"]})
    required, _alts = read_required_positions(Workbook(technical))
    by_code = {a["position_code"]: a for a in assignments}
    unassigned = [p["code"] for p in required if not (by_code.get(p["code"]) or {}).get("confirmed_person_id")]
    if unassigned:
        raise ValueError(f"No confirmed key person for position(s) {', '.join(unassigned)} required on this "
                         "tender's SETUP sheet - confirm one for each before generating the pack.")

    # People: the signatory first (fill_docx_forms.py / fill_a_forms.py read
    # key_people[0] as the signatory), then every confirmed key person.
    signatories = [p for p in client.select("people", {"company_id": company["id"],
                                                       "signatory_capacity": NOT_NULL}, order="created_at.asc")]
    if not signatories:
        raise ValueError("No person at this company has a signatory capacity set (People page) - the "
                         "Form of Offer, A-Forms and authority letter need a named signatory.")
    person_ids = [signatories[0]["id"]] + [by_code[p["code"]]["confirmed_person_id"] for p in required]
    person_ids = list(dict.fromkeys(person_ids))
    people = {r["id"]: r for r in client.select("people", {"id": person_ids})}
    projects = client.select("projects", {"person_id": person_ids}, order="end_date.desc.nullslast")
    key_people, index_of = [], {}
    for pid in person_ids:
        prj = [p for p in projects if p["person_id"] == pid]
        index_of[pid] = len(key_people)
        key_people.append(adapt_person(people[pid], prj))

    # Which actual key_people entry holds the PL and which holds the DS -
    # fill_docx_forms.py's C.1.2.3 key-person table rows need this; the
    # signatory above is a separate person whenever the company's signatory
    # isn't also tendered for a position (any company bigger than a
    # one-person consultancy). Keyed by base position code ("DS1" -> "DS")
    # so the one Design Specialist row matches whichever DS slot the
    # template asks for; first match wins if a tender ever asks for more
    # than one DS position (Conventional Book 1 templates seen so far ask
    # for exactly one).
    role_people = {}
    for p in required:
        base = re.sub(r"\d+$", "", p["code"].strip().upper())
        role_people.setdefault(base, key_people[index_of[by_code[p["code"]]["confirmed_person_id"]]])
    profile = {"company": adapt_company(company), "key_people": key_people, "role_people": role_people}

    # pack.yaml via confirm_pack.py's own confirm(), so its gates still apply.
    dp = os.path.join(work, "data_pack")
    os.makedirs(dp, exist_ok=True)
    gate_profile = {"company": profile["company"],
                    "key_people": [dict(kp, projects=[_strip_nulls_for_confirm(x) for x in kp["projects"]])
                                   for kp in key_people]}
    profile_path = os.path.join(dp, "profile.json")
    json.dump(gate_profile, open(profile_path, "w"), indent=2, default=str)
    closing = (tender.get("closing_date") or "")[:10]
    if not closing:
        raise ValueError("tender has no closing date - years of experience can't be computed")
    sugg_path = os.path.join(dp, "pack_suggestions.json")
    json.dump({"contract_no": tender.get("contract_no"), "closing_date": closing, "positions": {
        code: {"candidates": [{"person_id": f"person_{index_of[a['confirmed_person_id']]}",
                               "name": people[a["confirmed_person_id"]]["name"],
                               "specialism_warning": bool(a.get("specialism_warning"))}]}
        for code, a in by_code.items() if a.get("confirmed_person_id")}}, open(sugg_path, "w"), indent=2)
    sel_path = os.path.join(dp, "pack_selections.yaml")
    yaml.safe_dump({
        "contract_no": tender.get("contract_no"),
        "confirmed_by": f"Tender Workspace (tender pack {tender_pack['id']}, confirmed by user "
                        f"{tender_pack.get('confirmed_by') or 'not recorded'})",
        "confirmed_date": (tender_pack.get("confirmed_at") or job.get("requested_at") or _ts())[:10],
        "selections": {p["code"]: {
            "suggested_person": (f"person_{index_of[by_code[p['code']]['suggested_person_id']]}"
                                 if by_code[p["code"]].get("suggested_person_id") in index_of else None),
            "confirmed_person": f"person_{index_of[by_code[p['code']]['confirmed_person_id']]}"}
            for p in required},
    }, open(sel_path, "w"), sort_keys=False)
    pack_path = os.path.join(dp, "pack.yaml")
    confirm_pack.confirm(sugg_path, sel_path, profile_path, pack_path)

    # Vault documents.
    vault = {}
    if job.get("include_vault_documents", True):
        for key, (path_col, exp_col) in VAULT_COLUMNS.items():
            sp = company.get(path_col)
            if sp:
                local = client.download("company-documents", sp, os.path.join(work, "vault", key + "_" + os.path.basename(sp)))
                vault[key] = {"path": local, "expiry": company.get(exp_col)}

    # CVs: newest ready generated CV for the position, else the newest as-is upload.
    cvs = {}
    if job.get("include_cvs", True):
        gen = client.select("generated_cvs", {"tender_id": tender["id"], "company_id": company["id"],
                                              "status": "ready"}, order="completed_at.desc.nullslast")
        uploads = client.select("cv_uploads", {"person_id": person_ids, "mode": "as_is"}, order="created_at.desc")
        for p in required:
            pid = by_code[p["code"]]["confirmed_person_id"]
            name = people[pid]["name"]
            g = next((g for g in gen if g["position_code"] == p["code"] and g["person_id"] == pid
                      and g.get("storage_path_pdf")), None)
            u = next((u for u in uploads if u["person_id"] == pid), None)
            if g:
                local = client.download("cv-documents", g["storage_path_pdf"],
                                        os.path.join(work, "cvs", p["code"], os.path.basename(g["storage_path_pdf"])))
                cvs[p["code"]] = {"path": local, "person": name,
                                  "source": f"generated {g['format']}/{g['detail']}, tender-specific"}
            elif u:
                local = client.download("cv-documents", u["storage_path"],
                                        os.path.join(work, "cvs", p["code"], os.path.basename(u["original_filename"])))
                cvs[p["code"]] = {"path": local, "person": name, "source": "uploaded CV, used as-is"}
            else:
                cvs[p["code"]] = {"reason": f"no ready tender CV and no as-is CV upload for {name}"}

    # Hours only from a complete human capture (financial_captures, 0001).
    hours = None
    cap = client.select("financial_captures", {"company_id": company["id"], "tender_id": tender["id"]})
    if cap and cap[0].get("status") == "complete" and (cap[0].get("raw_capture") or {}).get("hours"):
        hours = {"hours": cap[0]["raw_capture"]["hours"]}

    logo = None
    if company.get("logo_storage_path"):
        try:
            logo = client.download("company-documents", company["logo_storage_path"],
                                   os.path.join(work, "logo", os.path.basename(company["logo_storage_path"])))
        except RuntimeError:
            logo = None

    closing_time = None
    if tender.get("closing_date") and "T" in tender["closing_date"]:
        dt = datetime.datetime.fromisoformat(tender["closing_date"].replace("Z", "+00:00"))
        sast = dt.astimezone(datetime.timezone(datetime.timedelta(hours=2)))
        closing, closing_time = sast.date().isoformat(), sast.strftime("%H:%M")

    return dict(
        profile=profile, pack_yaml=pack_path, technical_tpl=technical, forms_dir=forms_dir,
        tender={"contract_no": tender.get("contract_no"), "nra_reference": tender.get("nra_reference"),
                "description": tender.get("description"), "closing_date": closing, "closing_time": closing_time},
        financial_tpl=financial, financial_hours_capture=hours, logo_path=logo,
        vault_docs=vault, cv_docs=cvs,
    )


def process_job(client, job, work_root, keep=False):
    claimed = client.update("pack_generation_jobs", {"id": job["id"], "status": "requested"},
                            {"status": "generating", "started_at": _ts(), "error_message": None})
    if not claimed:
        print(f"[skip] {job['id']}: already claimed by another worker")
        return None
    work = tempfile.mkdtemp(prefix=f"pack_{job['id'][:8]}_", dir=work_root)
    try:
        kwargs = gather(client, job, work)
        pdf, manifest = build_submission_pack(work_dir=os.path.join(work, "pack"), **kwargs)
        problems = verify_pack(pdf, manifest)
        if problems:
            raise RuntimeError("merged PDF failed its read-back check: " + "; ".join(problems[:5]))
        fin_problems = verify_pack(manifest["outputs"]["financial_pdf"], manifest["financial"])
        if fin_problems:
            raise RuntimeError("Envelope 2 (Financial) PDF failed its read-back check: "
                               + "; ".join(fin_problems[:5]))

        prefix = f"{job['company_id']}/tenders/{job['tender_id']}/{job['id']}"
        outputs = manifest.pop("outputs")
        manifest_path = os.path.join(work, "pack", "pack_manifest.json")
        json.dump(manifest, open(manifest_path, "w"), indent=2, default=str)
        uploaded = {}
        for key, local in list(outputs.items()) + [("manifest", manifest_path)]:
            if not local or not os.path.exists(local):
                continue
            remote = f"{prefix}/{os.path.basename(local)}"
            client.upload("submission-packs", remote, local,
                          CONTENT_TYPES.get(os.path.splitext(local)[1], "application/octet-stream"))
            uploaded[key] = remote
        pdf_remote = uploaded.pop("pdf")
        client.update("pack_generation_jobs", {"id": job["id"]}, {
            "status": "ready", "storage_path_pdf": pdf_remote, "output_files": uploaded,
            "page_count": manifest["page_count"], "manifest": manifest, "completed_at": _ts(),
        })
        print(f"[ready] {job['id']}: {manifest['page_count']} pages, {len(manifest['sections'])} sections, "
              f"{len(manifest['omitted'])} not included -> {pdf_remote}; Envelope 2: "
              f"{manifest['financial']['page_count']} pages -> {uploaded.get('financial_pdf')}")
        return manifest
    except Exception as e:
        msg = f"{type(e).__name__}: {e}" if not isinstance(e, ValueError) else str(e)
        client.update("pack_generation_jobs", {"id": job["id"]},
                      {"status": "failed", "error_message": msg[:2000], "completed_at": _ts()})
        print(f"[failed] {job['id']}: {msg}")
        return None
    finally:
        if not keep:
            shutil.rmtree(work, ignore_errors=True)


STALE_AFTER_MINUTES = 60  # a pack takes about a minute; run_bridges.py kills a bridge pass after 30


def fail_stale_jobs(client, now=None):
    """A worker killed mid-job (OOM, host crash) leaves its row in
    'generating' forever (System-Status Gap #11). started_at makes that
    detectable here: after STALE_AFTER_MINUTES the row is marked 'failed'
    with a plain reason, so the Tender Workspace stops showing "Generating…"
    and the user can request again. Deliberately not re-queued: a job that
    crashed the worker once would crash it again in a loop."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    cutoff = now - datetime.timedelta(minutes=STALE_AFTER_MINUTES)
    for job in client.select("pack_generation_jobs", {"status": "generating", "engine": ENGINE}):
        started = job.get("started_at")
        if started and datetime.datetime.fromisoformat(started.replace("Z", "+00:00")) < cutoff:
            client.update("pack_generation_jobs", {"id": job["id"], "status": "generating"}, {
                "status": "failed", "completed_at": _ts(),
                "error_message": f"The pack builder stopped mid-job (no result after {STALE_AFTER_MINUTES} "
                                 "minutes). Nothing was produced - request the pack again."})
            print(f"[failed] {job['id']}: stale 'generating' since {started}")


def _managerial(v):
    s = str(v or "").strip().lower().replace("-", "").replace(" ", "")
    return s in ("man", "managerial", "yes", "y")


def sync_tender_requirements(client, work_root):
    """tender_requirements from each uploaded blank Technical workbook's own
    SETUP sheet, for tenders that have none yet (see module docstring).
    Primary positions and their ALT slots, with SETUP's own description and
    Man/Non-Man flag. Returns {tender_id: [codes]} for what it wrote. A
    workbook that can't be read is reported and skipped - it never stops the
    pack jobs below."""
    written = {}
    docs = client.select("tender_documents", {"doc_type": "technical_xlsm"})
    if not docs:
        return written
    have = {r["tender_id"] for r in client.select("tender_requirements", {"tender_id": [d["tender_id"] for d in docs]})}
    for d in docs:
        if d["tender_id"] in have:
            continue
        local = os.path.join(work_root, "requirements", d["tender_id"], "technical.xlsm")
        try:
            client.download("tender-documents", d["storage_path"], local)
            primary, alternates = read_required_positions(Workbook(local))
            rows = [(p, False) for p in primary] + [(a, True) for alts in alternates.values() for a in alts[:1]]
            for p, alt in rows:
                client.insert("tender_requirements", {
                    "tender_id": d["tender_id"], "position_code": p["code"],
                    "position_description": (str(p["description"]).strip() or None) if p.get("description") else None,
                    "managerial": _managerial(p.get("managerial")), "is_alternate": alt})
            written[d["tender_id"]] = [p["code"] for p, alt in rows if not alt]
            print(f"[requirements] tender {d['tender_id']}: {len(primary)} position(s) from SETUP "
                  f"({', '.join(written[d['tender_id']])}), {len(rows) - len(primary)} ALT")
        except Exception as e:
            print(f"[requirements] tender {d['tender_id']}: could not read the uploaded Technical workbook's "
                  f"SETUP sheet ({type(e).__name__}: {e})")
        finally:
            shutil.rmtree(os.path.dirname(local), ignore_errors=True)
    return written


def process_pending(client, work_root, keep=False, quiet_when_empty=False):
    os.makedirs(work_root, exist_ok=True)
    fail_stale_jobs(client)
    sync_tender_requirements(client, work_root)
    jobs = client.select("pack_generation_jobs", {"status": "requested", "engine": ENGINE}, order="requested_at.asc")
    if not jobs and not quiet_when_empty:
        print("No pending pack_generation_jobs.")
    for job in jobs:
        process_job(client, job, work_root, keep)
    return len(jobs)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true",
                      help="process pending jobs once and exit (the default; kept as an explicit flag)")
    mode.add_argument("--loop", "--daemon", dest="loop", action="store_true",
                      help="keep polling for requested jobs until stopped (always-on worker mode)")
    ap.add_argument("--interval", type=int, default=DEFAULT_INTERVAL_SECONDS,
                    help=f"seconds between polls in --loop mode (default {DEFAULT_INTERVAL_SECONDS})")
    ap.add_argument("--max-cycles", type=int, default=None, help="--loop mode only: stop after this many polls")
    ap.add_argument("--work-dir", default=DEFAULT_WORK_DIR)
    ap.add_argument("--keep", action="store_true", help="keep each job's working files (debugging)")
    args = ap.parse_args()
    if args.interval <= 0:
        ap.error("--interval must be a positive number of seconds")

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
              "(see app/.env.local.example) before running this.")
        sys.exit(1)
    client = SupabaseRest(url, key)
    if not args.loop:
        process_pending(client, args.work_dir, args.keep)
        return
    poll_forever(lambda: process_pending(client, args.work_dir, args.keep, quiet_when_empty=True),
                 interval=args.interval, max_cycles=args.max_cycles, name="process_pack_jobs")


if __name__ == "__main__":
    main()
