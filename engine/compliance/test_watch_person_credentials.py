"""
Per-person registration expiry reminders (Deep-Dive item 21, migration 0035)
through the SAME reminder mechanism as the company documents:
watch_deadlines.find_due_person_credentials() -> _expiry_window(), one
seen-store, one lead-time window, one escalation rule. And the role-based
digest's routing of those items (engine/notify/daily_digest.py).

In-memory rows shaped like the real tables (people 0001+0035, companies
0001), served through test_watch_deadlines_urgency.py's own fake PostgREST -
no network, no Supabase. Checks:

  1. an ECSA registration lapsing in 20 days is reported (renew soon), with
     the person, company and registration number;
  2. one 200 days out, and a person with no expiry recorded, are not;
  3. an already-lapsed SACPCMP registration is reported as expired;
  4. a second run the same day reports nothing (once per window, not daily);
  5. the 20-day ECSA item is reported AGAIN once it actually lapses;
  6. after renewal (new expiry date, outside the window) nothing is reported;
  7. the digest (live and local mode): full_cycle sees person items and company documents,
     cv_admin only person items, finance only company documents, viewer a
     count of both, validator nothing.

Usage: python3 engine/compliance/test_watch_person_credentials.py
"""
import datetime
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "notify"))
import watch_deadlines as wd  # noqa: E402
import test_watch_deadlines_urgency as fixture  # noqa: E402  (reuses its fake_request)

TODAY = fixture.TODAY
D = fixture.D

fixture.ROWS.clear()
fixture.ROWS.update({
    "companies": [{"id": "co1", "legal_name": "Credential Test Co"}, {"id": "co2", "legal_name": "Other Test Co"}],
    "people": [
        {"id": "p1", "company_id": "co1", "name": "Pat Engineer", "ecsa_number": "20150155", "ecsa_expiry": D(20),
         "sacpcmp_number": None, "sacpcmp_expiry": None},
        {"id": "p2", "company_id": "co1", "name": "Sam Later", "ecsa_number": "20000002", "ecsa_expiry": D(200),
         "sacpcmp_number": None, "sacpcmp_expiry": None},
        {"id": "p3", "company_id": "co1", "name": "No Expiry Recorded", "ecsa_number": "20000003", "ecsa_expiry": None,
         "sacpcmp_number": "PrCPM/0001", "sacpcmp_expiry": None},
        {"id": "p4", "company_id": "co2", "name": "Lee Safety", "ecsa_number": None, "ecsa_expiry": None,
         "sacpcmp_number": "CHSO/1234/2020", "sacpcmp_expiry": D(-3)},
    ],
})

FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def run(seen, today):
    return wd.find_due_person_credentials("u", "k", seen, today, wd.DEFAULT_DOC_LEAD_DAYS)


def main():
    wd.supabase_request = fixture.fake_request
    seen = {}

    print(f"run 1 - {TODAY}")
    due = run(seen, TODAY)
    for d in due:
        print("   ", {k: d.get(k) for k in ("person_name", "company_name", "label", "registration_number", "days_left", "status")})
    by = {(d["person_id"], d["field"]): d for d in due}
    p1 = by.get(("p1", "ecsa_expiry"))
    check(p1 is not None and p1["status"] == "renew_soon" and p1["days_left"] == 20,
          "ECSA lapsing in 20 days reported as renew soon")
    check(p1 is not None and p1["person_name"] == "Pat Engineer" and p1["company_name"] == "Credential Test Co"
          and p1["registration_number"] == "20150155", "...naming the person, company and registration number")
    check(("p2", "ecsa_expiry") not in by, "ECSA 200 days out not reported")
    check(not any(d["person_id"] == "p3" for d in due), "registered person with no expiry recorded not reported")
    p4 = by.get(("p4", "sacpcmp_expiry"))
    check(p4 is not None and p4["status"] == "expired" and p4["company_name"] == "Other Test Co",
          "SACPCMP lapsed 3 days ago reported as expired (other company scanned too)")
    check(len(due) == 2, f"exactly 2 items on run 1 (got {len(due)})")
    check(all(k.startswith("person::") for k in seen), "recorded in the shared seen-store under person:: keys")

    again = run(seen, TODAY)
    check(not again, f"second run the same day reports nothing new ({len(again)})")
    next_day = run(seen, TODAY + datetime.timedelta(days=1))
    check(not next_day, f"next day, still inside the same window, reports nothing new ({len(next_day)})")

    later = TODAY + datetime.timedelta(days=21)
    lapsed = run(seen, later)
    check([(d["person_id"], d["status"]) for d in lapsed] == [("p1", "expired")],
          f"day 21: Pat's ECSA reported again, now expired - and nothing else ({[(d['person_id'], d['status']) for d in lapsed]})")

    fixture.ROWS["people"][0]["ecsa_expiry"] = (later + datetime.timedelta(days=5 * 365)).isoformat()
    renewed = run(seen, later + datetime.timedelta(days=1))
    check(not renewed, "after renewal to a date 5 years out, nothing reported")

    # --- digest routing ---------------------------------------------------
    import daily_digest  # noqa: E402
    company_doc = {"type": "document", "label": "COID Letter of Good Standing", "days_left": 30, "status": "renew_soon"}
    signals = {"new_tenders": [], "document_expiry": [company_doc] + due, "tender_tasks": [],
               "readiness_changes": [], "submission_due": []}

    def section(role):
        d = daily_digest.build_digest_for_person({"name": role, "tender_role": role, "company_name": "x"}, signals)
        return d.get("document_expiry")

    full, cv, fin, viewer, validator = (section(r) for r in ("full_cycle", "cv_admin", "finance", "viewer", "validator"))
    check(len(full) == 3, f"full_cycle: company document + both person registrations ({len(full)})")
    check(len(cv) == 2 and all(i["type"] == "person_credential" for i in cv), "cv_admin: only the person registrations")
    check(len(fin) == 1 and fin[0]["type"] == "document", "finance: only the company document")
    check(viewer == {"count": 3}, f"viewer: count only ({viewer})")
    check(validator is None, "validator: no document-expiry section at all")

    profile = {"key_people": [{"name": "Pat Engineer", "qualifications": {"ecsa_number": "20150155", "ecsa_expiry": D(10)}},
                              {"name": "Sam Later", "qualifications": {"ecsa_number": "2", "ecsa_expiry": D(300)}}]}
    local = daily_digest.local_person_credential_expiry(profile, TODAY, wd.DEFAULT_DOC_LEAD_DAYS)
    check([(i["person_name"], i["status"]) for i in local] == [("Pat Engineer", "renew_soon")],
          "digest --mode local reads the same columns from the profile JSON")

    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
