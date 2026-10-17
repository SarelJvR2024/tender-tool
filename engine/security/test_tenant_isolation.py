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


def sanral_tender(store, company_ids):
    t = store.add("tenders", contract_no="R.396-010-2025/1F", closing_date="2026-12-15T12:00:00+02:00",
                  family="Conventional Consultant Tender", owner_company_id=None)
    tech = os.path.join(ROOT, "templates", "samples", "R.396-010-2025.1F_ran.xlsm")
    store.put("tender-documents", f"{t['id']}/technical_xlsm/t.xlsm", open(tech, "rb").read())
    store.add("tender_documents", tender_id=t["id"], doc_type="technical_xlsm", storage_path=f"{t['id']}/technical_xlsm/t.xlsm")
    for doc_type, fn in (("a_forms", "A_Forms.docx"), ("c111_form_of_offer", "C.1.1.1_Form_of_Offer.docx"),
                         ("c123_contract_data", "C.1.2.3_Contract_Data.docx")):
        src = os.path.join(ROOT, "templates", "forms", "R.396-010-2025.1F", fn)
        store.put("tender-documents", f"{t['id']}/{doc_type}/{fn}", open(src, "rb").read())
        store.add("tender_documents", tender_id=t["id"], doc_type=doc_type, storage_path=f"{t['id']}/{doc_type}/{fn}")
    return t


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
insert into tender_documents (tender_id, doc_type, storage_path, uploaded_by, uploaded_by_company) values
  ('{i['tS']}', 'technical_xlsm', '{i['tS']}/technical_xlsm/b_upload.xlsm', '{i['uB']}', '{i['B']}');
insert into admin_harness_runs (test_company, tender_ref, status) values ('complete_co', 'r396', 'ok');
select 1;""")
    return ids


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

    print("\n[13] Shared tender template: A can't replace the template B uploaded (which clears every company's positions)")
    db.one(f"insert into storage.objects (bucket_id, name) values ('tender-documents', '{i['tS']}/technical_xlsm/a_swap.xlsm')")
    db.one(f"insert into tender_requirements (tender_id, position_code) values ('{i['tS']}', 'PL')")
    bad, why = refused(db, f"select record_tender_document('{i['tS']}', 'technical_xlsm', '{i['tS']}/technical_xlsm/a_swap.xlsm', 'a.xlsm')", uA)
    path = db.one(f"select storage_path from tender_documents where tender_id = '{i['tS']}' and doc_type = 'technical_xlsm'")
    check(bad and path.endswith("b_upload.xlsm"), f"B's template kept ({path}; {why[:100]})")
    check(db.one(f"select count(*) from tender_requirements where tender_id = '{i['tS']}'") == "1", "positions not cleared")
    db.one(f"insert into storage.objects (bucket_id, name) values ('tender-documents', '{i['tS']}/technical_xlsm/b_v2.xlsm'), "
           f"('tender-documents', '{i['tS']}/a_forms/a_first.docx'), ('tender-documents', '{i['tPB']}/technical_xlsm/b_priv2.xlsm')")
    ok, _, err = db.run(f"select record_tender_document('{i['tS']}', 'technical_xlsm', '{i['tS']}/technical_xlsm/b_v2.xlsm', 'b2.xlsm')", i["uB"])
    check(ok, f"B can still replace its own upload ({err[:100]})")
    ok, _, err = db.run(f"select record_tender_document('{i['tS']}', 'a_forms', '{i['tS']}/a_forms/a_first.docx', 'a.docx')", uA)
    check(ok, f"A can still upload a template nobody has uploaded yet ({err[:100]})")
    db.one(f"insert into tender_documents (tender_id, doc_type, storage_path) values ('{i['tPB']}', 'technical_xlsm', '{i['tPB']}/technical_xlsm/b.xlsm')")
    ok, _, err = db.run(f"select record_tender_document('{i['tPB']}', 'technical_xlsm', '{i['tPB']}/technical_xlsm/b_priv2.xlsm', 'p.xlsm')", i["uB"])
    check(ok, f"B can replace an intake-registered template on its own private tender ({err[:100]})")
    bad, _ = refused(db, f"select record_tender_document('{i['tPB']}', 'technical_xlsm', '{i['tPB']}/technical_xlsm/b_priv2.xlsm', 'p.xlsm')", uA)
    check(bad, "A can't touch B's private tender's templates")

    print("\n[13b] Shared template uploader: another company's upload is anonymous")
    db.one(f"update tender_documents set original_filename = 'IsoB_Confidential_R396.xlsm' where tender_id = '{i['tS']}' and doc_type = 'technical_xlsm'")
    bad, why = refused(db, f"select uploaded_by_company, original_filename from tender_documents where tender_id = '{i['tS']}'", uA)
    check(bad, f"A can't read the uploader columns directly ({why[:70]})")
    ok, out, err = db.run(f"select doc_type || '|' || uploaded_by_us || '|' || uploaded_by_another_company || '|' || coalesce(uploaded_by::text, '-') "
                          f"|| '|' || coalesce(original_filename, '-') from tender_document_uploads('{i['tS']}') where doc_type = 'technical_xlsm'", uA)
    line = (out.splitlines() or [""])[-1]
    check(ok and line == "technical_xlsm|false|true|-|-", f"A sees only 'another company' - no user, no file name ({line or err[:80]})")
    ok, out, _ = db.run(f"select coalesce(original_filename, '-') from tender_document_uploads('{i['tS']}') where doc_type = 'technical_xlsm'", i["uB"])
    check(ok and out.splitlines()[-1] == "IsoB_Confidential_R396.xlsm", "B still sees its own upload's file name")
    ok, out, err = db.run(f"select count(*) from tender_document_uploads('{i['tPB']}')", uA)
    n = (out.splitlines() or ["?"])[-1] if ok else "no such function"
    check(ok and n == "0", f"A gets nothing for B's private tender ({n})")
    check(db.one(f"select count(storage_path) from tender_documents where tender_id = '{i['tS']}'", uA) != "0",
          "A still reads the shared template's storage path (the pack needs it)")

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
        part2_deletion(Db(psql))
    else:
        print("\n(Part 2 skipped - set TENANT_PSQL to a scratch Postgres with every migration replayed)")
    print(f"\n{'ALL PASSED' if not FAILS else str(len(FAILS)) + ' FAILED'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
