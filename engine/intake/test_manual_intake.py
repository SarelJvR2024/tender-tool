"""
End-to-end check of the manual tender load (migration 0024 + the intake step
in engine/general/process_general_jobs.py) against a scratch Postgres with
every migration replayed - no live Supabase exists (System-Status gap #9).

What it drives, in the order the real system does it:
  1. "the browser" writes each uploaded file into Storage under
     tender-documents/manual/<company>/<tender>/ - as an INSERT on
     storage.objects under `set role authenticated`, so 0024's storage policy
     is what allows or refuses it (Storage itself is a local directory);
  2. the server action calls load_manual_tender() as that signed-in user
     (same arguments as app/app/tenders/new/actions.ts);
  3. the bridge (process_general_jobs.poll_once - the real code) claims the
     extract_requirements job and runs the intake;
  4. everything is read back: tenders.family / intake, tender_documents,
     tender_requirements, discovered_opportunities, the job row.

Cases (each one a scenario in docs/specs/Engine-Scenario-Test-Results.md):
  sanral_full    R.396 Technical + Financial workbooks + C.1.1.1 + C.1.2.3 +
                 A-Forms (committed copies in templates/samples, templates/forms)
                 -> SANRAL Conventional route, 5 templates registered, SETUP
                 positions PL/DS1, fingerprint ok, typed closing date vs SETUP
                 discrepancy reported.
  sanral_no_xlsm only the A-Forms + Form of Offer (no workbook), buyer SANRAL
                 -> general route with the "upload the workbook" signal.
  general_sbd    Treasury RT83's SBD set -> general route, SBD forms found.
  unreadable     a truncated PDF + a non-PDF + a scanned image -> job FAILED
                 with a reason naming each file (not a manifest that says
                 "uses no standard forms").
  rls            another company can't see the tender, its documents or its
                 requirements; a member can't upload into another company's
                 prefix; a document path outside the tender's prefix and a
                 duplicate OCDS id are refused by load_manual_tender().

Usage (scratch DB migrated 0001..latest, see replay notes in the results doc):
    INTAKE_PSQL="psql -h /tmp/sock -p 54341 -U postgres -d manualtest" \\
        python3 engine/intake/test_manual_intake.py <scratch_storage_dir>
"""
import json
import os
import shutil
import subprocess
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(ENGINE, ".."))
for p in (os.path.join(ENGINE, "pack"), os.path.join(ENGINE, "general")):
    sys.path.insert(0, p)
import bridge_selftest  # noqa: E402  (PsqlClient)
from bridge_selftest import lit  # noqa: E402
import process_general_jobs as bridge  # noqa: E402

SAMPLES = os.path.join(ROOT, "templates")
R396_TECH = os.path.join(SAMPLES, "samples", "R.396-010-2025.1F_ran.xlsm")
R396_FIN = os.path.join(SAMPLES, "samples", "financial", "R.396-010-2025.1F_Financial_Submission_ran.xlsm")
R396_FORMS = os.path.join(SAMPLES, "forms", "R.396-010-2025.1F")
RT83 = os.path.join(SAMPLES, "general_samples", "treasury_rt83")

FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


class Client(bridge_selftest.PsqlClient):
    """PsqlClient + the two calls the general bridge makes that the SANRAL
    one doesn't: upsert (PostgREST ?on_conflict=) and delete."""

    def upsert(self, table, rows, on_conflict):
        out = []
        for row in rows:
            cols = ", ".join(row)
            keys = on_conflict.split(",")
            sets = ", ".join(f"{c} = excluded.{c}" for c in row if c not in keys) or f"{keys[0]} = excluded.{keys[0]}"
            q = (f"with i as (insert into {table} ({cols}) select {cols} from json_populate_record(null::{table}, "
                 f"{lit(json.dumps(row))}::json) on conflict ({on_conflict}) do update set {sets} returning *) "
                 f"select coalesce(json_agg(i), '[]') from i")
            out += json.loads(self.sql(q))
        return out

    def delete(self, table, filters):
        self.sql(f"delete from {table}{self._where(filters)}")

    def as_user(self, uid, q):
        """Run q as a signed-in member (RLS on). Returns (ok, output_or_error)."""
        full = f"set role authenticated; select set_config('test.uid', {lit(uid)}, false); {q}"
        r = subprocess.run(self.cmd + ["-v", "ON_ERROR_STOP=1", "-At", "-c", full], capture_output=True, text=True)
        if r.returncode:
            return False, r.stderr.strip()
        return True, r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""


def setup_db(c):
    c.sql("grant usage on schema public to authenticated; grant usage on schema storage to authenticated; "
          "grant all on all tables in schema public to authenticated; grant all on storage.objects to authenticated; "
          "grant execute on all functions in schema public to authenticated")
    users = {}
    for name in ("member_a", "member_b"):
        users[name] = c.sql("insert into auth.users default values returning id").splitlines()[0]
    prof = json.load(open(os.path.join(ROOT, "config", "test_companies", "complete_co.json")))["company"]
    a = c.insert("companies", {"legal_name": prof["legal_name"], "bee_level": prof["bee_level"],
                               "registered_address": prof["registered_address"]})
    b = c.insert("companies", {"legal_name": "Other Tenant (Pty) Ltd"})
    c.insert("company_members", {"company_id": a["id"], "user_id": users["member_a"], "role": "owner"})
    c.insert("company_members", {"company_id": b["id"], "user_id": users["member_b"], "role": "owner"})
    # One tagged experience item so the fit has a discipline to match on.
    c.insert("experience_items", {"company_id": a["id"], "project_name": "N1 rehabilitation design",
                                  "document_type": "completion_certificate", "disciplines": ["roads_civil", "professional_services"],
                                  "tagged_at": "2026-10-01T00:00:00+00:00"})
    return users, a["id"], b["id"]


def upload_as_user(c, uid, company_id, tender_id, files):
    """The browser's direct-to-Storage upload: storage.objects insert under
    RLS, then the bytes into the local Storage directory."""
    docs = []
    for local in files:
        name = f"{uuid.uuid4().hex[:8]}-{os.path.basename(local)}"
        path = f"manual/{company_id}/{tender_id}/{name}"
        ok, out = c.as_user(uid, f"insert into storage.objects (bucket_id, name) values ('tender-documents', {lit(path)}) returning name")
        if not ok:
            raise RuntimeError(f"storage insert refused: {out}")
        c.upload("tender-documents", path, local, None)
        docs.append({"title": os.path.basename(local), "storage_path": path})
    return docs


def load(c, uid, company_id, files, title, buyer, reference=None, ocid=None, closing=None):
    tid = str(uuid.uuid4())
    docs = upload_as_user(c, uid, company_id, tender_id=tid, files=files)
    ok, out = c.as_user(uid, f"select load_manual_tender({lit(company_id)}, {lit(tid)}, {lit(title)}, {lit(buyer)}, "
                             f"{lit(reference)}, {lit(ocid)}, {lit(closing)}::timestamptz, {lit(json.dumps(docs))}::jsonb)")
    if not ok:
        raise RuntimeError(out)
    return tid


def run_bridge(c, work):
    return bridge.poll_once(c, work)


def job_for(c, tid):
    return c.select("tender_engine_jobs", {"tender_id": tid}, order="requested_at.desc")[0]


def confirm_position(c, pack_id, code, person_id, **extra):
    """confirmPositionPerson()'s upsert on (tender_pack_id, position_code): the
    pack bridge's sync_position_suggestions (0031) may already have created
    the row, with its candidate ranking, before a person confirms."""
    body = {"suggested_person_id": person_id, "confirmed_person_id": person_id, **extra}
    row = c.select("tender_pack_assignments", {"tender_pack_id": pack_id, "position_code": code})
    if row:
        c.update("tender_pack_assignments", {"id": row[0]["id"]}, body)
    else:
        c.insert("tender_pack_assignments", {"tender_pack_id": pack_id, "position_code": code, **body})


def pack_case(c, company_id, tender_id, storage, work):
    """Same seeding as engine/pack/bridge_selftest.py seed() (complete_co's
    key person, vault scans, confirmed PL/DS1) but onto the tender the intake
    just registered - so process_pack_jobs.py reads tender_documents rows that
    the manual load created, not hand-seeded ones."""
    import harness_pack
    import process_pack_jobs
    from pdf_merge import verify_pack
    prof = json.load(open(os.path.join(ROOT, "config", "test_companies", "complete_co.json")))
    co, kp = prof["company"], prof["key_people"][0]
    c.update("companies", {"id": company_id}, {
        "cipc_registration_number": co["cipc_registration_number"], "csd_supplier_number": co["csd_supplier_number"],
        "black_ownership_pct": co["black_ownership_pct"], "status": co["status"], "postal_address": co["postal_address"],
        "head_office": co["head_office_per_form_b3"], "other_offices": co["other_offices"],
        "ecsa_registered_staff_count": co["ecsa_registered_staff_count"],
        "sacpcmp_registered_staff_count": co["sacpcmp_registered_staff_count"], "total_employees": co["total_employees"],
        "typical_jv_share_pct": co["typical_jv_share_pct"], "bank_name": co["bank"]["bank_name"],
        "bank_branch_code": co["bank"]["branch_code"], "director_name": co["director"]["name"],
        "coid_letter_of_good_standing_number": co["coid_letter_of_good_standing_number"],
        "coid_letter_of_good_standing_expiry": co["coid_letter_of_good_standing_expiry"]})
    q = kp["qualifications"]
    person = c.insert("people", {"company_id": company_id, "name": kp["name"], "id_number": kp["id_number"], "role": kp["role"],
                                 "signatory_capacity": kp["signatory_capacity"], "phone": kp["phone"],
                                 **{k: q.get(k) for k in ("ecsa_level", "ecsa_number", "ecsa_date", "highest_level", "highest_description",
                                                          "highest_institution", "highest_graduated", "initial_description",
                                                          "initial_institution", "initial_graduated")}})
    for pr in kp["projects"]:
        c.insert("projects", {"company_id": company_id, "person_id": person["id"], "client_and_number": pr["client_and_number"],
                              "client_type": pr["client_type"], "project_type": pr["project_type"], "position_code": pr["position_code"],
                              "position_held": pr["position_held"], "value_rm": pr["value_rm"], "contact_name": pr["contact"],
                              "contact_phone": pr["contact_phone"], "start_date": pr["start"], "end_date": pr["end"]})
    vdir = os.path.join(storage, "_vault_src")
    os.makedirs(vdir, exist_ok=True)
    vault = {}
    for col, key in (("sars_tcs_pin_document_path", "tcs"), ("coid_letter_document_path", "coid"), ("pi_insurance_document_path", "pi")):
        local = harness_pack._synthetic_doc(os.path.join(vdir, key + ".pdf"), f"intake test {key}")
        c.upload("company-documents", f"{company_id}/vault/{key}/{key}.pdf", local, None)
        vault[col] = f"{company_id}/vault/{key}/{key}.pdf"
    c.update("companies", {"id": company_id}, vault)
    tp = c.select("tender_packs", {"company_id": company_id, "tender_id": tender_id})[0]
    # Only PL confirmed first: the pack bridge must refuse with the SETUP gate.
    confirm_position(c, tp["id"], "PL", person["id"])
    job = c.insert("pack_generation_jobs", {"company_id": company_id, "tender_id": tender_id, "tender_pack_id": tp["id"],
                                            "status": "requested", "readiness_snapshot": {}, "acknowledged_gaps": True})
    process_pack_jobs.process_pending(c, os.path.join(work, "pack"))
    row = c.select("pack_generation_jobs", {"id": job["id"]})[0]
    check(row["status"] == "failed" and "DS1" in (row["error_message"] or ""),
          f"unconfirmed DS1 (read from the uploaded SETUP) refused loudly: {(row['error_message'] or '')[:150]}")
    confirm_position(c, tp["id"], "DS1", person["id"], specialism_warning=True)
    job = c.insert("pack_generation_jobs", {"company_id": company_id, "tender_id": tender_id, "tender_pack_id": tp["id"],
                                            "status": "requested", "readiness_snapshot": {}, "acknowledged_gaps": True})
    process_pack_jobs.process_pending(c, os.path.join(work, "pack"))
    row = c.select("pack_generation_jobs", {"id": job["id"]})[0]
    check(row["status"] == "ready", f"pack job ready (status={row['status']}, error={(row['error_message'] or '')[:200]})")
    if row["status"] == "ready":
        pdf = os.path.join(storage, "submission-packs", row["storage_path_pdf"])
        problems = verify_pack(pdf, row["manifest"])
        check(not problems, f"{row['page_count']}-page pack read back clean ({problems})")
        omitted = [o["title"] for o in row["manifest"]["omitted"]]
        print(f"    not included: {omitted}")
        check(any("B-BBEE" in o or "bee" in o.lower() for o in omitted), "missing B-BBEE proof listed as not included (not silently dropped)")
        check(not any("cover" in o.lower() for o in omitted), "envelope covers built (NRA reference known)")


def main():
    storage = os.path.abspath(sys.argv[1])
    shutil.rmtree(storage, ignore_errors=True)
    os.makedirs(storage)
    c = Client(os.environ["INTAKE_PSQL"], storage)
    work = os.path.join(storage, "_work")
    users, a, b = setup_db(c)
    ua, ub = users["member_a"], users["member_b"]

    print("\n[sanral_full] R.396 committed templates, typed closing date differs from SETUP")
    cover = os.path.join(storage, "_cover", "Book 1 cover page.txt")
    os.makedirs(os.path.dirname(cover), exist_ok=True)
    # Book 1's real cover lines (R.396-010-2025/1F Book 1 p.1, pdftotext) - the
    # 4 MB Book 1 itself is real tender data under templates/incoming (gitignored).
    open(cover, "w").write("NRA: 2026/0071\nCONTRACT SANRAL: R.396-010-2025/1F\nTHE SOUTH AFRICAN NATIONAL ROADS AGENCY SOC LTD\n")
    files = [R396_TECH, R396_FIN, cover] + [os.path.join(R396_FORMS, f) for f in sorted(os.listdir(R396_FORMS))]
    t1 = load(c, ua, a, files, "Conventional consulting engineering services R.396", "SANRAL Northern Region",
              reference="R.396-010-2025/1F", closing="2026-10-29T11:00:00+02:00")
    check(job_for(c, t1)["status"] == "requested", "load_manual_tender queued one extract_requirements job")
    run_bridge(c, work)
    t = c.select("tenders", {"id": t1})[0]
    j = job_for(c, t1)
    check(j["status"] == "ready", f"intake job ready (status={j['status']}, error={j['error_message']})")
    check(t["family"] == "Conventional Consultant Tender", f"family = {t['family']}")
    check(t["intake"]["route"] == "sanral", f"route = {t['intake']['route']}: {t['intake']['signal'][:110]}")
    docs = {d["doc_type"]: d["storage_path"] for d in c.select("tender_documents", {"tender_id": t1})}
    check(sorted(docs) == sorted(["technical_xlsm", "financial_xlsm", "c111_form_of_offer", "c123_contract_data", "a_forms"]),
          f"tender_documents registered: {sorted(docs)}")
    check(all(p.startswith(f"manual/{a}/{t1}/") for p in docs.values()), "templates reuse the uploaded objects under the tender's own prefix")
    reqs = c.select("tender_requirements", {"tender_id": t1}, order="position_code")
    check({(r["position_code"], r["is_alternate"], r["managerial"]) for r in reqs} ==
          {("PL", False, False), ("PL", True, False), ("DS1", False, False), ("DS1", True, False)},
          f"tender_requirements from SETUP: {[(r['position_code'], r['is_alternate'], r['managerial'], r['position_description']) for r in reqs]}")
    check(t["intake"]["fingerprint"]["status"] == "ok", f"fingerprint: {t['intake']['fingerprint']['detail'][:100]}")
    check(any("SETUP sheet says 2026-10-22" in n for n in t["intake"]["notes"]),
          f"closing-date discrepancy reported: {[n[:90] for n in t['intake']['notes']]}")
    check(t["nra_reference"] == "NRA 2026/0071", f"NRA reference read from the documents: {t['nra_reference']}")
    opp = c.select("discovered_opportunities", {"company_id": a, "tender_id": t1})
    check(len(opp) == 1 and opp[0]["source"] == "manual", f"fit row written: verdict={opp and opp[0]['verdict']}, reasons={opp and opp[0]['reasons']}")
    check(bool(t["evaluation_rules"]) and t["evaluation_rules"]["experience_evidence"] is not None,
          f"evaluation_rules stored (evidence rules: {len((t['evaluation_rules'] or {}).get('experience_evidence', {}).get('rules', []))})")

    print("\n[sanral_pack] the SANRAL pack bridge builds from the manually loaded templates")
    pack_case(c, a, t1, storage, work)

    print("\n[sanral_no_xlsm] SANRAL forms but no Technical workbook")
    t2 = load(c, ua, a, [os.path.join(R396_FORMS, "A_Forms.docx"), os.path.join(R396_FORMS, "C.1.1.1_Form_of_Offer.docx")],
              "SANRAL consulting tender (forms only)", "SANRAL")
    run_bridge(c, work)
    t = c.select("tenders", {"id": t2})[0]
    check(job_for(c, t2)["status"] == "ready", f"intake job ready ({job_for(c, t2)['error_message']})")
    check(t["family"] == "General (non-SANRAL)" and t["intake"]["route"] == "general", f"routed general: family={t['family']}")
    check(t["intake"]["sanral_hint"] and "Upload the Technical Submission .xlsm" in t["intake"]["signal"],
          f"says why and what to upload: {t['intake']['signal'][:140]}")
    check(c.select("tender_documents", {"tender_id": t2}) == [], "no SANRAL templates registered without the workbook")

    print("\n[general_sbd] Treasury RT83 SBD set")
    t3 = load(c, ua, a, [os.path.join(RT83, f) for f in sorted(os.listdir(RT83))], "Transversal contract RT83", "National Treasury",
              reference="RT83-2026", closing="2026-11-20T11:00:00+02:00")
    run_bridge(c, work)
    t = c.select("tenders", {"id": t3})[0]
    m = t["document_requirements"]
    check(job_for(c, t3)["status"] == "ready" and t["family"] == "General (non-SANRAL)", f"general route, family={t['family']}")
    check(m["form_suite"] == "SBD" and {f["code"] for f in m["forms"] if f["status"] == "auto"} >= {"1", "4", "6.1"},
          f"SBD forms filled-for-you: {[(f['label'], f['status']) for f in m['forms']]}")

    print("\n[unreadable] truncated PDF + non-PDF + scanned image")
    sc = os.path.join(storage, "_bad")
    os.makedirs(sc, exist_ok=True)
    with open(os.path.join(ROOT, "templates", "general_samples", "dawid_kruiper_tn051", "TN051.pdf"), "rb") as f:
        open(os.path.join(sc, "truncated_tender.pdf"), "wb").write(f.read(40000))
    open(os.path.join(sc, "error_page.pdf"), "w").write("<html><body>404 Not Found</body></html>")
    from PIL import Image, ImageDraw
    im = Image.new("RGB", (1240, 1754), "white")
    ImageDraw.Draw(im).text((80, 80), "SBD 1 INVITATION TO BID (scanned)", fill="black")
    im.save(os.path.join(sc, "scanned_notice.pdf"))
    t4 = load(c, ua, a, [os.path.join(sc, f) for f in sorted(os.listdir(sc))], "Scanned municipal RFQ", "Some Municipality")
    run_bridge(c, work)
    j = job_for(c, t4)
    t = c.select("tenders", {"id": t4})[0]
    check(j["status"] == "failed", f"intake job FAILED (status={j['status']})")
    msg = j["error_message"] or ""
    check("None of this tender's documents could be read" in msg and "truncated_tender.pdf" in msg and "scanned image" in msg
          and "not a readable PDF" in msg, f"error names each file and why: {msg[:260]}")
    check(t["document_requirements"] is None and t["family"] is None, "no manifest/family written from zero readable text")

    print("\n[rls] tenant isolation + RPC guards")
    ok, out = c.as_user(ub, f"select count(*) from tenders where id = {lit(t1)}")
    check(ok and out == "0", f"other company sees the manual tender: {out}")
    ok, out = c.as_user(ub, f"select count(*) from tender_documents where tender_id = {lit(t1)}")
    check(ok and out == "0", f"other company sees its templates: {out}")
    ok, out = c.as_user(ub, f"select count(*) from tender_requirements where tender_id = {lit(t1)}")
    check(ok and out == "0", f"other company sees its requirements: {out}")
    ok, out = c.as_user(ua, f"select count(*) from tenders where id = {lit(t1)}")
    check(ok and out == "1", "owner sees it")
    ok, out = c.as_user(ub, "select count(*) from tenders where source = 'sanral'")
    check(ok and int(out) > 0, f"shared SANRAL tenders still visible to everyone ({out})")
    ok, out = c.as_user(ub, f"insert into storage.objects (bucket_id, name) values ('tender-documents', 'manual/{a}/{t1}/x.pdf')")
    check(not ok, f"member B can't upload into company A's prefix: {out[:90]}")
    ok, out = c.as_user(ub, "insert into storage.objects (bucket_id, name) values ('tender-documents', 'r-396/technical_xlsm.xlsm')")
    check(not ok, "members still can't write the shared (non-manual) part of the bucket")
    c.sql(f"insert into storage.objects (bucket_id, name) values ('tender-documents', 'manual/{a}/{t1}/seen.pdf')")
    ok, out = c.as_user(ub, f"select count(*) from storage.objects where name = 'manual/{a}/{t1}/seen.pdf'")
    check(ok and out == "0", "member B can't read company A's uploaded tender documents")
    ok, out = c.as_user(ua, f"select count(*) from storage.objects where name = 'manual/{a}/{t1}/seen.pdf'")
    check(ok and out == "1", "member A can read its own")
    tid = str(uuid.uuid4())
    bad = json.dumps([{"title": "x.pdf", "storage_path": f"manual/{a}/{t1}/x.pdf"}])
    ok, out = c.as_user(ua, f"select load_manual_tender({lit(a)}, {lit(tid)}, 'T', 'B', null, null, null, {lit(bad)}::jsonb)")
    check(not ok and "outside this tender's upload folder" in out, f"path outside the tender's prefix refused: {out[:100]}")
    ok, out = c.as_user(ub, f"select load_manual_tender({lit(a)}, {lit(tid)}, 'T', 'B', null, null, null, '[]'::jsonb)")
    check(not ok and "not a member" in out, "loading into another company refused")
    ok, out = c.as_user(ua, f"select load_manual_tender({lit(a)}, {lit(tid)}, 'T', 'B', null, null, null, '[]'::jsonb)")
    check(not ok and "at least one" in out, "no documents refused")
    c.sql(f"update tenders set ocid = 'ocds-test-dup' where id = {lit(t3)}")
    d2 = json.dumps([{"title": "x.pdf", "storage_path": f"manual/{a}/{tid}/x.pdf"}])
    ok, out = c.as_user(ua, f"select load_manual_tender({lit(a)}, {lit(tid)}, 'T', 'B', null, 'ocds-test-dup', null, {lit(d2)}::jsonb)")
    check(not ok and "already loaded" in out, f"duplicate OCDS id refused: {out[:100]}")
    ok, out = c.as_user(ub, f"select add_manual_tender_documents({lit(t1)}, {lit(d2)}::jsonb)")
    check(not ok, "member B can't add documents to company A's tender")
    ok, out = c.as_user(ua, f"with u as (update tenders set family = 'x' where id = {lit(t1)} returning id) select count(*) from u")
    check(ok and out == "0", f"clients still can't write tenders directly ({out} rows updated)")

    print("\n[add_documents] the workbook added later switches the forms-only tender to SANRAL")
    extra = upload_as_user(c, ua, a, t2, [R396_TECH, os.path.join(R396_FORMS, "C.1.2.3_Contract_Data.docx")])
    ok, out = c.as_user(ua, f"select add_manual_tender_documents({lit(t2)}, {lit(json.dumps(extra))}::jsonb)")
    check(ok, f"add_manual_tender_documents queued a new intake: {out}")
    run_bridge(c, work)
    t = c.select("tenders", {"id": t2})[0]
    check(t["family"] == "Conventional Consultant Tender" and len(t["document_urls"]) == 4,
          f"re-analysed: family={t['family']}, documents={len(t['document_urls'])}, notes={[n[:70] for n in t['intake']['notes']]}")
    check(t["nra_reference"] == "NRA 2026/0071", f"NRA reference read from the returnable forms' own header: {t['nra_reference']}")

    print(f"\n{len(FAILS)} failure(s)")
    for f in FAILS:
        print("  - " + f)
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
