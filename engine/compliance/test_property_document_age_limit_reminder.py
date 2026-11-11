"""
Finding 421 (standing review, 2026-11-11): two of the 16 property-document
types - pest_control_certificate and sapoa_grading (app/lib/properties.ts's
own PROPERTY_DOCUMENT_TYPES, maxAgeMonths: 12) - have no fixed expiry date
at all; their real "still valid" test is an age limit counted from
issued_on. The Properties page's own upload form labels valid_until
"Valid until (if it has one)" for exactly this reason, so these two types
realistically get saved with issued_on set and valid_until left null.

Before this fix, registration_reminders.find_due_property_documents() and
find_property_documents_lapsing_before_closing() both keyed purely off
valid_until, so a null valid_until made the row invisible to BOTH reminder
functions forever, no matter how stale issued_on got - confirmed live:
test_principals_registrations.py's own Part 2 fixture already inserts a
pest_control_certificate issued 400 days ago with valid_until null, and its
own assertion (len(pdue) == 1) already says only the sibling row with a
real valid_until gets reported. The only place this was ever surfaced was
lib/properties.ts's own tooOld(), a client-render-time-only check on the
Properties page itself - no email, no daily digest, no "lapses before
closing on an open tender" warning.

Runs registration_reminders.py's own find_* functions with supabase_request
served from in-memory rows (test_watch_deadlines_urgency's fake PostgREST) -
no network, no Supabase.

Usage: python3 engine/compliance/test_property_document_age_limit_reminder.py
"""
import datetime
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "notify"))
import watch_deadlines as wd  # noqa: E402
import registration_reminders as rr  # noqa: E402
import test_watch_deadlines_urgency as fixture  # noqa: E402

TODAY = fixture.TODAY
D = fixture.D
FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def issued(days_ago):
    return (TODAY - datetime.timedelta(days=days_ago)).isoformat()


def setup_rows():
    fixture.ROWS.clear()
    fixture.ROWS.update({
        "companies": [{"id": "co1", "legal_name": "Age-Limit Test Co"}],
        "company_properties": [{"id": "prop1", "company_id": "co1", "label": "Lichtenburg office"}],
        "property_documents": [
            # Issued 400 days ago (> 12-month limit = already stale by
            # roughly 35 days), no valid_until at all - the real-world shape
            # a pest control certificate's own upload row actually has.
            {"id": "pd-stale-pest", "company_id": "co1", "property_id": "prop1",
             "document_type": "pest_control_certificate", "reference_number": "PC-1",
             "issued_on": issued(400), "valid_until": None},
            # Issued 10 days ago - well inside its 12-month limit, no
            # valid_until either. Must NOT be reported: the age limit isn't
            # even close to being hit yet.
            {"id": "pd-fresh-sapoa", "company_id": "co1", "property_id": "prop1",
             "document_type": "sapoa_grading", "reference_number": "SG-1",
             "issued_on": issued(10), "valid_until": None},
            # A document type with NO age-limit rule at all and no
            # valid_until (e.g. a title deed) - must still never be reported,
            # preserving the existing, correct behaviour for every type that
            # genuinely has no expiry concept.
            {"id": "pd-title-deed", "company_id": "co1", "property_id": "prop1",
             "document_type": "title_deed", "reference_number": "T-1",
             "issued_on": issued(5000), "valid_until": None},
            # A real valid_until still takes priority over any computed
            # age-limit date, and keeps working exactly as before.
            {"id": "pd-building-insurance", "company_id": "co1", "property_id": "prop1",
             "document_type": "building_insurance", "reference_number": "POL-1",
             "issued_on": issued(300), "valid_until": D(10)},
        ],
        "tender_packs": [{"company_id": "co1", "tender_id": "t1"}],
        # Closes in 40 days - inside the 12-month pest-control age limit's
        # normal window test below (part of a SEPARATE "lapses before
        # closing" scenario further down), but NOT used by the main renew-
        # soon/expired checks above.
        "tenders": [{"id": "t1", "contract_no": "RT-AGE-1", "title": "closes in 40 days",
                    "status": "open", "closing_date": D(40) + "T10:00:00+00:00"}],
    })


def part1_renew_soon_and_expired():
    print("1. find_due_property_documents(): age-limited types with no valid_until")
    setup_rows()
    wd.supabase_request = fixture.fake_request
    seen = {}
    due = rr.find_due_property_documents("u", "k", seen, TODAY, wd.DEFAULT_DOC_LEAD_DAYS)
    by = {d["property_document_id"]: d for d in due}
    check(by.get("pd-stale-pest", {}).get("status") == "expired",
          f"a pest control certificate issued 400 days ago (no valid_until) is reported EXPIRED, got {by.get('pd-stale-pest')}")
    check("pd-fresh-sapoa" not in by,
          "a SAPOA grading issued only 10 days ago (no valid_until) is NOT reported - nowhere near its 12-month limit")
    check("pd-title-deed" not in by,
          "a title deed (no age-limit rule, no valid_until) is still never reported")
    check(by.get("pd-building-insurance", {}).get("status") == "renew_soon" and by["pd-building-insurance"]["days_left"] == 10,
          "building insurance with a real valid_until still works exactly as before")
    check(len(due) == 2, f"exactly 2 items reported, not 4 ({len(due)})")

    again = rr.find_due_property_documents("u", "k", seen, TODAY, wd.DEFAULT_DOC_LEAD_DAYS)
    check(not again, "a second run the same day reports nothing new (seen-store de-dup)")


def part2_renew_soon_boundary():
    print("2. find_due_property_documents(): an age-limited document crossing INTO the renew-soon window")
    fixture.ROWS.clear()
    fixture.ROWS.update({
        "companies": [{"id": "co1", "legal_name": "Age-Limit Test Co"}],
        "company_properties": [{"id": "prop1", "company_id": "co1", "label": "Lichtenburg office"}],
        "property_documents": [
            # 12 months = 365/366 days; issued 310 days ago leaves ~55-56
            # days before the age limit is hit - inside the 60-day lead
            # window, so this should read "renew_soon", not "expired".
            {"id": "pd-renew-soon-pest", "company_id": "co1", "property_id": "prop1",
             "document_type": "pest_control_certificate", "reference_number": "PC-2",
             "issued_on": issued(310), "valid_until": None},
        ],
        "tender_packs": [],
        "tenders": [],
    })
    wd.supabase_request = fixture.fake_request
    seen = {}
    due = rr.find_due_property_documents("u", "k", seen, TODAY, wd.DEFAULT_DOC_LEAD_DAYS)
    by = {d["property_document_id"]: d for d in due}
    check(by.get("pd-renew-soon-pest", {}).get("status") == "renew_soon",
          f"a pest control certificate issued 310 days ago (~55 days left on its 12-month limit) reads renew_soon, got {by.get('pd-renew-soon-pest')}")


def part3_lapses_before_closing():
    print("3. find_property_documents_lapsing_before_closing(): age-limited type, outside the normal window, lapses before an open tender's closing date")
    fixture.ROWS.clear()
    fixture.ROWS.update({
        "companies": [{"id": "co1", "legal_name": "Age-Limit Test Co"}],
        "company_properties": [{"id": "prop1", "company_id": "co1", "label": "Lichtenburg office"}],
        "property_documents": [
            # Issued 280 days ago -> ~85-86 days left on the 12-month limit:
            # outside the normal 60-day lead window, but the company has an
            # open tender_pack closing in 100 days - well past that age
            # limit, so this should be caught as "lapses_before_closing".
            {"id": "pd-lapses-pest", "company_id": "co1", "property_id": "prop1",
             "document_type": "pest_control_certificate", "reference_number": "PC-3",
             "issued_on": issued(280), "valid_until": None},
        ],
        "tender_packs": [{"company_id": "co1", "tender_id": "t1"}],
        "tenders": [{"id": "t1", "contract_no": "RT-AGE-3", "title": "closes in 100 days",
                    "status": "open", "closing_date": D(100) + "T10:00:00+00:00"}],
    })
    wd.supabase_request = fixture.fake_request
    seen = {}
    normal = rr.find_due_property_documents("u", "k", seen, TODAY, wd.DEFAULT_DOC_LEAD_DAYS)
    check(not normal, f"outside the normal 60-day window, so find_due_property_documents reports nothing yet ({normal})")
    before_closing = rr.find_property_documents_lapsing_before_closing("u", "k", seen, TODAY, wd.DEFAULT_DOC_LEAD_DAYS)
    by = {d["property_document_id"]: d for d in before_closing}
    check(by.get("pd-lapses-pest", {}).get("status") == "lapses_before_closing"
          and by["pd-lapses-pest"]["tender_label"] == "RT-AGE-3",
          f"a pest control certificate that will have aged out before the open tender's closing date is reported, got {before_closing}")
    again = rr.find_property_documents_lapsing_before_closing("u", "k", seen, TODAY, wd.DEFAULT_DOC_LEAD_DAYS)
    check(not again, "a second run the same day reports nothing new (seen-store de-dup)")


def part4_add_months_leap_day_clamp():
    print("4. _add_months_clamped(): leap-day issue date clamps instead of overflowing (matches date-fns's addMonths())")
    clamped = rr._add_months_clamped(datetime.date(2028, 2, 29), 12)
    check(clamped == datetime.date(2029, 2, 28), f"2028-02-29 + 12 months clamps to 2029-02-28, got {clamped}")


def main():
    part1_renew_soon_and_expired()
    part2_renew_soon_boundary()
    part3_lapses_before_closing()
    part4_add_months_leap_day_clamp()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
