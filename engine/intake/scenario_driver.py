"""
Drives real tenders through the whole intake -> requirements -> general pack
chain on a scratch Postgres (every migration replayed) - the scenario pass
in docs/specs/Engine-Scenario-Test-Results.md. Two ways in, exactly as the
web app does them:

  --ocds REPORT.json --ocid X [--ocid Y ...]
      a DISCOVERED tender: a discovered_opportunities row from a live
      etenders_national.py report (its real document links), then
      pursue_discovered_opportunity() as a signed-in member, then the bridge.
  --manual DIR --title T --buyer B
      a MANUAL load: every file in DIR uploaded under the member's
      manual/<company>/<tender>/ prefix, load_manual_tender(), the bridge.

Then (unless --no-pack) a generate_pack job with one signatory answer, run
by the same bridge. Prints what a person would see: the route and why, forms
(filled-for-you / by hand), the buyer's own forms, required supporting
documents, gaps, fit; and for the pack: status, pages, what's by hand / not
included, or the failure reason.

Usage:
    INTAKE_PSQL="psql -h /tmp/sock -p 54341 -U postgres -d scen" \\
      python3 engine/intake/scenario_driver.py <storage_dir> --ocds report.json --ocid ocds-9t57fa-174461
"""
import argparse
import json
import os
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_manual_intake as t  # noqa: E402  (Client, setup_db, upload_as_user, load)
from bridge_selftest import lit  # noqa: E402
import process_general_jobs as bridge  # noqa: E402


def ensure_company(c, storage):
    rows = c.select("companies", {"legal_name": "Test Complete Engineering (Pty) Ltd"})
    if rows:
        uid = c.select("company_members", {"company_id": rows[0]["id"]})[0]["user_id"]
        return uid, rows[0]["id"]
    users, a, _ = t.setup_db(c)
    prof = json.load(open(os.path.join(t.ROOT, "config", "test_companies", "complete_co.json")))
    co, kp = prof["company"], prof["key_people"][0]
    c.update("companies", {"id": a}, {
        "cipc_registration_number": co["cipc_registration_number"], "csd_supplier_number": co["csd_supplier_number"],
        "vat_number": co.get("vat_number"), "income_tax_number": co.get("income_tax_number"),
        "postal_address": co["postal_address"], "director_name": co["director"]["name"],
        "telephone": "012 000 0000", "email": "tenders@example.test",
        "sars_tcs_pin": "0000TESTPIN", "sars_tcs_pin_expiry": "2027-06-30",
        "bee_proof_type": "qse_affidavit", "bee_proof_expiry": "2027-06-30",
        "coid_letter_of_good_standing_expiry": co["coid_letter_of_good_standing_expiry"]})
    import harness_pack
    vdir = os.path.join(storage, "_vault_src")
    os.makedirs(vdir, exist_ok=True)
    paths = {}
    for col, key in (("sars_tcs_pin_document_path", "tcs"), ("bee_proof_document_path", "bee"), ("coid_letter_document_path", "coid")):
        local = harness_pack._synthetic_doc(os.path.join(vdir, key + ".pdf"), f"scenario {key}")
        c.upload("company-documents", f"{a}/vault/{key}/{key}.pdf", local, None)
        paths[col] = f"{a}/vault/{key}/{key}.pdf"
    c.update("companies", {"id": a}, paths)
    c.insert("people", {"company_id": a, "name": kp["name"], "role": kp["role"], "signatory_capacity": kp["signatory_capacity"]})
    return users["member_a"], a


def discovered(c, uid, company, report, ocid):
    rel = next(r for r in json.load(open(report))["releases"] if r.get("ocid") == ocid)
    opp = c.insert("discovered_opportunities", {
        "company_id": company, "contract_number": rel.get("contract_number"), "buyer": rel.get("buyer"),
        "title": rel.get("title"), "description": rel.get("description"), "closing_date": rel.get("closing_date"),
        "verdict": "needs_review", "reasons": ["seeded by scenario_driver from a live OCDS report"], "ocid": ocid,
        "document_urls": [{"url": d.get("url"), "title": d.get("title")} for d in rel.get("documents") or []]})
    ok, out = c.as_user(uid, f"select pursue_discovered_opportunity({lit(opp['id'])})")
    if not ok:
        raise RuntimeError(out)
    return out


def report(c, tid, company, work, pack=True):
    tender = c.select("tenders", {"id": tid})[0]
    job = c.select("tender_engine_jobs", {"tender_id": tid, "kind": "extract_requirements"}, order="requested_at.desc")[0]
    print(f"  intake job: {job['status']}" + (f" - {job['error_message']}" if job["error_message"] else ""))
    if job["status"] != "ready":
        return
    i, m = tender["intake"], tender["document_requirements"]
    print(f"  route: {i['route']} / family {tender['family']}")
    print(f"  why: {i['signal']}")
    for n in i["notes"]:
        print(f"  note: {n}")
    for u in i["unreadable_documents"]:
        print(f"  unreadable: {u['document']}: {u['reason']}")
    print(f"  documents read: {i['readable_documents']} of {len(m['documents'])}; suite {m['form_suite']}")
    for f in m["forms"]:
        print(f"  form {f['label']:8} {f['status']:8} {f['reason'][:110]}")
    for b in m["buyer_forms"]:
        print(f"  buyer form: {b['label'][:70]}")
    req = [r["label"] for r in m["returnables"] if r["strength"] == "required"]
    print(f"  required supporting docs: {req}")
    print(f"  roles: {[r['role_code'] for r in m['roles']]}  cidb: {m['cidb'] and m['cidb']['grading']}  "
          f"briefing: {m['briefing'] and m['briefing']['compulsory']}  pref: {m['scoring']['preference_system'].get('system')}")
    print(f"  questions: {[q['key'] for q in m['questions']]}")
    for g in m["gaps"]:
        print(f"  GAP: {g[:170]}")
    opp = c.select("discovered_opportunities", {"company_id": company, "tender_id": tid})
    if opp:
        print(f"  fit: {opp[0]['verdict']} - {opp[0]['reasons']}")
    if not pack or tender["family"] != "General (non-SANRAL)":
        return
    person = c.select("people", {"company_id": company})[0]
    c.sql(f"insert into tender_answers (company_id, tender_id, field_key, value) values ({lit(company)}, {lit(tid)}, "
          f"'signatory_person_id', {lit(person['id'])}) on conflict (company_id, tender_id, field_key) do nothing")
    tp = c.select("tender_packs", {"company_id": company, "tender_id": tid})[0]
    pj = c.insert("tender_engine_jobs", {"company_id": company, "tender_id": tid, "tender_pack_id": tp["id"], "kind": "generate_pack"})
    bridge.poll_once(c, work)
    pj = c.select("tender_engine_jobs", {"id": pj["id"]})[0]
    print(f"  pack job: {pj['status']}" + (f" - {pj['error_message']}" if pj["error_message"] else ""))
    if pj["status"] == "ready":
        pm = pj["manifest"]
        print(f"  pack: {pj['page_count']} pages, {len(pm['sections'])} sections; provenance {pm['provenance_summary']}")
        for s in pm["sections"]:
            print(f"    p{s['start_page']}-{s['end_page']} {s['title'][:90]}")
        for o in pm["omitted"]:
            print(f"    NOT INCLUDED {o['title'][:70]} - {o['reason'][:90]}")
        for b in pm["by_hand"][:12]:
            print(f"    BY HAND {b['title'][:70]} - {b['reason'][:90]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("storage")
    ap.add_argument("--ocds")
    ap.add_argument("--ocid", action="append", default=[])
    ap.add_argument("--manual")
    ap.add_argument("--title", default="Manually loaded tender")
    ap.add_argument("--buyer", default="Unknown buyer")
    ap.add_argument("--closing", default=None)
    ap.add_argument("--no-pack", action="store_true")
    args = ap.parse_args()
    storage = os.path.abspath(args.storage)
    os.makedirs(storage, exist_ok=True)
    c = t.Client(os.environ["INTAKE_PSQL"], storage)
    work = os.path.join(storage, "_work")
    uid, company = ensure_company(c, storage)
    tids = []
    for ocid in args.ocid:
        tids.append((ocid, discovered(c, uid, company, args.ocds, ocid)))
    if args.manual:
        files = [os.path.join(dp, f) for dp, _, fs in os.walk(args.manual) for f in sorted(fs)]
        tids.append((args.manual, t.load(c, uid, company, files, args.title, args.buyer, closing=args.closing)))
    bridge.poll_once(c, work)
    for label, tid in tids:
        print(f"\n=== {label} -> tender {tid}")
        report(c, tid, company, work, pack=not args.no_pack)


if __name__ == "__main__":
    main()
