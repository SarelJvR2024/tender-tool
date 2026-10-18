"""
Cross-tenant isolation checks (POPIA / "no data visible between customers"
audit, 2026-10-17 - docs/specs/POPIA-Security-Audit.md).

Two layers, because the daily-digest leak found earlier was in the second one:

Part 1 (always, no database): the SERVICE-ROLE bridges. They bypass RLS by
design, so every query they make has to be scoped to the job's own company by
hand. Each case below builds two companies (A = the attacker / the tenant
whose job runs, B = the victim) in an in-memory store and drives the bridge's
real code:

  pack_confirmed_person   A's SANRAL pack has B's person as a confirmed key
                          person (a client can write any people.id into
                          tender_pack_assignments.confirmed_person_id - RLS
                          only checks the pack). Before: B's person (ID
                          number, phone, projects, as-is CV file) went into
                          A's pack. Now: the job fails, nothing of B's read.
  pack_vault_path         A points its own vault column at a file under B's
                          storage prefix. Before: the bridge downloaded B's
                          document into A's pack. Now: refused.
  pack_injected_upload    A inserts an as-is cv_uploads row (company A) for
                          B's person. Before: B's OWN pack bound A's file in
                          as that person's CV. Now: only B's own uploads.
  cv_job_other_person     A queues generated_cvs for B's person. Before: the
                          CV bridge built B's person's CV into A's folder.
                          Now: refused.
  cv_extract_path         A's ai_extract upload points at B's CV file. Before:
                          the extraction bridge downloaded B's CV (and would
                          have sent it to the AI and shown the result to A).
                          Now: refused before any download.
  general_cv_and_vault    general (non-SANRAL) pack: an as-is CV A injected for
                          B's person, and a vault path pointing at B's folder.
  general_provenance      A's general job names B's tender_pack_id; the
                          field-provenance rows must go to A's own pack.

Part 2 (with TENANT_PSQL set - a scratch Postgres with every migration
replayed): the DATABASE layer, as a signed-in member of company A under real
RLS (`set role authenticated` + auth.uid()). For every tenant-scoped table:
B's rows are invisible, can't be updated or deleted, and A can't insert a row
for B. Every storage bucket: B's prefix unreadable and unwritable. Private
tenders. And the cross-company references / storage-path columns / shared
template replacement / admin console that the fixes close.

    python3 engine/security/test_tenant_isolation.py
    TENANT_PSQL="psql -h /tmp/sock -p 54499 -U postgres -d audit" python3 engine/security/test_tenant_isolation.py
"""
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(ENGINE, ".."))
for p in (os.path.join(ENGINE, "pack"), os.path.join(ENGINE, "general"), os.path.join(ENGINE, "cv"),
          os.path.join(ENGINE, "discovery"), ENGINE):
    if p not in sys.path:
        sys.path.insert(0, p)

FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


# ---------------------------------------------------------------------------
# Part 1: in-memory store with the select/insert/update/download/upload slice
# the bridges use (same call shapes as process_pack_jobs.SupabaseRest and
# process_general_jobs' client).
# ---------------------------------------------------------------------------

class Store:
    def __init__(self, not_null):
        self.tables, self.objects, self.downloads, self.writes = {}, {}, [], []
        self.not_null = not_null

    def add(self, table, **row):
        row.setdefault("id", str(uuid.uuid4()))
        self.tables.setdefault(table, []).append(row)
        return row

    def _match(self, row, filters):
        for k, v in (filters or {}).items():
            if v is self.not_null:
                if row.get(k) is None:
                    return False
            elif isinstance(v, (list, tuple)):
                if str(row.get(k)) not in {str(x) for x in v}:
                    return False
            elif str(row.get(k)).lower() != str(v).lower():
                return False
        return True

    def select(self, table, filters=None, order=None):
        rows = [dict(r) for r in self.tables.get(table, []) if self._match(r, filters)]
        if order:
            col, *rest = order.split(".")
            rows.sort(key=lambda r: (r.get(col) is None, str(r.get(col) or "")), reverse="desc" in rest)
        return rows

    def insert(self, table, row):
        self.writes.append(("insert", table, row))
        return self.add(table, **row)

    def update(self, table, filters, body):
        self.writes.append(("update", table, filters, body))
        out = []
        for r in self.tables.get(table, []):
            if self._match(r, filters):
                r.update(body)
                out.append(dict(r))
        return out

    def upsert(self, table, rows, on_conflict):
        self.writes.append(("upsert", table, rows))
        return rows

    def delete(self, table, filters):
        self.writes.append(("delete", table, filters))

    def download(self, bucket, path, dest):
        self.downloads.append((bucket, path))
        key = f"{bucket}/{path}"
        if key not in self.objects:
            raise RuntimeError(f"storage object not found: {key}")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(self.objects[key])
        return dest

    def upload(self, bucket, path, local, content_type=None):
        self.objects[f"{bucket}/{path}"] = open(local, "rb").read()

    def put(self, bucket, path, data):
        self.objects[f"{bucket}/{path}"] = data
        return path


B_ID_NUMBER = "8001015009087"          # synthetic, checksum-shaped - victim's ID number
B_CV_BYTES = b"%PDF-1.4 VICTIM-B-CV-CONTENT"
B_VAULT_BYTES = b"%PDF-1.4 VICTIM-B-TAX-CLEARANCE"
A_EVIL_BYTES = b"%PDF-1.4 ATTACKER-A-FILE"


def two_companies(store):
    a = store.add("companies", legal_name="Attacker A (Pty) Ltd")
    b = store.add("companies", legal_name="Victim B (Pty) Ltd")
    a_person = store.add("people", company_id=a["id"], name="Alice Attacker", id_number="7001015009081",
                         signatory_capacity="Director", created_at="2026-01-01")
    b_person = store.add("people", company_id=b["id"], name="Victor Victim", id_number=B_ID_NUMBER,
                         phone="082 000 0000", signatory_capacity="Director", created_at="2026-01-01")
    store.add("projects", company_id=b["id"], person_id=b_person["id"], client_and_number="VICTIM PROJECT 1",
              end_date="2025-01-01")
    b_cv = store.put("cv-documents", f"{b['id']}/people/{b_person['id']}/uploads/victim_cv.pdf", B_CV_BYTES)
    store.add("cv_uploads", company_id=b["id"], person_id=b_person["id"], mode="as_is", storage_path=b_cv,
              original_filename="victim_cv.pdf", created_at="2026-01-02")
    store.put("company-documents", f"{b['id']}/vault/sars/victim_tcs.pdf", B_VAULT_BYTES)
    return a, b, a_person, b_person


def leaked_anywhere(root, needles):
    hits = []
    for dirpath, _, files in os.walk(root):
        for fn in files:
            data = open(os.path.join(dirpath, fn), "rb").read()
            for n in needles:
                if n in data:
                    hits.append((fn, n[:30]))
    return hits


R396_TECH = os.path.join(ROOT, "templates", "samples", "R.396-010-2025.1F_ran.xlsm")
FORM_SOURCES = (("a_forms", "A_Forms.docx"), ("c111_form_of_offer", "C.1.1.1_Form_of_Offer.docx"),
                ("c123_contract_data", "C.1.2.3_Contract_Data.docx"))


def add_templates(store, t, company_id=None, technical=None, tag="t"):
    """The tender's 5-file template set as tender_documents rows. company_id
    None = the shared copy (registered by the service role from the buyer's
    published documents); otherwise that company's own upload (0045). The
    path is the pre-0045 one (<tender>/<type>/...) either way: a company row
    with that path is what an upload made before 0045 becomes."""
    tech_bytes = open(technical or R396_TECH, "rb").read()
    rows = [("technical_xlsm", f"{tag}.xlsm", tech_bytes)] + [
        (dt, f"{tag}_{fn}", open(os.path.join(ROOT, "templates", "forms", "R.396-010-2025.1F", fn), "rb").read())
        for dt, fn in FORM_SOURCES]
    for doc_type, fn, data in rows:
        path = f"{t['id']}/{doc_type}/{fn}"
        store.put("tender-documents", path, data)
        store.add("tender_documents", tender_id=t["id"], doc_type=doc_type, storage_path=path,
                  company_id=company_id, uploaded_by_company=company_id)
    return [f"{t['id']}/{doc_type}/{fn}" for doc_type, fn, _ in rows]


def sanral_tender(store, company_ids, templates=True):
    t = store.add("tenders", contract_no="R.396-010-2025/1F", closing_date="2026-12-15T12:00:00+02:00",
                  family="Conventional Consultant Tender", owner_company_id=None)
    if templates:
        add_templates(store, t)
    return t


# A company's own data as fill_conventional.py writes it into the Technical
# workbook - used to make "company A's filled-in workbook" for real, with the
# real filler, rather than by poking strings into cells.
def fill_person_data(name, id_number, n_projects, sacpcmp, tag):
    return {"name": name, "id_number": id_number, "description": "",
            "employment": "Key Person is a full time employee of the tenderer",
            "qualifications": {"ecsa_level": "Professional Engineer", "ecsa_number": f"{tag}-ECSA-1", "ecsa_date": "2012-01-01",
                               "sacpcmp_number": sacpcmp, "sacpcmp_date": "2015-01-01" if sacpcmp else None,
                               "highest_level": "Masters Degree", "highest_description": f"{tag} MEng",
                               "highest_institution": f"{tag} University", "highest_graduated": "2012-01-01",
                               "initial_description": f"{tag} BEng", "initial_institution": f"{tag} University",
                               "initial_graduated": "2008-01-01", "years_experience": 15},
            "projects": [{"client_and_number": f"{tag} CLIENT PROJECT {i}", "client_type": "Provincial Authority",
                          "project_type": "DS", "start": "2019-01-01", "end": "2021-12-31", "value_rm": 80,
                          "position_held": f"{tag} role {i}", "position_code": "DS", "contact": f"{tag} Referee {i}",
                          "contact_number": f"{tag}-082-555-000{i}"} for i in range(1, n_projects + 1)]}


def fill_technical(tpl, company_name, person, out):
    import yaml
    import fill_conventional
    from sanral_fill import Workbook
    from suggest_pack import read_required_positions
    primary, _ = read_required_positions(Workbook(tpl))
    pack_path = out + ".pack.yaml"
    yaml.safe_dump({"company": {"name": company_name, "bee_level": 1, "black_ownership_pct": 100, "status": "QSE",
                                "head_office": f"{company_name} HQ", "other_offices": 1, "ecsa_registered": 6,
                                "sacpcmp_registered": 2, "total_employees": 20, "jv_share_pct": 100},
                    "tender": {}, "people": {"p": person},
                    "key_persons": [{"position": p["code"], "person": "p"} for p in primary]}, open(pack_path, "w"))
    import contextlib
    import io
    with contextlib.redirect_stdout(io.StringIO()):
        fill_conventional.main(tpl, pack_path, out)
    return out


def xlsm_text(path):
    import zipfile
    with zipfile.ZipFile(path) as z:
        return b"".join(z.read(n) for n in z.namelist() if n.endswith(".xml"))


A_FILLED_MARKERS = [b"ALICE ACO", b"8501015800088", b"ACO CLIENT PROJECT 2", b"ACO CLIENT PROJECT 3",
                    b"ACO Referee 3", b"ACO-082-555-0003", b"ACO-SACPCMP-77", b"ACO Engineering"]


def run_gather(bridge, store, job):
    """gather() up to (and including) the CV/vault downloads. confirm_pack's
    own gate is stubbed out: the question here is only whose rows the bridge
    READS, not whether the synthetic people would pass SANRAL's checks."""
    import confirm_pack
    real = confirm_pack.confirm
    confirm_pack.confirm = lambda s, sel, prof, out: open(out, "w").write("stub: true\n")
    work = tempfile.mkdtemp(prefix="tenant_iso_")
    try:
        return bridge.gather(store, job, work), None, work
    except Exception as e:  # noqa: BLE001 - the refusal is the expected outcome
        return None, e, work
    finally:
        confirm_pack.confirm = real


def part1():
    import process_pack_jobs as bridge

    print("\n[1] SANRAL pack: another company's person confirmed on A's pack")
    s = Store(bridge.NOT_NULL)
    a, b, a_person, b_person = two_companies(s)
    t = sanral_tender(s, [a["id"]])
    pack = s.add("tender_packs", company_id=a["id"], tender_id=t["id"])
    s.add("tender_pack_assignments", tender_pack_id=pack["id"], position_code="PL", confirmed_person_id=a_person["id"])
    s.add("tender_pack_assignments", tender_pack_id=pack["id"], position_code="DS1", confirmed_person_id=b_person["id"])
    job = {"id": str(uuid.uuid4()), "company_id": a["id"], "tender_id": t["id"], "tender_pack_id": pack["id"],
           "include_vault_documents": True, "include_cvs": True}
    out, err, work = run_gather(bridge, s, job)
    names = [kp["name"] for kp in (out or {}).get("profile", {}).get("key_people", [])]
    check(out is None and err is not None, f"job refused (got: {type(err).__name__ if err else 'built'}: {str(err)[:140]})")
    check("Victor Victim" not in names, f"B's person not in A's profile (key people: {names})")
    check(not any(p.startswith(b["id"]) for _, p in s.downloads), f"nothing downloaded from B's storage ({[p for _, p in s.downloads if p.startswith(b['id'])]})")
    hits = leaked_anywhere(work, [B_ID_NUMBER.encode(), B_CV_BYTES])
    check(not hits, f"B's ID number / CV bytes nowhere in A's job folder ({hits})")
    shutil.rmtree(work, ignore_errors=True)

    print("\n[2] SANRAL pack: A's vault column points at B's storage")
    s = Store(bridge.NOT_NULL)
    a, b, a_person, b_person = two_companies(s)
    t = sanral_tender(s, [a["id"]])
    s.tables["companies"][0]["sars_tcs_pin_document_path"] = f"{b['id']}/vault/sars/victim_tcs.pdf"
    pack = s.add("tender_packs", company_id=a["id"], tender_id=t["id"])
    for code in ("PL", "DS1"):
        s.add("tender_pack_assignments", tender_pack_id=pack["id"], position_code=code, confirmed_person_id=a_person["id"])
    job = {"id": str(uuid.uuid4()), "company_id": a["id"], "tender_id": t["id"], "tender_pack_id": pack["id"],
           "include_vault_documents": True, "include_cvs": True}
    out, err, work = run_gather(bridge, s, job)
    check(("company-documents", f"{b['id']}/vault/sars/victim_tcs.pdf") not in s.downloads,
          "B's vault document NOT downloaded by A's job")
    check(not leaked_anywhere(work, [B_VAULT_BYTES]), "B's vault bytes nowhere in A's job folder")
    check(err is not None and "folder" in str(err), f"job refused with a reason ({str(err)[:140] if err else 'built'})")
    shutil.rmtree(work, ignore_errors=True)

    print("\n[3] SANRAL pack: A injected an as-is CV for B's person into B's pack")
    s = Store(bridge.NOT_NULL)
    a, b, a_person, b_person = two_companies(s)
    t = sanral_tender(s, [b["id"]])
    evil = s.put("cv-documents", f"{a['id']}/people/{b_person['id']}/uploads/evil.pdf", A_EVIL_BYTES)
    s.add("cv_uploads", company_id=a["id"], person_id=b_person["id"], mode="as_is", storage_path=evil,
          original_filename="evil.pdf", created_at="2026-09-01")  # newer than B's own
    pack = s.add("tender_packs", company_id=b["id"], tender_id=t["id"])
    for code in ("PL", "DS1"):
        s.add("tender_pack_assignments", tender_pack_id=pack["id"], position_code=code, confirmed_person_id=b_person["id"])
    job = {"id": str(uuid.uuid4()), "company_id": b["id"], "tender_id": t["id"], "tender_pack_id": pack["id"],
           "include_vault_documents": True, "include_cvs": True}
    out, err, work = run_gather(bridge, s, job)
    check(out is not None, f"B's own pack still builds ({err})")
    cv_files = [open(c["path"], "rb").read() for c in ((out or {}).get("cv_docs") or {}).values() if c.get("path")]
    check(cv_files and all(c == B_CV_BYTES for c in cv_files), "B's pack binds B's own CV upload, not A's injected file")
    check(not leaked_anywhere(work, [A_EVIL_BYTES]), "A's injected file nowhere in B's job folder")
    shutil.rmtree(work, ignore_errors=True)

    print("\n[4] CV bridge: A requests a CV for B's person")
    import process_cv_jobs as cvb
    s = Store(bridge.NOT_NULL)
    a, b, a_person, b_person = two_companies(s)
    real_req = cvb.supabase_request
    cvb.supabase_request = fake_rest(s)
    try:
        job = {"id": str(uuid.uuid4()), "company_id": a["id"], "person_id": b_person["id"], "tender_id": None,
               "format": "sanral_keyperson", "detail": "summary"}
        try:
            profile, _ = cvb.fetch_job_context("http://x", "k", job)
            err = None
        except Exception as e:  # noqa: BLE001
            profile, err = None, e
    finally:
        cvb.supabase_request = real_req
    got = [kp.get("name") for kp in (profile or {}).get("key_people", [])]
    check(profile is None and err is not None, f"refused (got key people {got}; {str(err)[:120] if err else ''})")
    check(B_ID_NUMBER not in json.dumps(profile or {}), "B's ID number not in A's CV profile")

    print("\n[5] CV extraction: A's upload row points at B's CV file")
    import extract_cv_fields as ex
    s = Store(bridge.NOT_NULL)
    a, b, a_person, b_person = two_companies(s)
    b_path = s.tables["cv_uploads"][0]["storage_path"]
    up = s.add("cv_uploads", company_id=a["id"], person_id=a_person["id"], mode="ai_extract", status="extraction_requested",
               storage_path=b_path, original_filename="mine.pdf")
    real = (ex.supabase_request, ex.storage_download, ex.extract_from_file)
    fetched = []

    def fake_download(url, key, bucket, path, dest):
        fetched.append(path)
        open(dest, "wb").write(s.objects[f"{bucket}/{path}"])

    ex.supabase_request = fake_rest(s)
    ex.storage_download = fake_download
    ex.extract_from_file = lambda local, wd, client=None: ({"person": {}, "projects": []}, [], {"text_method": "stub", "source_pages": 1, "source_text_chars": 1})
    try:
        ex.process_upload("http://x", "k", up, client_factory=lambda: object())
    finally:
        ex.supabase_request, ex.storage_download, ex.extract_from_file = real
    check(b_path not in fetched, f"B's CV file not fetched by A's extraction job (fetched: {fetched})")
    row = next(r for r in s.tables["cv_uploads"] if r["id"] == up["id"])
    check(row.get("status") == "extraction_failed", f"A's upload failed with a reason (status {row.get('status')}: {str(row.get('extraction_error'))[:100]})")
    check(not s.tables.get("cv_extraction_results"), "no extraction result written for A")

    print("\n[6] General pack: injected CV for B's person + vault path into B's folder")
    import process_general_jobs as gen
    s = Store(bridge.NOT_NULL)
    a, b, a_person, b_person = two_companies(s)
    t = s.add("tenders", title="General tender", closing_date="2026-12-01", evaluation_rules=None)
    evil = s.put("cv-documents", f"{a['id']}/people/{b_person['id']}/uploads/evil.pdf", A_EVIL_BYTES)
    s.add("cv_uploads", company_id=a["id"], person_id=b_person["id"], mode="as_is", storage_path=evil,
          original_filename="evil.pdf", created_at="2026-09-01")
    s.add("person_role_eligibility", company_id=b["id"], person_id=b_person["id"], role_code="psp.professional_engineer")
    manifest = {"experience_evidence": {}, "roles": [{"role_code": "psp.professional_engineer"}]}
    work = tempfile.mkdtemp(prefix="tenant_iso_gen_")
    try:
        _, _, _, _, _, cvs = gen.gather_pack_inputs(s, {"company_id": b["id"]}, t, manifest, work)
        err = None
    except Exception as e:  # noqa: BLE001
        cvs, err = [], e
    check(err is None, f"B's general pack inputs gathered ({err})")
    cv_bytes = [open(c["path"], "rb").read() for c in cvs if c.get("path")]
    check(cv_bytes == [B_CV_BYTES], f"B's general pack uses B's own CV only ({[x[:30] for x in cv_bytes]})")
    shutil.rmtree(work, ignore_errors=True)

    s.tables["companies"][0]["sars_tcs_pin_document_path"] = f"{b['id']}/vault/sars/victim_tcs.pdf"
    s.downloads.clear()
    work = tempfile.mkdtemp(prefix="tenant_iso_gen_")
    try:
        gen.gather_pack_inputs(s, {"company_id": a["id"]}, t, {"experience_evidence": {}, "roles": []}, work)
        err = None
    except Exception as e:  # noqa: BLE001
        err = e
    check(("company-documents", f"{b['id']}/vault/sars/victim_tcs.pdf") not in s.downloads,
          "A's general pack did NOT download B's vault document")
    check(not leaked_anywhere(work, [B_VAULT_BYTES]), "B's vault bytes nowhere in A's general job folder")
    shutil.rmtree(work, ignore_errors=True)

    print("\n[7] General pack: field provenance goes to the job company's own pack")
    s = Store(bridge.NOT_NULL)
    a, b, _, _ = two_companies(s)
    t = s.add("tenders", title="General tender")
    a_pack = s.add("tender_packs", company_id=a["id"], tender_id=t["id"])
    b_pack = s.add("tender_packs", company_id=b["id"], tender_id=t["id"])
    target = gen.provenance_pack_id(s, {"company_id": a["id"], "tender_id": t["id"], "tender_pack_id": b_pack["id"]}) \
        if hasattr(gen, "provenance_pack_id") else b_pack["id"]  # before the fix: job["tender_pack_id"] as given
    check(target == a_pack["id"], f"provenance written to A's own pack (target {'B' if target == b_pack['id'] else target})")

    part1_shared_templates(bridge)


def part1_shared_templates(bridge):
    """The open item the first audit pass left (POPIA-Security-Audit.md,
    "Shared templates"): one company's upload of a tender's "blank" template
    was every company's template. If A uploaded its own filled-in workbook,
    B's pack was built from it."""
    print("\n[16] Shared template: A uploads its own FILLED-IN Technical workbook as the tender's blank template")
    tmp = tempfile.mkdtemp(prefix="tenant_iso_tpl_")
    a_filled = fill_technical(R396_TECH, "ACO Engineering (Pty) Ltd",
                              fill_person_data("ALICE ACO", "8501015800088", 3, "ACO-SACPCMP-77", "ACO"),
                              os.path.join(tmp, "A_filled.xlsm"))
    check(all(m in xlsm_text(a_filled) for m in A_FILLED_MARKERS), "A's filled workbook really holds A's data (real filler)")
    b_person_data = fill_person_data("BOB BCO", "9001015800085", 1, None, "BCO")

    s = Store(bridge.NOT_NULL)
    a, b, a_person, b_person = two_companies(s)
    t = sanral_tender(s, [a["id"], b["id"]], templates=False)
    a_paths = add_templates(s, t, company_id=a["id"], technical=a_filled, tag="a_upload")
    pack = s.add("tender_packs", company_id=b["id"], tender_id=t["id"])
    for code in ("PL", "DS1"):
        s.add("tender_pack_assignments", tender_pack_id=pack["id"], position_code=code, confirmed_person_id=b_person["id"])
    job = {"id": str(uuid.uuid4()), "company_id": b["id"], "tender_id": t["id"], "tender_pack_id": pack["id"],
           "include_vault_documents": True, "include_cvs": True}
    out, err, work = run_gather(bridge, s, job)
    got = [p for _, p in s.downloads if p in a_paths]
    check(not got, f"B's pack job downloaded none of A's uploaded files ({len(got)} downloaded)")
    check(out is None and err is not None and "uploaded" in str(err),
          f"B's job asks B to upload its own templates ({str(err)[:110] if err else 'built from A files'})")
    leaked = []
    if out and out.get("technical_tpl"):
        # What B's pack would have carried: B's real fill on top of the
        # template the bridge picked.
        b_built = fill_technical(out["technical_tpl"], "BCO Consulting (Pty) Ltd", b_person_data, os.path.join(tmp, "B_built.xlsm"))
        leaked = [m.decode() for m in A_FILLED_MARKERS if m in xlsm_text(b_built)]
    check(not leaked, f"none of A's data in B's filled Technical workbook (left over from A: {leaked})")
    shutil.rmtree(work, ignore_errors=True)

    print("\n[16b] The legitimate cases: the buyer's shared template, and each company's own copy")
    shared = add_templates(s, t, company_id=None, tag="buyer")
    s.downloads.clear()
    out, err, work = run_gather(bridge, s, job)
    picked = [p for _, p in s.downloads if p.startswith(t["id"])]
    check(out is not None, f"B builds from the buyer's shared copy ({str(err)[:100] if err else 'ok'})")
    check(picked and all(p in shared for p in picked), f"B read only the shared copy ({sorted(set(picked) - set(shared))})")
    shutil.rmtree(work, ignore_errors=True)

    b_paths = add_templates(s, t, company_id=b["id"], tag="b_upload")
    s.downloads.clear()
    out, err, work = run_gather(bridge, s, job)
    picked = [p for _, p in s.downloads if p.startswith(t["id"])]
    check(out is not None and picked and all(p in b_paths for p in picked),
          f"with its own upload on file B uses exactly that ({[p.split('/')[-1] for p in picked]})")
    shutil.rmtree(work, ignore_errors=True)

    a_pack = s.add("tender_packs", company_id=a["id"], tender_id=t["id"])
    for code in ("PL", "DS1"):
        s.add("tender_pack_assignments", tender_pack_id=a_pack["id"], position_code=code, confirmed_person_id=a_person["id"])
    s.downloads.clear()
    out, err, work = run_gather(bridge, s, {**job, "id": str(uuid.uuid4()), "company_id": a["id"], "tender_pack_id": a_pack["id"]})
    picked = [p for _, p in s.downloads if p.startswith(t["id"])]
    check(out is not None and picked and all(p in a_paths for p in picked),
          f"A's own pack still uses A's own upload ({[p.split('/')[-1] for p in picked]})")
    shutil.rmtree(work, ignore_errors=True)

    print("\n[16c] Positions read from a company's own Technical workbook are that company's")
    s.tables["tender_documents"] = [r for r in s.tables["tender_documents"] if r.get("company_id") is not None]
    s.tables.pop("tender_requirements", None)
    work_root = tempfile.mkdtemp(prefix="tenant_iso_req_")
    bridge.sync_tender_requirements(s, work_root)
    reqs = s.tables.get("tender_requirements", [])
    by_company = {}
    for r in reqs:
        by_company.setdefault(r.get("company_id"), set()).add(r["position_code"])
    check(by_company.get(a["id"]) and by_company.get(b["id"]) and None not in by_company,
          f"one position set per company, none shared ({ {('A' if k == a['id'] else 'B' if k == b['id'] else k): sorted(v) for k, v in by_company.items()} })")
    shutil.rmtree(work_root, ignore_errors=True)
    shutil.rmtree(tmp, ignore_errors=True)


def fake_rest(store):
    """process_cv_jobs.supabase_request(url, key, method, path, body) over the
    in-memory store: GET/PATCH with col=eq.x filters, POST insert/upsert."""
    import urllib.parse

    def req(url, key, method, path, body=None):
        table, _, query = path.partition("?")
        filters = {}
        for k, vs in urllib.parse.parse_qs(query).items():
            if k in ("select", "order", "on_conflict"):
                continue
            v = vs[0]
            if v.startswith("eq."):
                filters[k] = v[3:]
        if method == "GET":
            return store.select(table, filters)
        if method == "PATCH":
            return store.update(table, filters, body or {})
        if method == "POST":
            return [store.insert(table, dict(body or {}))]
        raise RuntimeError(method)
    return req


# ---------------------------------------------------------------------------
# Part 2: real RLS on a replayed schema.
# ---------------------------------------------------------------------------

class Db:
    def __init__(self, cmd):
        self.cmd = shlex.split(cmd)

    def run(self, sql, uid=None):
        """(ok, stdout, stderr). With uid: as that signed-in user under RLS."""
        if uid:
            sql = (f"begin; set local role authenticated; select set_config('test.uid', '{uid}', true);\n"
                   f"{sql};\ncommit;")
        r = subprocess.run(self.cmd + ["-v", "ON_ERROR_STOP=1", "-At", "-q", "-c", sql], capture_output=True, text=True)
        out = "\n".join(l for l in r.stdout.splitlines() if l.strip() and l.strip() != "")
        return r.returncode == 0, out, r.stderr.strip()

    def one(self, sql, uid=None):
        ok, out, err = self.run(sql, uid)
        if not ok:
            raise RuntimeError(err)
        return out.splitlines()[-1] if out else ""


TENANT_TABLES = [  # (table, company column, a column that can be set for an insert/update probe)
    "companies", "company_members", "people", "projects", "tender_packs", "financial_captures",
    "generated_documents", "discovered_opportunities", "cv_uploads", "generated_cvs", "tender_tasks",
    "experience_items", "company_offices", "person_role_eligibility", "pack_generation_jobs", "tender_answers",
    "cv_extraction_results", "tender_private_documents", "tender_comments", "company_document_templates",
    "discovery_seen_releases",
]
CHILD_TABLES = {"tender_pack_assignments": "tender_pack_id", "field_provenance": "tender_pack_id"}
BUCKETS = ["cv-documents", "experience-documents", "company-documents", "submission-packs"]


def seed_db(db):
    ids = {k: str(uuid.uuid4()) for k in ("uA", "uB", "A", "B", "pA", "pB", "tS", "tPB", "packA", "packB",
                                         "packBpriv", "upB", "jobB")}
    i = ids
    db.one(f"""
insert into auth.users (id, email) values ('{i['uA']}', 'a@example.test'), ('{i['uB']}', 'b@example.test');
insert into companies (id, legal_name) values ('{i['A']}', 'Iso A'), ('{i['B']}', 'Iso B');
insert into company_members (company_id, user_id, role) values ('{i['A']}', '{i['uA']}', 'owner'), ('{i['B']}', '{i['uB']}', 'owner');
insert into people (id, company_id, name, id_number) values ('{i['pA']}', '{i['A']}', 'Alice', '7001015009081'),
  ('{i['pB']}', '{i['B']}', 'Victor', '{B_ID_NUMBER}');
insert into projects (company_id, person_id, client_and_number) values ('{i['B']}', '{i['pB']}', 'B project');
insert into tenders (id, slug, contract_no, title, closing_date, family) values
  ('{i['tS']}', 'iso-shared-{i['tS'][:8]}', 'ISO-SHARED', 'Shared tender', now() + interval '30 days', 'Conventional Consultant Tender');
insert into tenders (id, slug, title, source, owner_company_id, closing_date) values
  ('{i['tPB']}', 'manual-{i['tPB']}', 'B private', 'manual', '{i['B']}', now() + interval '30 days');
insert into tender_packs (id, company_id, tender_id) values ('{i['packA']}', '{i['A']}', '{i['tS']}'),
  ('{i['packB']}', '{i['B']}', '{i['tS']}'), ('{i['packBpriv']}', '{i['B']}', '{i['tPB']}');
insert into tender_pack_assignments (tender_pack_id, position_code, confirmed_person_id) values ('{i['packB']}', 'PL', '{i['pB']}');
insert into field_provenance (tender_pack_id, field_key, status, source) values ('{i['packB']}', 'x', 'confirmed', 't');
insert into financial_captures (company_id, tender_id) values ('{i['B']}', '{i['tS']}');
insert into generated_documents (company_id, tender_id, doc_type, storage_path) values ('{i['B']}', '{i['tS']}', 'x', '{i['B']}/x.pdf');
insert into discovered_opportunities (company_id, verdict, ocid) values ('{i['B']}', 'possible', 'ocds-iso-{i['B'][:8]}');
insert into cv_uploads (id, company_id, person_id, storage_path, original_filename, mode) values
  ('{i['upB']}', '{i['B']}', '{i['pB']}', '{i['B']}/people/{i['pB']}/uploads/cv.pdf', 'cv.pdf', 'as_is');
insert into generated_cvs (company_id, person_id, format, detail) values ('{i['B']}', '{i['pB']}', 'world_bank', 'summary');
insert into tender_tasks (company_id, tender_id, description) values ('{i['B']}', '{i['tS']}', 'B task');
insert into experience_items (company_id, project_name, document_type) values ('{i['B']}', 'B exp', 'project_record');
insert into company_offices (company_id, province) values ('{i['B']}', 'Gauteng');
insert into person_role_eligibility (company_id, person_id, role_code) values ('{i['B']}', '{i['pB']}', 'sanral.PL');
insert into pack_generation_jobs (id, company_id, tender_id, tender_pack_id) values ('{i['jobB']}', '{i['B']}', '{i['tS']}', '{i['packB']}');
insert into tender_answers (company_id, tender_id, field_key, value) values ('{i['B']}', '{i['tS']}', 'k', 'v');
insert into cv_extraction_results (company_id, person_id, cv_upload_id, proposed) values ('{i['B']}', '{i['pB']}', '{i['upB']}', '{{}}');
insert into tender_private_documents (company_id, tender_id, title, storage_path) values
  ('{i['B']}', '{i['tS']}', 'B private doc', 'private/{i['B']}/{i['tS']}/doc.pdf');
insert into tender_comments (company_id, tender_id, author_id, body) values ('{i['B']}', '{i['tS']}', '{i['uB']}', 'B note');
insert into company_document_templates (company_id, document_type, mode, guideline) values ('{i['B']}', 'authority_to_sign', 'ai_guideline', 'B wording');
insert into discovery_seen_releases (company_id, release_key, verdict) values ('{i['B']}', 'rk-{i['B'][:8]}', 'possible');
insert into tender_requirements (tender_id, position_code) values ('{i['tPB']}', 'PL');
insert into storage.buckets (id, name) values ('cv-documents','cv-documents'), ('experience-documents','experience-documents'),
  ('company-documents','company-documents'), ('submission-packs','submission-packs'), ('tender-documents','tender-documents'),
  ('admin-harness-artifacts','admin-harness-artifacts') on conflict do nothing;
insert into storage.objects (bucket_id, name) values
  ('cv-documents', '{i['B']}/people/{i['pB']}/uploads/cv.pdf'), ('experience-documents', '{i['B']}/experience/e.pdf'),
  ('company-documents', '{i['B']}/vault/sars/t.pdf'), ('submission-packs', '{i['B']}/tenders/{i['tS']}/j/p.pdf'),
  ('tender-documents', 'manual/{i['B']}/{i['tPB']}/b.pdf'), ('tender-documents', 'private/{i['B']}/{i['tS']}/doc.pdf'),
  ('tender-documents', '{i['tPB']}/technical_xlsm/b.xlsm'), ('tender-documents', '{i['tS']}/technical_xlsm/b_upload.xlsm'),
  ('admin-harness-artifacts', 'pack/complete_co/r396/pack.pdf');
insert into tender_documents (tender_id, doc_type, storage_path, uploaded_by, uploaded_by_company{', company_id' if per_company_templates(db) else ''}) values
  ('{i['tS']}', 'technical_xlsm', '{i['tS']}/technical_xlsm/b_upload.xlsm', '{i['uB']}', '{i['B']}'{f", '{i['B']}'" if per_company_templates(db) else ''});
insert into admin_harness_runs (test_company, tender_ref, status) values ('complete_co', 'r396', 'ok');
select 1;""")
    return ids


def tpl_path(company, tender, doc_type, fn):
    """Where the templates card stores a company's own copy since 0045."""
    return f"private/{company}/{tender}/templates/{doc_type}/{fn}"


def per_company_templates(db):
    """0045 applied (tender_documents.company_id). Lets cases 16-17 run on a
    replay that stops before 0045, to show the hole they close."""
    return db.one("select count(*) from information_schema.columns where table_name = 'tender_documents' "
                  "and column_name = 'company_id'") == "1"


def refused(db, sql, uid):
    ok, out, err = db.run(sql, uid)
    return (not ok), (err.splitlines()[0] if err else "NOT refused")


def part2(db):
    i = seed_db(db)
    A, B, uA = i["A"], i["B"], i["uA"]

    print("\n[8] RLS: every tenant table - B's rows invisible / unchangeable to a member of A")
    for t in TENANT_TABLES:
        col = "id" if t == "companies" else "company_id"
        n_total = db.one(f"select count(*) from {t} where {col} = '{B}'")
        n = db.one(f"select count(*) from {t} where {col} = '{B}'", uA)
        check(n_total != "0" and n == "0", f"{t}: B has {n_total} row(s), A sees {n}")
        ok, out, err = db.run(f"with u as (update {t} set {col} = {col} where {col} = '{B}' returning 1) select count(*) from u", uA)
        check((not ok) or out.splitlines()[-1] == "0", f"{t}: A updates 0 of B's rows ({(out.splitlines() or [''])[-1] if ok else 'refused'})")
        ok, out, err = db.run(f"with d as (delete from {t} where {col} = '{B}' returning 1) select count(*) from d", uA)
        check((not ok) or out.splitlines()[-1] == "0", f"{t}: A deletes 0 of B's rows ({(out.splitlines() or [''])[-1] if ok else 'refused'})")
        n_after = db.one(f"select count(*) from {t} where {col} = '{B}'")
        check(n_after == n_total, f"{t}: B's rows intact ({n_after})")
    for t, fk in CHILD_TABLES.items():
        n = db.one(f"select count(*) from {t} where {fk} = '{i['packB']}'", uA)
        check(n == "0", f"{t}: A sees 0 of B's pack's rows ({n})")
        n_after = db.one(f"select count(*) from {t} where {fk} = '{i['packB']}'")
        check(n_after != "0", f"{t}: B's pack rows intact")

    print("\n[9] RLS: inserts INTO company B by a member of A are refused")
    probes = {
        "people": f"insert into people (company_id, name) values ('{B}', 'x')",
        "projects": f"insert into projects (company_id, person_id, client_and_number) values ('{B}', '{i['pB']}', 'x')",
        "tender_packs": f"insert into tender_packs (company_id, tender_id) values ('{B}', '{i['tPB']}')",
        "cv_uploads": f"insert into cv_uploads (company_id, person_id, storage_path, original_filename, mode) values ('{B}', '{i['pB']}', '{B}/x', 'x', 'as_is')",
        "generated_cvs": f"insert into generated_cvs (company_id, person_id, format, detail) values ('{B}', '{i['pB']}', 'world_bank', 'summary')",
        "experience_items": f"insert into experience_items (company_id, project_name, document_type) values ('{B}', 'x', 'other')",
        "pack_generation_jobs": f"insert into pack_generation_jobs (company_id, tender_id, tender_pack_id) values ('{B}', '{i['tS']}', '{i['packB']}')",
        "tender_answers": f"insert into tender_answers (company_id, tender_id, field_key, value) values ('{B}', '{i['tS']}', 'k2', 'v')",
        "tender_comments": f"insert into tender_comments (company_id, tender_id, author_id, body) values ('{B}', '{i['tS']}', '{uA}', 'x')",
        "company_document_templates": f"insert into company_document_templates (company_id, document_type, mode, guideline) values ('{B}', 'cover_letter', 'ai_guideline', 'x')",
        "discovered_opportunities": f"insert into discovered_opportunities (company_id, verdict) values ('{A}', 'possible')",
        "discovery_seen_releases": f"insert into discovery_seen_releases (company_id, release_key, verdict) values ('{A}', 'x', 'possible')",
        "cv_extraction_results": f"insert into cv_extraction_results (company_id, person_id, cv_upload_id, proposed) values ('{A}', '{i['pA']}', '{i['upB']}', '{{}}')",
        "company_members": f"insert into company_members (company_id, user_id) values ('{B}', '{uA}')",
        "tender_pack_assignments": f"insert into tender_pack_assignments (tender_pack_id, position_code) values ('{i['packB']}', 'XX')",
    }
    for t, sql in probes.items():
        bad, why = refused(db, sql, uA)
        check(bad, f"{t}: refused ({why[:90]})")

    print("\n[10] Storage: B's prefix in every bucket is unreadable and unwritable for A")
    for bkt in BUCKETS:
        n = db.one(f"select count(*) from storage.objects where bucket_id = '{bkt}' and name like '{B}/%'", uA)
        check(n == "0", f"{bkt}: A lists 0 of B's objects ({n})")
        bad, why = refused(db, f"insert into storage.objects (bucket_id, name) values ('{bkt}', '{B}/injected.pdf')", uA)
        check(bad, f"{bkt}: A can't write under B's prefix")
    for name in (f"manual/{B}/{i['tPB']}/b.pdf", f"private/{B}/{i['tS']}/doc.pdf", f"{i['tPB']}/technical_xlsm/b.xlsm"):
        n = db.one(f"select count(*) from storage.objects where bucket_id = 'tender-documents' and name = '{name}'", uA)
        check(n == "0", f"tender-documents: A can't read {name.split('/')[0]}/... of B ({n})")
    for name in (f"manual/{B}/{i['tPB']}/x.pdf", f"private/{B}/{i['tS']}/x.pdf", f"{i['tPB']}/technical_xlsm/x.xlsm"):
        bad, _ = refused(db, f"insert into storage.objects (bucket_id, name) values ('tender-documents', '{name}')", uA)
        check(bad, f"tender-documents: A can't write {name.split('/')[0]}/... of B")

    print("\n[11] Private tenders: B's manual tender, its requirements and documents invisible to A")
    for q in (f"select count(*) from tenders where id = '{i['tPB']}'",
              f"select count(*) from tender_requirements where tender_id = '{i['tPB']}'"):
        check(db.one(q, uA) == "0", q.split(" from ")[1][:40] + " -> 0 for A")
    bad, _ = refused(db, f"insert into tender_packs (company_id, tender_id) values ('{A}', '{i['tPB']}')", uA)
    check(bad, "A can't open a pack on B's private tender")

    print("\n[12] Cross-company references and storage paths (the bridge-exfiltration roots)")
    ref_probes = {
        "projects.person_id = B's person": f"insert into projects (company_id, person_id, client_and_number) values ('{A}', '{i['pB']}', 'injected')",
        "cv_uploads.person_id = B's person": f"insert into cv_uploads (company_id, person_id, storage_path, original_filename, mode) values ('{A}', '{i['pB']}', '{A}/people/x/uploads/e.pdf', 'e.pdf', 'as_is')",
        "generated_cvs.person_id = B's person": f"insert into generated_cvs (company_id, person_id, format, detail) values ('{A}', '{i['pB']}', 'world_bank', 'summary')",
        "generated_cvs.tender_pack_id = B's pack": f"insert into generated_cvs (company_id, person_id, tender_id, tender_pack_id, position_code, format, detail) values ('{A}', '{i['pA']}', '{i['tS']}', '{i['packB']}', 'PL', 'world_bank', 'summary')",
        "tender_pack_assignments.confirmed_person_id = B's person": f"insert into tender_pack_assignments (tender_pack_id, position_code, confirmed_person_id) values ('{i['packA']}', 'DS1', '{i['pB']}')",
        "tender_pack_assignments.suggested_person_id = B's person": f"insert into tender_pack_assignments (tender_pack_id, position_code, suggested_person_id) values ('{i['packA']}', 'CE', '{i['pB']}')",
        "tender_tasks.assigned_to = B's person": f"insert into tender_tasks (company_id, tender_id, description, assigned_to) values ('{A}', '{i['tS']}', 't', '{i['pB']}')",
        "pack_generation_jobs.tender_pack_id = B's pack": f"insert into pack_generation_jobs (company_id, tender_id, tender_pack_id) values ('{A}', '{i['tS']}', '{i['packB']}')",
        "tender_tasks on B's private tender": f"insert into tender_tasks (company_id, tender_id, description) values ('{A}', '{i['tPB']}', 't')",
        "tender_answers on B's private tender": f"insert into tender_answers (company_id, tender_id, field_key, value) values ('{A}', '{i['tPB']}', 'k', 'v')",
        "companies vault path -> B's folder": f"update companies set sars_tcs_pin_document_path = '{B}/vault/sars/t.pdf' where id = '{A}'",
        "companies logo path -> B's folder": f"update companies set logo_storage_path = '{B}/logo.png' where id = '{A}'",
        "cv_uploads.storage_path -> B's folder": f"insert into cv_uploads (company_id, person_id, storage_path, original_filename, mode) values ('{A}', '{i['pA']}', '{B}/people/{i['pB']}/uploads/cv.pdf', 'cv.pdf', 'ai_extract')",
        "experience_items.storage_path -> B's folder": f"insert into experience_items (company_id, project_name, document_type, storage_path, original_filename) values ('{A}', 'x', 'other', '{B}/experience/e.pdf', 'e.pdf')",
        "company_document_templates.storage_path -> B's folder": f"insert into company_document_templates (company_id, document_type, mode, storage_path) values ('{A}', 'authority_to_sign', 'uploaded', '{B}/templates/a.pdf')",
        "generated_cvs.storage_path_pdf -> B's folder": f"insert into generated_cvs (company_id, person_id, format, detail, storage_path_pdf) values ('{A}', '{i['pA']}', 'world_bank', 'summary', '{B}/people/{i['pB']}/generated/cv.pdf')",
        "path traversal A/../B": f"update companies set sars_tcs_pin_document_path = '{A}/../{B}/vault/sars/t.pdf' where id = '{A}'",
    }
    for label, sql in ref_probes.items():
        bad, why = refused(db, sql, uA)
        check(bad, f"{label}: refused ({why[:100]})")
    # the same writes against A's OWN data still work
    own = {
        "own project": f"insert into projects (company_id, person_id, client_and_number) values ('{A}', '{i['pA']}', 'ok')",
        "own CV upload": f"insert into cv_uploads (company_id, person_id, storage_path, original_filename, mode) values ('{A}', '{i['pA']}', '{A}/people/{i['pA']}/uploads/cv.pdf', 'cv.pdf', 'as_is')",
        "own confirmed person": f"insert into tender_pack_assignments (tender_pack_id, position_code, confirmed_person_id) values ('{i['packA']}', 'PL', '{i['pA']}')",
        "own vault path": f"update companies set sars_tcs_pin_document_path = '{A}/vault/sars/{uuid.uuid4()}-t.pdf' where id = '{A}'",
        "own task assignee": f"insert into tender_tasks (company_id, tender_id, description, assigned_to) values ('{A}', '{i['tS']}', 't', '{i['pA']}')",
        "own pack job": f"insert into pack_generation_jobs (company_id, tender_id, tender_pack_id) values ('{A}', '{i['tS']}', '{i['packA']}')",
    }
    for label, sql in own.items():
        ok, _, err = db.run(sql, uA)
        check(ok, f"{label}: still allowed ({err[:100]})")

    print("\n[13] Tender templates (0043 -> 0045): a company's upload is its own copy; nobody replaces another's")
    tS, tPB = i["tS"], i["tPB"]
    reqB = "'" + B + "'" if per_company_templates(db) else "null"
    db.one(f"insert into tender_requirements (tender_id, position_code{', company_id' if per_company_templates(db) else ''}) "
           f"values ('{tS}', 'PL'{', ' + reqB if per_company_templates(db) else ''})")
    a_own = tpl_path(A, tS, "technical_xlsm", "a_own.xlsm")
    db.one(f"insert into storage.objects (bucket_id, name) values ('tender-documents', '{tS}/technical_xlsm/a_swap.xlsm'), "
           f"('tender-documents', '{a_own}')")
    bad, why = refused(db, f"select record_tender_document('{tS}', 'technical_xlsm', '{tS}/technical_xlsm/a_swap.xlsm', 'a.xlsm')", uA)
    check(bad, f"A can't register a file in the shared tender folder ({why[:90]})")
    ok, _, err = db.run(f"select record_tender_document('{tS}', 'technical_xlsm', '{a_own}', 'a.xlsm')", uA)
    check(ok, f"A registers its own copy from its own folder ({err[:100]})")
    path = db.one(f"select storage_path from tender_documents where tender_id = '{tS}' and doc_type = 'technical_xlsm' and uploaded_by_company = '{B}'")
    check(path.endswith("b_upload.xlsm"), f"B's template untouched ({path})")
    check(db.one(f"select count(*) from tender_requirements where tender_id = '{tS}'") == "1", "B's positions not cleared by A's upload")
    b_v2 = tpl_path(B, tS, "technical_xlsm", "b_v2.xlsm")
    a_first = tpl_path(A, tS, "a_forms", "a_first.docx")
    b_priv2 = tpl_path(B, tPB, "technical_xlsm", "b_priv2.xlsm")
    db.one(f"insert into storage.objects (bucket_id, name) values ('tender-documents', '{b_v2}'), "
           f"('tender-documents', '{a_first}'), ('tender-documents', '{b_priv2}')")
    ok, _, err = db.run(f"select record_tender_document('{tS}', 'technical_xlsm', '{b_v2}', 'b2.xlsm')", i["uB"])
    check(ok, f"B can still replace its own upload ({err[:100]})")
    check(db.one(f"select count(*) from tender_requirements where tender_id = '{tS}'") == "0", "...which clears B's own positions for a re-read")
    ok, _, err = db.run(f"select record_tender_document('{tS}', 'a_forms', '{a_first}', 'a.docx')", uA)
    check(ok, f"A can upload a template type it has no copy of yet ({err[:100]})")
    bad, why = refused(db, f"select record_tender_document('{tS}', 'technical_xlsm', '{b_v2}', 'x.xlsm')", uA)
    check(bad, f"A can't register B's file as its own ({why[:90]})")
    db.one(f"insert into tender_documents (tender_id, doc_type, storage_path) values ('{tPB}', 'technical_xlsm', '{tPB}/technical_xlsm/b.xlsm')")
    ok, _, err = db.run(f"select record_tender_document('{tPB}', 'technical_xlsm', '{b_priv2}', 'p.xlsm')", i["uB"])
    check(ok, f"B can upload its own copy on its own private tender over the intake-registered one ({err[:100]})")
    bad, _ = refused(db, f"select record_tender_document('{tPB}', 'technical_xlsm', '{tpl_path(A, tPB, 'technical_xlsm', 'x.xlsm')}', 'p.xlsm')", uA)
    check(bad, "A can't touch B's private tender's templates")

    print("\n[13b] Template uploads: nothing of another company's upload is visible, not even that it exists")
    db.one(f"update tender_documents set original_filename = 'IsoB_Confidential_R396.xlsm' where tender_id = '{tS}' and uploaded_by_company = '{B}'")
    bad, why = refused(db, f"select uploaded_by_company, original_filename from tender_documents where tender_id = '{tS}'", uA)
    check(bad, f"A can't read the uploader columns directly ({why[:70]})")
    ok, out, err = db.run(f"select count(*) from tender_document_uploads('{tS}') where original_filename = 'IsoB_Confidential_R396.xlsm'", uA)
    check(ok and out.splitlines()[-1] == "0", f"A never gets B's file name ({out or err[:80]})")
    ok, out, err = db.run(f"select count(*) from tender_documents where tender_id = '{tS}' and storage_path in ('{tS}/technical_xlsm/b_upload.xlsm', '{b_v2}')", uA)
    check(ok and out.splitlines()[-1] == "0", f"A sees no row of B's uploads ({out or err[:80]})")
    ok, out, _ = db.run(f"select coalesce(original_filename, '-') from tender_document_uploads('{tS}') where doc_type = 'technical_xlsm'", i["uB"])
    check(ok and out.splitlines()[-1] == "IsoB_Confidential_R396.xlsm", "B still sees its own upload's file name")
    ok, out, err = db.run(f"select count(*) from tender_document_uploads('{tPB}')", uA)
    n = (out.splitlines() or ["?"])[-1] if ok else "no such function"
    check(ok and n == "0", f"A gets nothing for B's private tender ({n})")

    print("\n[14] Admin console: a customer company owner is not the platform admin")
    n = db.one("select count(*) from admin_harness_runs", uA)
    check(n == "0", f"owner of A sees {n} admin harness run(s)")
    n = db.one("select count(*) from storage.objects where bucket_id = 'admin-harness-artifacts'", uA)
    check(n == "0", f"owner of A sees {n} admin artifact(s)")
    ok, out, err = db.run("with u as (update admin_harness_runs set review_note = 'x' returning 1) select count(*) from u", uA)
    check((not ok) or out.splitlines()[-1] == "0", f"owner of A can't mark a run reviewed ({out or err[:80]})")
    if db.one("select count(*) from pg_proc where proname = 'is_platform_admin'") == "1":
        db.one(f"insert into platform_admins (user_id) values ('{uA}')")
        check(db.one("select count(*) from admin_harness_runs", uA) == "1", "a platform admin does see the runs")
        db.one(f"delete from platform_admins where user_id = '{uA}'")
    else:
        check(False, "platform admin concept exists")


def part2_shared_templates(db):
    """Case 16's hole at the database / Storage layer: A uploads its own
    filled-in workbook through the templates card, exactly as the app does
    (pre-0045: <tender>/<type>/<uuid>.xlsm, readable by every company on the
    tender; since 0045: A's own private/<A>/<tender>/templates/... folder)."""
    print("\n[17] Shared template, database + Storage: A's uploaded workbook is not B's to read")
    i = {k: str(uuid.uuid4()) for k in ("uA", "uB", "A", "B", "t", "pA", "pB")}
    A, B, t = i["A"], i["B"], i["t"]
    new = per_company_templates(db)
    db.one(f"""
insert into auth.users (id, email) values ('{i['uA']}', 'tpl-a@example.test'), ('{i['uB']}', 'tpl-b@example.test');
insert into companies (id, legal_name) values ('{A}', 'Tpl A'), ('{B}', 'Tpl B');
insert into company_members (company_id, user_id, role) values ('{A}', '{i['uA']}', 'owner'), ('{B}', '{i['uB']}', 'owner');
insert into tenders (id, slug, contract_no, title, closing_date, family) values
  ('{t}', 'tpl-{t[:8]}', 'TPL-SHARED', 'Shared SANRAL tender', now() + interval '30 days', 'Conventional Consultant Tender');
insert into tender_packs (id, company_id, tender_id) values ('{i['pA']}', '{A}', '{t}'), ('{i['pB']}', '{B}', '{t}');
insert into storage.buckets (id, name) values ('tender-documents', 'tender-documents') on conflict do nothing;
insert into storage.objects (bucket_id, name) values ('tender-documents', 'tpl-{t[:8]}/a_forms.docx');
insert into tender_documents (tender_id, doc_type, storage_path) values ('{t}', 'a_forms', 'tpl-{t[:8]}/a_forms.docx');
select 1;""")
    # A's upload, the way the templates card does it in this schema version.
    old_path, new_path = f"{t}/technical_xlsm/{uuid.uuid4()}.xlsm", tpl_path(A, t, "technical_xlsm", f"{uuid.uuid4()}.xlsm")
    a_path = None
    for path in (old_path, new_path):
        ok, _, _ = db.run(f"insert into storage.objects (bucket_id, name) values ('tender-documents', '{path}')", i["uA"])
        if ok:
            ok, _, err = db.run(f"select record_tender_document('{t}', 'technical_xlsm', '{path}', 'ACO_R396_Technical_FILLED.xlsm')", i["uA"])
            if ok:
                a_path = path
                break
    check(a_path is not None, f"A's upload accepted ({'shared tender folder' if a_path == old_path else 'own private folder' if a_path else 'refused'})")
    check(a_path != old_path, "A's upload no longer lands in the folder every company on the tender can read")
    n = db.one(f"select count(*) from storage.objects where bucket_id = 'tender-documents' and name in ('{old_path}', '{new_path}')", i["uB"])
    check(n == "0", f"B can't download A's uploaded workbook from Storage (B sees {n})")
    n = db.one(f"select count(*) from tender_documents where tender_id = '{t}' and storage_path in ('{old_path}', '{new_path}')", i["uB"])
    check(n == "0", f"B's view of the tender's templates doesn't include A's file (B sees {n} row(s) naming it)")
    n = db.one(f"select count(*) from tender_document_uploads('{t}') where doc_type = 'technical_xlsm'", i["uB"])
    check(n == "0", f"the templates card shows B no Technical workbook on file - B uploads its own ({n})")
    n = db.one(f"select count(*) from tender_documents where tender_id = '{t}' and storage_path in ('{old_path}', '{new_path}')", i["uA"])
    check(n == "1", f"A still sees and uses its own upload ({n})")
    bad, why = refused(db, f"select record_tender_document('{t}', 'technical_xlsm', '{new_path}', 'stolen.xlsm')", i["uB"])
    check(bad, f"B can't register A's file as B's template ({why[:90]})")

    # A file A uploaded BEFORE 0045 (or an old version it replaced) is still
    # in the shared tender folder - Storage is not rewritten by a migration.
    legacy = f"{t}/technical_xlsm/legacy-{uuid.uuid4()}.xlsm"
    db.one(f"insert into storage.objects (bucket_id, name) values ('tender-documents', '{legacy}')")
    n = db.one(f"select count(*) from storage.objects where bucket_id = 'tender-documents' and name = '{legacy}'", i["uB"])
    check(n == "0", f"B can't read a pre-0045 / replaced upload of A's left in the tender folder ({n})")

    # The legitimate shared case: the buyer's own published file (service role).
    n = db.one(f"select count(*) from storage.objects where bucket_id = 'tender-documents' and name = 'tpl-{t[:8]}/a_forms.docx'", i["uB"])
    check(n == "1", "the buyer's published A-Forms (service-role registered) stay readable by every company")
    rows = db.one(f"select string_agg(doc_type || ':' || source, ',') from tender_document_uploads('{t}')", i["uB"]) if new else "?"
    check(rows == "a_forms:buyer", f"B's card: A-Forms on file from the buyer, nothing else ({rows})")

    # B uploads its own; A's copy and A's positions are untouched.
    if new:
        db.one(f"insert into tender_requirements (tender_id, position_code, company_id) values ('{t}', 'PL', '{A}'), "
               f"('{t}', 'DS1', '{A}'), ('{t}', 'PL', null)")
        n_b = db.one(f"select string_agg(position_code, ',' order by position_code) from tender_requirements where tender_id = '{t}'", i["uB"])
        n_a = db.one(f"select string_agg(position_code, ',' order by position_code) from tender_requirements where tender_id = '{t}'", i["uA"])
        check(n_b == "PL" and n_a == "DS1,PL", f"positions: B sees the shared set ({n_b}), A only its own ({n_a})")
    b_path = tpl_path(B, t, "technical_xlsm", "b.xlsm")
    ok, _, err = db.run(f"insert into storage.objects (bucket_id, name) values ('tender-documents', '{b_path}')", i["uB"])
    ok = ok and db.run(f"select record_tender_document('{t}', 'technical_xlsm', '{b_path}', 'b.xlsm')", i["uB"])[0]
    check(ok, f"B uploads its own Technical workbook ({err[:80]})")
    n = db.one(f"select count(*) from tender_documents where tender_id = '{t}' and storage_path = '{a_path}'") if a_path else "0"
    check(n == "1", "A's copy still on file after B's upload")
    if new:
        n_a = db.one(f"select count(*) from tender_requirements where tender_id = '{t}' and company_id = '{A}'")
        check(n_a == "2", f"A's positions not cleared by B's upload ({n_a})")
        n_b = db.one(f"select count(*) from tender_requirements where tender_id = '{t}'", i["uB"])
        check(n_b == "1", f"B still sees the shared positions until its own are read ({n_b})")


def part2_deletion(db):
    """POPIA s 24 / s 14: a person and a user account can be deleted, and
    nothing of the person stays behind in rows no foreign key reaches."""
    print("\n[15] Deletion: a person on a key position, and a user who did things, can be deleted")
    i = {k: str(uuid.uuid4()) for k in ("u", "c", "p", "p2", "t", "pack")}
    db.one(f"""
insert into auth.users (id, email) values ('{i['u']}', 'del@example.test');
insert into companies (id, legal_name) values ('{i['c']}', 'Del Co');
insert into company_members (company_id, user_id, role) values ('{i['c']}', '{i['u']}', 'owner');
insert into people (id, company_id, name, id_number) values ('{i['p']}', '{i['c']}', 'Leaving Person', '{B_ID_NUMBER}'),
  ('{i['p2']}', '{i['c']}', 'Staying Person', null);
insert into tenders (id, slug, title) values ('{i['t']}', 'del-{i['t'][:8]}', 'Del tender');
insert into tender_packs (id, company_id, tender_id, confirmed_by) values ('{i['pack']}', '{i['c']}', '{i['t']}', '{i['u']}');
insert into tender_pack_assignments (tender_pack_id, position_code, suggested_person_id, confirmed_person_id, candidate_scores)
  values ('{i['pack']}', 'PL', '{i['p']}', '{i['p']}', '[{{"person_id": "{i['p']}", "name": "Leaving Person", "score": 7}},
                                                        {{"person_id": "{i['p2']}", "name": "Staying Person", "score": 3}}]');
insert into tender_answers (company_id, tender_id, field_key, value, answered_by) values ('{i['c']}', '{i['t']}', 'signatory_person_id', '{i['p']}', '{i['u']}');
insert into cv_uploads (company_id, person_id, storage_path, original_filename, mode, uploaded_by)
  values ('{i['c']}', '{i['p']}', '{i['c']}/people/{i['p']}/uploads/cv.pdf', 'cv.pdf', 'as_is', '{i['u']}');
insert into tender_tasks (company_id, tender_id, description, created_by) values ('{i['c']}', '{i['t']}', 'x', '{i['u']}');
select 1;""")
    ok, _, err = db.run(f"delete from people where id = '{i['p']}'", i["u"])
    check(ok, f"member deletes a person confirmed on a key position ({err.splitlines()[0] if err else 'ok'})")
    left = db.one(f"select count(*) from people where id = '{i['p']}'")
    check(left == "0", f"person row gone ({left})")
    scores = db.one(f"select candidate_scores::text from tender_pack_assignments where tender_pack_id = '{i['pack']}'")
    check(i["p"] not in scores and "Leaving Person" not in scores and "Staying Person" in scores,
          f"their ranking entry removed, colleague's kept ({scores[:120]})")
    check(db.one(f"select count(*) from tender_answers where value = '{i['p']}'") == "0", "signatory answer naming them removed")
    check(db.one(f"select count(*) from cv_uploads where person_id = '{i['p']}'") == "0", "their CV upload rows gone (cascade)")
    check(B_ID_NUMBER not in db.one("select coalesce(string_agg(candidate_scores::text, ''), '') from tender_pack_assignments"),
          "their ID number nowhere in rankings")
    up = db.one(f"insert into cv_uploads (company_id, person_id, storage_path, original_filename, mode) values ('{i['c']}', "
                f"'{i['p2']}', '{i['c']}/people/{i['p2']}/uploads/x.pdf', 'x.pdf', 'ai_extract') returning id")
    db.one(f"""insert into cv_extraction_results (company_id, person_id, cv_upload_id, proposed) values ('{i['c']}', '{i['p2']}', '{up}',
      '{{"person": {{"id_number": {{"value": "{B_ID_NUMBER}"}}, "name": {{"value": "Staying Person"}}}}, "projects": []}}') returning 1""")
    ok, _, err = db.run(f"update cv_extraction_results set review_status = 'discarded' where cv_upload_id = '{up}'", i["u"])
    kept = db.one(f"select proposed::text from cv_extraction_results where cv_upload_id = '{up}'")
    check(ok and B_ID_NUMBER not in kept and "Staying Person" in kept,
          f"ID number copy dropped from a reviewed CV extraction, rest kept ({kept[:90]})")
    ok, _, err = db.run(f"delete from auth.users where id = '{i['u']}'")
    check(ok, f"the user account can be deleted after it did things ({err.splitlines()[0] if err else 'ok'})")
    if ok:
        check(db.one(f"select count(*) from tender_tasks where company_id = '{i['c']}' and created_by is null") == "1",
              "their task survives with created_by cleared")


def main():
    part1()
    psql = os.environ.get("TENANT_PSQL")
    if psql:
        part2(Db(psql))
        part2_shared_templates(Db(psql))
        part2_deletion(Db(psql))
    else:
        print("\n(Part 2 skipped - set TENANT_PSQL to a scratch Postgres with every migration replayed)")
    print(f"\n{'ALL PASSED' if not FAILS else str(len(FAILS)) + ' FAILED'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
