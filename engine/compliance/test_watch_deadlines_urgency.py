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
  5. a second run on the same day reports nothing new (no daily spam).

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
    before = wd.find_documents_lapsing_before_closing("u", "k", seen, today) if hasattr(wd, "find_documents_lapsing_before_closing") else []
    return docs, tasks, before


def main():
    wd.supabase_request = fake_request
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
