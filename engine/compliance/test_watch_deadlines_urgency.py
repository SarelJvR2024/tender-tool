"""
Scenario 7 (docs/specs/Engine-Scenario-Test-Results.md): a tender close to
its closing date, a company whose documents are expiring or expired - does
the reminder engine flag the urgency, and keep flagging it as it gets worse?

Runs watch_deadlines.py's own find_* functions with supabase_request served
from in-memory rows shaped like the real tables (companies 0001/0014,
tender_packs 0001, tenders 0001/0018, tender_tasks 0009) - no network, no
Supabase. Each check is a behaviour a real person relies on:

  1. a document inside the 60-day window is reported (renew soon);
  2. a document expiring AFTER the 60-day window but BEFORE a pursued
     tender's closing date is reported against that tender (the 60-day window
     alone never sees it - it would be expired on closing day);
  3. the same document is reported AGAIN when it moves from "renew soon" to
     "expired" (before the fix the seen-store key ignored the status, so a
     document reported once at 60 days was never reported when it lapsed);
  4. a closing milestone 3 days out is reported, and reported again once it
     is overdue;
  5. a second run on the same day reports nothing new (no daily spam);
  6. a document ALREADY inside the 60-day window is not ALSO reported under
     the "lapses before closing" framing just because a pursued tender
     happens to close after it too (Finding 33, 2026-10-20) - one fact,
     one reminder.

Usage: python3 engine/compliance/test_watch_deadlines_urgency.py
"""
import datetime
import os
import re
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import watch_deadlines as wd  # noqa: E402
import system_alerts  # noqa: E402  (on the path via watch_deadlines)

ALERTS = []
system_alerts.set_sink(lambda payload: ALERTS.append(payload) or "test-alert")

TODAY = datetime.date(2026, 10, 17)
D = lambda n: (TODAY + datetime.timedelta(days=n)).isoformat()  # noqa: E731

ROWS = {
    "companies": [{
        "id": "co1", "legal_name": "Urgent Test Co",
        "coid_letter_of_good_standing_expiry": D(30),   # inside the 60-day window
        "sars_tcs_pin_expiry": D(90),                    # outside it - but before tender T2 closes (day 100)
        "pi_insurance_expiry": D(400),
        "iso_9001_expiry": None,
        "bank_confirmation_letter_valid_until": D(45),
        "bee_proof_expiry": D(-7),                       # already expired
    }],
    "tender_packs": [{"company_id": "co1", "tender_id": "t1"}, {"company_id": "co1", "tender_id": "t2"}],
    "tenders": [
        {"id": "t1", "contract_no": "R.396-010-2025/1F", "title": "closes in 3 days", "closing_date": D(3) + "T10:00:00+00:00", "status": "open"},
        {"id": "t2", "contract_no": "RT83-2026", "title": "closes in 100 days", "closing_date": D(100) + "T09:00:00+00:00", "status": "open"},
    ],
    "tender_tasks": [{"id": "task1", "company_id": "co1", "tender_id": "t1", "description": "Tender closes",
                      "due_date": D(3), "status": "not_started", "kind": "closing"}],
}


def fake_request(url, key, path):
    table, _, query = path.partition("?")
    rows = [dict(r) for r in ROWS.get(table, [])]
    for part in query.split("&"):
        if not part or part.startswith(("select=", "order=")):
            continue
        col, _, cond = part.partition("=")
        cond = urllib.parse.unquote(cond)
        if cond.startswith("eq."):
            rows = [r for r in rows if str(r.get(col)) == cond[3:]]
        elif cond.startswith("neq."):
            rows = [r for r in rows if str(r.get(col)) != cond[4:]]
        elif cond == "not.is.null":
            rows = [r for r in rows if r.get(col) is not None]
        elif cond.startswith("in.("):
            vals = set(re.findall(r"[^,()]+", cond[3:]))
            rows = [r for r in rows if str(r.get(col)) in vals]
        elif cond.startswith("gte."):
            rows = [r for r in rows if r.get(col) is not None and str(r.get(col)) >= cond[4:]]
        else:
            raise AssertionError(f"fake doesn't understand {part!r}")
    return rows


FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def run(seen, today):
    docs = wd.find_due_documents("u", "k", seen, today, wd.DEFAULT_DOC_LEAD_DAYS)
    tasks = wd.find_due_tasks("u", "k", seen, today, wd.DEFAULT_TASK_LEAD_DAYS)
    before = wd.find_documents_lapsing_before_closing("u", "k", seen, today, wd.DEFAULT_DOC_LEAD_DAYS) \
        if hasattr(wd, "find_documents_lapsing_before_closing") else []
    return docs, tasks, before


def days_until_malformed_inputs():
    """days_until()'s own docstring promises a malformed date never crashes
    the whole run - never actually exercised by a test anywhere in the repo
    (confirmed by grep before writing this). Every one of these came from
    reproducing engine/notify/daily_digest.py's --mode local reading a
    hand-edited company profile JSON with no schema behind it (unlike a live
    Postgres `date` column): `date_str[:10]` alone doesn't catch every bad
    shape the same way - a number/bool raises TypeError, a list slices
    harmlessly then fails fromisoformat() with ANOTHER TypeError, and a dict
    raises KeyError (`{}[:10]` is a dict lookup on a slice key, not a slice)
    - three different exception types for three different non-string shapes,
    on top of the existing ValueError for a malformed string. QA pass,
    2026-10-23."""
    print("days_until(): malformed / boundary input never crashes")
    today = datetime.date(2026, 10, 23)
    bad = ("not-a-date", "2026-13-45", 20261231, True, False, ["2026-12-31"], {"x": 1}, "", None)
    for value in bad:
        ALERTS.clear()
        try:
            result = wd.days_until(value, today)
        except Exception as e:
            check(False, f"days_until({value!r}) must not raise, raised {type(e).__name__}: {e}")
            continue
        if value in ("", None, False):
            check(result is None and not ALERTS, f"days_until({value!r}): falsy, no reminder, no alert ({result!r})")
        else:
            check(result is None and len(ALERTS) == 1 and ALERTS[0]["p_source"] == "deadlines"
                  and ALERTS[0]["p_severity"] == "warning",
                  f"days_until({value!r}): not a valid date, no reminder, one warning alert (got {result!r}, "
                  f"{len(ALERTS)} alert(s))")
    ALERTS.clear()
    check(wd.days_until("2026-11-22", today) == 30, "a plain date string still works (30 days out)")
    check(wd.days_until("2026-11-22T09:00:00+02:00", today) == 30,
          "a date+time string still works (only the first 10 chars matter)")
    check(wd.days_until("2026-10-16", today) == -7, "a past date still returns a negative count (already expired)")
    check(not ALERTS, "none of the valid dates above raised a spurious alert")


def main():
    wd.supabase_request = fake_request
    days_until_malformed_inputs()
    seen = {}
    print(f"run 1 - {TODAY}")
    docs, tasks, before = run(seen, TODAY)
    for d in docs + before + tasks:
        print("   ", {k: d.get(k) for k in ("type", "label", "description", "tender_label", "days_left", "status")})
    by = {d["field"]: d for d in docs}
    check("coid_letter_of_good_standing_expiry" in by and by["coid_letter_of_good_standing_expiry"]["status"] == "renew_soon",
          "COID (30 days) reported as renew soon")
    check(by.get("bee_proof_expiry", {}).get("status") == "expired", "B-BBEE (expired 7 days ago) reported as expired")
    check(any(b["field"] == "sars_tcs_pin_expiry" and b["tender_id"] == "t2" for b in before),
          "TCS PIN (90 days, outside the 60-day window) reported because it lapses before RT83-2026 closes (day 100)")
    check(not any(b["field"] == "sars_tcs_pin_expiry" and b["tender_id"] == "t1" for b in before),
          "...but not against R.396 (closes day 3, PIN still valid)")
    check(not any(b["field"] == "coid_letter_of_good_standing_expiry" for b in before),
          "COID (30 days, already inside the 60-day window, also before RT83-2026's day-100 closing) is NOT "
          "duplicated here under a 'lapses before closing' framing - find_due_documents() already reported it "
          "(Finding 33: this used to fire for ANY document inside the normal window too, giving the same fact "
          "two different-looking reminders)")
    check(any(t["task_id"] == "task1" and t["status"] == "due_soon" for t in tasks), "closing milestone 3 days out reported")

    docs2, tasks2, before2 = run(seen, TODAY)
    check(not docs2 and not tasks2 and not before2, f"second run the same day reports nothing new ({len(docs2)}/{len(tasks2)}/{len(before2)})")

    later = TODAY + datetime.timedelta(days=35)
    print(f"run 3 - {later} (COID has now lapsed, the closing milestone is overdue)")
    docs3, tasks3, _ = run(seen, later)
    for d in docs3 + tasks3:
        print("   ", {k: d.get(k) for k in ("type", "label", "description", "days_left", "status")})
    check(any(d["field"] == "coid_letter_of_good_standing_expiry" and d["status"] == "expired" for d in docs3),
          "COID reported AGAIN once it has expired (escalation, not silence)")
    check(any(t["task_id"] == "task1" and t["status"] == "overdue" for t in tasks3),
          "closing milestone reported again as overdue")

    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
