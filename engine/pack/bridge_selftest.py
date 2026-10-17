"""
End-to-end check of process_pack_jobs.py with no live Supabase project (none
exists in this environment - System-Status.md Gap #8).

Drives the EXACT same process_pending()/process_job()/gather() code the real
bridge runs, but with PsqlClient below standing in for SupabaseRest: rows are
read/written with real SQL against a scratch Postgres that has every
migration (0001..latest) replayed, so the bridge's table names, column names,
status check constraint and JSON shapes are checked against the real schema;
Storage is a local directory. Only the HTTP layer differs from production.

Seeds one synthetic test company (config/test_companies/complete_co.json),
the public R.396-010-2025/1F tender row (app/supabase/seed_tenders.sql must
already be loaded), its blank templates from templates/samples + templates/
forms, synthetic vault uploads, a ready generated CV (generate_cv.py) for one
position and an as-is CV upload for nothing else - so both CV paths and the
"not included" path are exercised - then inserts a 'requested' job the way the
Tender Workspace's requestSubmissionPack() server action does, and runs the
bridge once.

Usage (scratch DB already migrated):
    PACK_SELFTEST_PSQL="psql -h /tmp/sock -p 54329 -U postgres -d packtest" \\
        python3 engine/pack/bridge_selftest.py <scratch_storage_dir>
"""
import os
import sys
import json
import shlex
import shutil
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import process_pack_jobs as bridge  # noqa: E402
import harness_pack  # noqa: E402
from pdf_merge import verify_pack  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


def lit(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (dict, list)):
        v = json.dumps(v)
    return "'" + str(v).replace("'", "''") + "'"


class PsqlClient:
    def __init__(self, psql_cmd, storage_dir):
        self.cmd = shlex.split(psql_cmd)
        self.storage = storage_dir

    def sql(self, q):
        r = subprocess.run(self.cmd + ["-v", "ON_ERROR_STOP=1", "-At", "-c", q], capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(f"psql: {r.stderr.strip()}\n{q[:400]}")
        return r.stdout.strip()

    def _where(self, filters, alias=""):
        parts = []
        for col, v in (filters or {}).items():
            if v is bridge.NOT_NULL:
                parts.append(f"{alias}{col} is not null")
            elif isinstance(v, (list, tuple)):
                parts.append(f"{alias}{col}::text in ({','.join(lit(str(x)) for x in v)})")
            else:
                parts.append(f"{alias}{col}::text = {lit(str(v).lower() if isinstance(v, bool) else v)}")
        return (" where " + " and ".join(parts)) if parts else ""

    @staticmethod
    def _order(order):
        if not order:
            return ""
        bits = order.split(".")
        out = f" order by {bits[0]} {'desc' if 'desc' in bits else 'asc'}"
        if "nullslast" in bits:
            out += " nulls last"
        return out

    def select(self, table, filters=None, order=None):
        q = (f"select coalesce(json_agg(t), '[]') from (select * from {table}"
             f"{self._where(filters)}{self._order(order)}) t")
        return json.loads(self.sql(q))

    def update(self, table, filters, body):
        sets = ", ".join(f"{c} = r.{c}" for c in body)
        q = (f"with u as (update {table} as x set {sets} from "
             f"json_populate_record(null::{table}, {lit(json.dumps(body))}::json) r"
             f"{self._where(filters, 'x.')} returning x.*) select coalesce(json_agg(u), '[]') from u")
        return json.loads(self.sql(q))

    def insert(self, table, row):
        cols = ", ".join(row)
        q = (f"with i as (insert into {table} ({cols}) select {cols} from "
             f"json_populate_record(null::{table}, {lit(json.dumps(row))}::json) returning *) "
             f"select row_to_json(i) from i")
        return json.loads(self.sql(q))

    def download(self, bucket, path, dest):
        src = os.path.join(self.storage, bucket, path)
        if not os.path.exists(src):
            raise RuntimeError(f"storage object not found: {bucket}/{path}")
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy(src, dest)
        return dest

    def upload(self, bucket, path, local, content_type):
        dest = os.path.join(self.storage, bucket, path)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copy(local, dest)

    def put(self, bucket, path, local):
        self.upload(bucket, path, local, None)
        return path


def seed(client, work):
    profile_path = os.path.join(ROOT, "config", "test_companies", "complete_co.json")
    prof = json.load(open(profile_path))
    c, kp = prof["company"], prof["key_people"][0]
    tender = client.select("tenders", {"contract_no": "R.396-010-2025/1F"})
    if not tender:
        raise SystemExit("load app/supabase/seed_tenders.sql into the scratch DB first")
    tender = tender[0]

    company = client.insert("companies", {
        "legal_name": c["legal_name"], "cipc_registration_number": c["cipc_registration_number"],
        "csd_supplier_number": c["csd_supplier_number"], "bee_level": c["bee_level"],
        "black_ownership_pct": c["black_ownership_pct"], "status": c["status"],
        "registered_address": c["registered_address"], "postal_address": c["postal_address"],
        "head_office": c["head_office_per_form_b3"], "other_offices": c["other_offices"],
        "ecsa_registered_staff_count": c["ecsa_registered_staff_count"],
        "sacpcmp_registered_staff_count": c["sacpcmp_registered_staff_count"],
        "total_employees": c["total_employees"], "typical_jv_share_pct": c["typical_jv_share_pct"],
        "bank_name": c["bank"]["bank_name"], "bank_branch_code": c["bank"]["branch_code"],
        "director_name": c["director"]["name"],
        "coid_letter_of_good_standing_number": c["coid_letter_of_good_standing_number"],
        "coid_letter_of_good_standing_expiry": c["coid_letter_of_good_standing_expiry"],
        "sars_tcs_pin": "0000TESTPIN", "sars_tcs_pin_expiry": "2027-06-30",
        "pi_insurance_insurer": "Test Insurer", "pi_insurance_policy_number": "PI-TEST-1",
        "pi_insurance_cover_zar": 5000000, "pi_insurance_expiry": "2027-03-31",
        "bee_proof_type": "qse_affidavit", "bee_proof_expiry": "2026-09-30",  # lapses before closing
    })
    cid = company["id"]
    q = kp["qualifications"]
    person = client.insert("people", {
        "company_id": cid, "name": kp["name"], "id_number": kp["id_number"], "role": kp["role"],
        "signatory_capacity": kp["signatory_capacity"], "phone": kp["phone"],
        **{k: q.get(k) for k in ("ecsa_level", "ecsa_number", "ecsa_date", "highest_level", "highest_description",
                                 "highest_institution", "highest_graduated", "initial_description",
                                 "initial_institution", "initial_graduated")},
    })
    for pr in kp["projects"]:
        client.insert("projects", {
            "company_id": cid, "person_id": person["id"], "client_and_number": pr["client_and_number"],
            "client_type": pr["client_type"], "project_type": pr["project_type"],
            "position_code": pr["position_code"], "position_held": pr["position_held"],
            "value_rm": pr["value_rm"], "contact_name": pr["contact"], "contact_phone": pr["contact_phone"],
            "start_date": pr["start"], "end_date": pr["end"]})
    tp = client.insert("tender_packs", {"company_id": cid, "tender_id": tender["id"], "status": "confirmed",
                                        "confirmed_at": "2026-10-16T09:00:00+00:00"})
    for code in ("PL", "DS1"):
        client.insert("tender_pack_assignments", {"tender_pack_id": tp["id"], "position_code": code,
                                                  "suggested_person_id": person["id"],
                                                  "confirmed_person_id": person["id"],
                                                  "specialism_warning": code == "DS1"})

    slug = "R.396-010-2025.1F"
    templates = {
        "technical_xlsm": os.path.join(ROOT, "templates", "samples", f"{slug}_ran.xlsm"),
        "financial_xlsm": os.path.join(ROOT, "templates", "samples", "financial", f"{slug}_Financial_Submission_ran.xlsm"),
        "a_forms": os.path.join(ROOT, "templates", "forms", slug, "A_Forms.docx"),
        "c111_form_of_offer": os.path.join(ROOT, "templates", "forms", slug, "C.1.1.1_Form_of_Offer.docx"),
        "c123_contract_data": os.path.join(ROOT, "templates", "forms", slug, "C.1.2.3_Contract_Data.docx"),
    }
    for doc_type, local in templates.items():
        sp = client.put("tender-documents", f"{tender['slug']}/{doc_type}{os.path.splitext(local)[1]}", local)
        client.insert("tender_documents", {"tender_id": tender["id"], "doc_type": doc_type, "storage_path": sp})

    vdir = os.path.join(work, "vault_src")
    os.makedirs(vdir, exist_ok=True)
    vault_paths = {}
    for col, key, ext in (("sars_tcs_pin_document_path", "tcs", ".pdf"),
                          ("bee_proof_document_path", "bee", ".png"),
                          ("pi_insurance_document_path", "pi", ".pdf"),
                          ("coid_letter_document_path", "coid", ".pdf")):
        local = harness_pack._synthetic_doc(os.path.join(vdir, key + ext), f"self-test {key}")
        vault_paths[col] = client.put("company-documents", f"{cid}/vault/{key}/{key}{ext}", local)
    client.update("companies", {"id": cid}, vault_paths)

    # A ready tender-specific CV for PL (generate_cv.py's real output); nothing for DS1.
    gen_dir = os.path.join(work, "cv_src")
    _, pdf, _ = __import__("generate_cv").generate(profile_path, 0, gen_dir, "sanral_keyperson", "detailed")
    sp = client.put("cv-documents", f"{cid}/people/{person['id']}/generated/{os.path.basename(pdf)}", pdf)
    client.insert("generated_cvs", {"company_id": cid, "person_id": person["id"], "tender_id": tender["id"],
                                    "tender_pack_id": tp["id"], "position_code": "PL", "format": "sanral_keyperson",
                                    "detail": "detailed", "status": "ready", "storage_path_pdf": sp,
                                    "completed_at": "2026-10-16T10:00:00+00:00"})

    # Same columns the Tender Workspace's requestSubmissionPack() inserts.
    job = client.insert("pack_generation_jobs", {
        "company_id": cid, "tender_id": tender["id"], "tender_pack_id": tp["id"], "status": "requested",
        "readiness_snapshot": {"mandatory_missing": [], "missing": ["B-BBEE proof"], "to_confirm": [],
                               "unfilled_positions": []},
        "acknowledged_gaps": True})
    return job


def main():
    storage = os.path.abspath(sys.argv[1])
    client = PsqlClient(os.environ["PACK_SELFTEST_PSQL"], storage)
    work = os.path.join(storage, "_selftest_work")
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    job = seed(client, work)
    print(f"seeded job {job['id']} (status {job['status']})")

    n = bridge.process_pending(client, os.path.join(work, "jobs"), keep=True)
    row = client.select("pack_generation_jobs", {"id": job["id"]})[0]
    print(f"processed {n} job(s); row status = {row['status']}, error = {row['error_message']}")
    if row["status"] != "ready":
        sys.exit(1)
    pdf = os.path.join(storage, "submission-packs", row["storage_path_pdf"])
    problems = verify_pack(pdf, row["manifest"])
    print(f"storage_path_pdf = {row['storage_path_pdf']}")
    print(f"output_files = {json.dumps(row['output_files'], indent=1)}")
    print(f"page_count = {row['page_count']}; read-back problems = {problems}")
    for s in row["manifest"]["sections"]:
        print(f"  p{s['start_page']:>3}-{s['end_page']:<3} [{s['envelope']}] {s['title']}")
    for o in row["manifest"]["omitted"]:
        print(f"  NOT INCLUDED [{o['envelope']}] {o['title']}: {o['reason']}")
    for w in row["manifest"]["warnings"]:
        print(f"  WARNING {w}")
    print(f"checklist: {row['manifest']['checklist_summary']}")
    for c in row["manifest"]["checklist"]:
        print(f"  #{c['no']:<2} {c['status']:<17} p{c['pages'] or '-':<6} {c['title']}"
              + (f"  -- {c['note']}" if c["note"] else ""))

    # Envelope 2 is its own PDF (assemble_pack.py module docstring).
    fin = row["manifest"]["financial"]
    fin_pdf = os.path.join(storage, "submission-packs", row["output_files"]["financial_pdf"])
    fin_problems = verify_pack(fin_pdf, fin)
    print(f"Envelope 2 PDF = {row['output_files']['financial_pdf']}: {fin['page_count']} pages; "
          f"read-back problems = {fin_problems}")
    for s in fin["sections"]:
        print(f"  p{s['start_page']:>3}-{s['end_page']:<3} [{s['envelope']}] {s['title']}")
    for o in fin["omitted"]:
        print(f"  NOT INCLUDED [{o['envelope']}] {o['title']}: {o['reason']}")

    # Key positions read from the uploaded Technical workbook's SETUP sheet.
    reqs = client.select("tender_requirements", {"tender_id": job["tender_id"]}, order="position_code.asc")
    print("tender_requirements from SETUP: " + ", ".join(
        f"{r['position_code']}{' (ALT)' if r['is_alternate'] else ''}" for r in reqs))
    sys.exit(1 if problems or fin_problems or not reqs else 0)


if __name__ == "__main__":
    main()
