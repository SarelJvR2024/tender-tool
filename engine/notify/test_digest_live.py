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
        # A member whose auth.users row has no e-mail (0048: named, never by id).
        {"user_id": "u-guard-noemail", "company_id": "co-guard", "tender_role": "validator",
         "companies": {"legal_name": "Digest Guarding CC"}},
    ],
    # auth.users, as company_member_labels() (0033/0048) reads it for the
    # service role: user_id -> e-mail (coalesced to 'a team member').
    "_member_labels": [
        {"user_id": "u-guard", "label": "thandi@guarding.example"},
        {"user_id": "u-arch", "label": "pieter@architects.example"},
        {"user_id": "u-arch-viewer", "label": "lerato@architects.example"},
        {"user_id": "u-guard-noemail", "label": "a team member"},
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
    """company_profiles' client interface (.select(table, filters), .upsert)
    over ROWS - including the 0041 seen-store tables the digest now keeps in
    the database instead of state/seen_digest_readiness.json."""

    def select(self, table, filters=None, order=None):
        rows = [dict(r) for r in ROWS.get(table, [])]
        for k, v in (filters or {}).items():
            rows = [r for r in rows if r.get(k) == v]
        return rows

    def upsert(self, table, rows, on_conflict):
        keys = on_conflict.split(",")
        store = ROWS.setdefault(table, [])
        for row in rows:
            hit = next((r for r in store if all(r.get(k) == row.get(k) for k in keys)), None)
            if hit:
                hit.update(row)
            else:
                store.append(dict(row))
        return rows

    def rpc(self, fn, args=None):
        assert fn == "company_member_labels", fn
        return [dict(r) for r in ROWS["_member_labels"]]


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
        sys.argv = ["daily_digest.py", "--mode", "live", "--out", out_path, *extra]
        os.environ["NEXT_PUBLIC_SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "http://fake", "fake-key"
        daily_digest.main()
        return {d["person"]["name"]: d for d in json.load(open(out_path))}

    print("Live mode, every company scored from its own rows")
    digests = run()
    check(calls["all_company_profiles"] == 1, "live mode reaches company_profiles.all_company_profiles()")
    check(sorted(calls["profile_from_company_rows"]) == ["co-arch", "co-guard", "co-test"],
          f"each company's profile built from its own rows, test company included ({calls['profile_from_company_rows']})")

    tn051, scmu5 = (fanout.SAMPLES[k]["reference"] for k in ("dawid_kruiper_tn051", "ecdpwi_scmu5_0007"))
    check(sorted(digests) == sorted(["thandi@guarding.example", "pieter@architects.example", "lerato@architects.example",
                                      "a team member (no e-mail found)"]),
          f"every person named by e-mail (company_member_labels), none by user id ({sorted(digests)})")
    check(all(d["person"]["email"] == d["person"]["name"] for k, d in digests.items() if "@" in k)
          and digests["a team member (no e-mail found)"]["person"]["email"] is None,
          "person.email set from the label; a member with no e-mail has email null, not a user id")
    check(not any(u in json.dumps([d["person"] for d in digests.values()]) for u in ("u-guard", "u-arch")),
          "no raw user id anywhere in the digests' person blocks")
    g, a, v = digests["thandi@guarding.example"], digests["pieter@architects.example"], digests["lerato@architects.example"]
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

    print("Seen stores in the database (0041), not a local file")
    dl = ROWS.get("deadline_reminders_seen", [])
    rd = ROWS.get("digest_readiness_seen", [])
    check(sorted((r["company_id"], r["kind"]) for r in dl) ==
          [("co-arch", "document"), ("co-arch", "task"), ("co-guard", "document"), ("co-guard", "task")]
          and all(r["consumer"] == "daily_digest" for r in dl),
          f"deadline items reported -> deadline_reminders_seen rows, per company, consumer daily_digest ({len(dl)})")
    check([(r["company_id"], r["field_provenance_id"], r["status"]) for r in rd] == [("co-arch", "fp1", "missing")],
          f"readiness status -> digest_readiness_seen, under the pack's company ({rd})")
    check(not os.listdir(tmp) or os.listdir(tmp) == ["digest.json"], "no local seen file written")

    print("Live mode with --exclude-test-companies (second run: seen stores read back from the database)")
    calls["profile_from_company_rows"].clear()
    digests2 = run("--exclude-test-companies")
    check(sorted(calls["profile_from_company_rows"]) == ["co-arch", "co-guard"],
          "--exclude-test-companies: the test company isn't scored")
    check(all(d["document_expiry"] == [] and d["tender_tasks"] == [] and d["readiness_changes"] == []
              for d in (digests2["thandi@guarding.example"], digests2["pieter@architects.example"])),
          "second run: nothing reported again (COIDs, tasks, readiness change all seen)")
    ROWS["field_provenance"][0]["status"] = "confirmed"
    digests3 = run()
    check([(c["previous_status"], c["status"]) for c in digests3["pieter@architects.example"]["readiness_changes"]] == [("missing", "confirmed")]
          and [r["status"] for r in ROWS["digest_readiness_seen"]] == ["confirmed"],
          "a status change is reported once (missing -> confirmed) and the stored status updated")

    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
