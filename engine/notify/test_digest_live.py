"""
daily_digest.py --mode live: tender fit is scored per company, from each
company's own profile (engine/discovery/company_profiles.py), exactly as the
Discovery feed does - and every section of a person's digest is their own
company's (audit follow-up (e), Sarel 2026-10-17).

Before this, live mode scored nothing: it printed "live mode's national-feed
fetch needs a company profile per company" and left new_tenders /
submission_due empty, and its document-expiry / task / readiness sections
were every company's items in every person's digest.

Runs daily_digest.main() with --mode live and the Supabase env vars set, over
in-memory rows shaped like the real tables (companies, experience_items,
company_offices, company_members, people, tender_tasks, field_provenance):
  - watch_deadlines.supabase_request -> the in-memory PostgREST fake from
    engine/compliance/test_watch_deadlines_urgency.py;
  - company_profiles.RestClient -> an in-memory client over the same rows
    (the REAL all_company_profiles()/profile_from_company_rows() run on it,
    spied on to prove the path reaches them);
  - daily_digest.fetch_releases -> the two real sample tenders the fan-out
    test uses (TN051 security services, SCMU5 architectural PSP), their own
    PDFs read through assess_tender.fetch_pdf_text. Nothing else is faked.

No network, no Supabase - this is not a run against a live project (none
exists, System-Status gap 9).

    python3 engine/notify/test_digest_live.py
"""
import datetime
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "engine", "discovery"))
sys.path.insert(0, os.path.join(ROOT, "engine", "compliance"))
import daily_digest  # noqa: E402
import company_profiles  # noqa: E402
import watch_deadlines  # noqa: E402
import test_watch_deadlines_urgency as pgrest  # noqa: E402  (its in-memory fake_request)
import test_discovery_fanout as fanout  # noqa: E402  (the two real sample releases)

FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


TODAY = datetime.date.today()


def D(n):
    return (TODAY + datetime.timedelta(days=n)).isoformat()


ROWS = {
    "companies": [
        {"id": "co-guard", "legal_name": "Digest Guarding CC", "bee_level": 1, "black_ownership_pct": 100,
         "cidb_grading": None, "registered_address": None, "is_test_company": False,
         "coid_letter_of_good_standing_expiry": D(20)},
        {"id": "co-arch", "legal_name": "Digest Architects Inc", "bee_level": 2, "black_ownership_pct": 51,
         "cidb_grading": "6GB", "registered_address": None, "is_test_company": False,
         "coid_letter_of_good_standing_expiry": D(10)},
        {"id": "co-test", "legal_name": "Digest Harness Test Co", "bee_level": None, "black_ownership_pct": None,
         "cidb_grading": None, "registered_address": None, "is_test_company": True},
    ],
    "experience_items": [
        {"id": "e1", "company_id": "co-guard", "disciplines": ["security_facilities"], "tagged_at": "2026-10-01"},
        {"id": "e2", "company_id": "co-arch", "disciplines": ["buildings", "professional_services"],
         "tagged_at": "2026-10-01"},
        {"id": "e3", "company_id": "co-test", "disciplines": ["security_facilities"], "tagged_at": "2026-10-01"},
    ],
    "company_offices": [
        {"company_id": "co-guard", "province": "Northern Cape", "office_kind": "head_office"},
        {"company_id": "co-arch", "province": "Eastern Cape", "office_kind": "head_office"},
    ],
    "company_members": [
        {"user_id": "u-guard", "company_id": "co-guard", "tender_role": "full_cycle",
         "companies": {"legal_name": "Digest Guarding CC"}},
        {"user_id": "u-arch", "company_id": "co-arch", "tender_role": "full_cycle",
         "companies": {"legal_name": "Digest Architects Inc"}},
        {"user_id": "u-arch-viewer", "company_id": "co-arch", "tender_role": "viewer",
         "companies": {"legal_name": "Digest Architects Inc"}},
    ],
    "people": [],
    "tender_tasks": [
        {"id": "t-guard", "company_id": "co-guard", "tender_id": "tn1", "description": "Site visit",
         "due_date": D(3), "status": "todo", "kind": None},
        {"id": "t-arch", "company_id": "co-arch", "tender_id": "tn1", "description": "Clarification",
         "due_date": D(4), "status": "todo", "kind": None},
    ],
    "tenders": [{"id": "tn1", "contract_no": "X1", "title": "Some tender", "closing_date": D(30), "status": "open"}],
    "tender_packs": [{"id": "pk-arch", "company_id": "co-arch", "tender_id": "tn1"}],
    "field_provenance": [{"id": "fp1", "tender_pack_id": "pk-arch", "field_key": "company.bee_level",
                          "status": "missing", "reason": "no certificate", "updated_at": "2026-10-17"}],
}


class MemClient:
    """company_profiles' client interface (.select(table, filters)) over ROWS."""

    def select(self, table, filters=None, order=None):
        rows = [dict(r) for r in ROWS.get(table, [])]
        for k, v in (filters or {}).items():
            rows = [r for r in rows if r.get(k) == v]
        return rows


def main():
    pgrest.ROWS.clear()
    pgrest.ROWS.update(ROWS)
    watch_deadlines.supabase_request = pgrest.fake_request
    company_profiles.RestClient = lambda url, key: MemClient()

    calls = {"all_company_profiles": 0, "profile_from_company_rows": []}
    real_all, real_one = company_profiles.all_company_profiles, company_profiles.profile_from_company_rows

    def spy_all(client, include_test_companies=True):
        calls["all_company_profiles"] += 1
        return real_all(client, include_test_companies)

    def spy_one(client, company_id, company=None):
        calls["profile_from_company_rows"].append(company_id)
        return real_one(client, company_id, company)
    company_profiles.all_company_profiles = spy_all
    company_profiles.profile_from_company_rows = spy_one
    daily_digest.fetch_releases = lambda days=14: [dict(r) for r in fanout.RELEASES]

    tmp = tempfile.mkdtemp()
    out_path = os.path.join(tmp, "digest.json")

    def run(*extra):
        sys.argv = ["daily_digest.py", "--mode", "live", "--seen-store", os.path.join(tmp, "seen.json"),
                    "--out", out_path, *extra]
        os.environ["NEXT_PUBLIC_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "http://fake", "fake-key"
        daily_digest.main()
        return {d["person"]["name"]: d for d in json.load(open(out_path))}

    print("Live mode, every company scored from its own rows")
    digests = run()
    check(calls["all_company_profiles"] == 1, "live mode reaches company_profiles.all_company_profiles()")
    check(sorted(calls["profile_from_company_rows"]) == ["co-arch", "co-guard", "co-test"],
          f"each company's profile built from its own rows, test company included ({calls['profile_from_company_rows']})")

    tn051, scmu5 = (fanout.SAMPLES[k]["reference"] for k in ("dawid_kruiper_tn051", "ecdpwi_scmu5_0007"))
    g, a, v = digests["u-guard"], digests["u-arch"], digests["u-arch-viewer"]
    g_new = {r["contract_number"]: r["verdict"] for r in g["new_tenders"]}
    a_new = {r["contract_number"]: r["verdict"] for r in a["new_tenders"]}
    print(f"    guarding digest new_tenders:   {g_new}")
    print(f"    architects digest new_tenders: {a_new}")
    check(g_new == {tn051: "strong_fit"}, "guarding company's digest: the security tender, its own strong_fit only")
    check(a_new == {scmu5: "strong_fit"}, "architects' digest: the architectural tender, its own strong_fit only")
    check(all(r.get("score_outlook") and r.get("reasons") for r in g["new_tenders"] + a["new_tenders"]),
          "each new-tender item carries that company's own reasons and score outlook")
    g_out = json.dumps(g["new_tenders"][0]["score_outlook"], sort_keys=True)
    a_out = json.dumps(a["new_tenders"][0]["score_outlook"], sort_keys=True)
    check(g_out != a_out, "score outlooks differ per company")
    check(v["new_tenders"] == {"count": 1, "closest_closing_date": "2099-01-01T11:00:00Z"},
          f"architects' viewer: a count of the architects' own matches ({v['new_tenders']})")
    check(g["submission_due"] == [] and a["submission_due"] == [],
          "submission_due: computed from the company's own verdicts (the samples close in 2099, so none due)")

    g_docs = [(i["company_id"], i["field"]) for i in g["document_expiry"]]
    a_docs = [(i["company_id"], i["field"]) for i in a["document_expiry"]]
    check(g_docs == [("co-guard", "coid_letter_of_good_standing_expiry")],
          f"document expiry: guarding digest has only its own COID ({g_docs})")
    check(a_docs == [("co-arch", "coid_letter_of_good_standing_expiry")],
          f"document expiry: architects' digest has only its own COID ({a_docs})")
    check(len(g["tender_tasks"]) == 1 and all(t["company_id"] == "co-guard" for t in g["tender_tasks"]),
          "tender tasks: only the guarding company's own")
    check(all(t["company_id"] == "co-arch" for t in a["tender_tasks"]) and len(a["tender_tasks"]) == 1,
          "tender tasks: only the architects' own")
    check(g["readiness_changes"] == [] and [c["field_key"] for c in a["readiness_changes"]] == ["company.bee_level"],
          "readiness changes: the architects' pack change goes to the architects only")

    print("Live mode with --exclude-test-companies")
    calls["profile_from_company_rows"].clear()
    run("--exclude-test-companies")
    check(sorted(calls["profile_from_company_rows"]) == ["co-arch", "co-guard"],
          "--exclude-test-companies: the test company isn't scored")

    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
