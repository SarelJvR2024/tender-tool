"""
Deadline watch: document-expiry reminders + tender task/deadline reminders.

Same family and same deliberate boundary as
engine/discovery/watch_new_tenders.py: find what's newly due for a reminder,
diff against a local "seen" store so a run only ever reports something once
per lead-time window (not every single day it stays in that window), print a
summary, and - with --out - write the full list as JSON. Nothing here sends
an email, Slack message, or any other notification itself. Sarel's one real
notification channel today is the scheduled check-in that emails him from
watch_new_tenders.py's own output; there is no separate email-sending wrapper
script committed anywhere in this repo (confirmed: no cron file, no mail
client import, nothing under engine/ that calls smtplib or an email API -
the daily tender-watch email is sent by that scheduled Claude session
check-in reading watch_new_tenders.py's output, not by code). So the
reuse here is: produce a report in the exact same shape/spirit (print one
line per item, write --out JSON for a human/scheduled-session to read and
turn into the real email), and let that same scheduled check-in pick this
script's output up too, by also running `watch_deadlines.py --out ...` as
part of whatever reads watch_new_tenders.py's output today. Building an
actual mail-sender here would be a second, parallel notification mechanism -
explicitly out of scope (see the Tender-Tool-Competitor-Feature-Deep-Dive.md
section this script implements).

Two independent things get watched, in one run, sharing one seen-store file
(keeping two parallel scripts/seen-stores was considered and rejected - the
spec is explicit that tender-task reminders should reuse the *same*
mechanism as document-expiry reminders, not a second one):

1. Document expiry (Document Vault, app/app/company/page.tsx). Reads every
   company row's tracked expiry column(s) over the Supabase REST API (same
   connection pattern as engine/seed_supabase_company.py - service-role key,
   plain urllib, no supabase-py dependency) and reports any that are inside
   the reminder lead time (default 60 days - deliberately matched to
   app/lib/dates.ts's own `expiryStatus(..., renewSoonWithinDays = 60)`,
   not an arbitrarily different number, so "about to get an email" and
   "showing amber on the vault page" mean the same threshold) or already
   expired.

   TRACKED_EXPIRY_FIELDS below is the one column confirmed by actually
   reading the schema (app/supabase/migrations/0001_init_schema.sql):
   companies.coid_letter_of_good_standing_expiry. The spec text that asked
   for this script says "COID, B-BBEE, insurance, CSD etc." but the schema
   only has a real expiry *date* column for COID today - B-BBEE/insurance/CSD
   have no expiry column anywhere in companies or any other table as of
   migration 0009. Rather than guess at column names that don't exist, this
   is flagged as an open item in
   docs/specs/Document-Expiry-Tracked-Fields-Open-Item.md and
   TRACKED_EXPIRY_FIELDS is written as a short, explicit list specifically so
   adding a real column later (e.g. `bee_certificate_expiry`) is a one-line
   addition here, not a rewrite.

2. Tender task due dates (tender_tasks, migration 0009_tender_tasks.sql -
   app/app/tenders/[id]/page.tsx's task/deadline timeline). Reports any
   not-yet-done task whose due_date is inside --task-lead-days (default 14 -
   deliberately shorter than the 60-day document lead time: a task like
   "confirm the subcontractor" needs a much tighter warning than a
   compliance certificate does) or already overdue.

Usage:
    python3 watch_deadlines.py [--doc-lead-days 60] [--task-lead-days 14]
        [--seen-store PATH] [--out report.json]

Requires the same environment variables as engine/seed_supabase_company.py:
    NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
(service-role key, not anon - this reads across every tenant, which the
anon key's RLS would never allow; same justification as every other
engine/*.py script that talks to Supabase directly.)

The "seen" store (state/seen_deadlines.json, gitignored - per-deployment
state, not code, same as watch_new_tenders.py's state/seen_tenders.json)
tracks every (item, due-or-expiry-date) pair already reported, so a
document or task stays in the window without re-triggering a report every
run. If the underlying date changes - a document gets renewed to a new
expiry, a task's due date gets pushed - that is a new key, so it reports
again, exactly like a genuinely new deadline. A task that leaves the
"not done" set (marked done) simply stops being fetched, so it needs no
explicit removal from the seen store.
"""
import os
import sys
import json
import argparse
import datetime
import urllib.request
import urllib.error

DEFAULT_SEEN_STORE = os.path.join(os.path.dirname(__file__), "..", "..", "state", "seen_deadlines.json")

# See module docstring part 1 - only a column actually confirmed present on
# `companies` by reading app/supabase/migrations/0001_init_schema.sql goes
# here. (field_column, human_label).
TRACKED_EXPIRY_FIELDS = [
    ("coid_letter_of_good_standing_expiry", "COID Letter of Good Standing"),
]

DEFAULT_DOC_LEAD_DAYS = 60  # matches app/lib/dates.ts's renewSoonWithinDays default
DEFAULT_TASK_LEAD_DAYS = 14


def supabase_request(url, service_key, path):
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        method="GET",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"GET {path} failed: {e.code} {e.read().decode()}")


def load_seen(path):
    try:
        return json.load(open(path))
    except (OSError, json.JSONDecodeError):
        return {}


def save_seen(path, seen):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(seen, f, indent=2)


def days_until(date_str, today):
    """Mirrors app/lib/dates.ts's daysUntil: midnight-truncated, ceil'd."""
    if not date_str:
        return None
    d = datetime.date.fromisoformat(date_str[:10])
    return (d - today).days


def find_due_documents(url, key, seen, today, lead_days):
    select_cols = "id,legal_name," + ",".join(col for col, _ in TRACKED_EXPIRY_FIELDS)
    companies = supabase_request(url, key, f"companies?select={select_cols}")

    due = []
    for company in companies:
        for col, label in TRACKED_EXPIRY_FIELDS:
            expiry = company.get(col)
            if not expiry:
                continue
            left = days_until(expiry, today)
            if left is None or left > lead_days:
                continue  # not expired and outside the reminder window

            seen_key = f"doc::{company['id']}::{col}::{expiry}"
            if seen_key in seen:
                continue
            seen[seen_key] = {"first_seen": today.isoformat(), "kind": "document"}

            due.append({
                "type": "document",
                "company_id": company["id"],
                "company_name": company.get("legal_name"),
                "field": col,
                "label": label,
                "expiry_date": expiry,
                "days_left": left,
                "status": "expired" if left < 0 else "renew_soon",
            })
    return due


def find_due_tasks(url, key, seen, today, lead_days):
    tasks = supabase_request(
        url, key,
        "tender_tasks?select=id,company_id,tender_id,description,due_date,status,kind"
        "&status=neq.done&due_date=not.is.null&order=due_date.asc",
    )

    tender_ids = sorted({t["tender_id"] for t in tasks if t.get("tender_id")})
    tenders_by_id = {}
    if tender_ids:
        in_list = ",".join(tender_ids)
        tender_rows = supabase_request(
            url, key, f"tenders?select=id,contract_no,title&id=in.({in_list})"
        )
        tenders_by_id = {t["id"]: t for t in tender_rows}

    due = []
    for task in tasks:
        left = days_until(task["due_date"], today)
        if left is None or left > lead_days:
            continue

        seen_key = f"task::{task['id']}::{task['due_date']}"
        if seen_key in seen:
            continue
        seen[seen_key] = {"first_seen": today.isoformat(), "kind": "task"}

        tender = tenders_by_id.get(task["tender_id"], {})
        due.append({
            "type": "task",
            "task_id": task["id"],
            "company_id": task["company_id"],
            "tender_id": task["tender_id"],
            "tender_label": tender.get("contract_no") or tender.get("title") or task["tender_id"],
            "description": task["description"],
            "due_date": task["due_date"],
            "days_left": left,
            "status": "overdue" if left < 0 else "due_soon",
            "kind": task.get("kind"),
        })
    return due


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--doc-lead-days", type=int, default=DEFAULT_DOC_LEAD_DAYS,
                     help=f"report a document this many days before it expires (default {DEFAULT_DOC_LEAD_DAYS}, matching app/lib/dates.ts)")
    ap.add_argument("--task-lead-days", type=int, default=DEFAULT_TASK_LEAD_DAYS,
                     help=f"report a tender task this many days before its due date (default {DEFAULT_TASK_LEAD_DAYS})")
    ap.add_argument("--seen-store", default=DEFAULT_SEEN_STORE)
    ap.add_argument("--out", default=None, help="write the full combined report to this JSON file")
    args = ap.parse_args()

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
              "(see app/.env.local.example) before running this.")
        sys.exit(1)

    today = datetime.date.today()
    seen = load_seen(args.seen_store)

    documents_due = find_due_documents(url, key, seen, today, args.doc_lead_days)
    tasks_due = find_due_tasks(url, key, seen, today, args.task_lead_days)

    save_seen(args.seen_store, seen)

    print(f"{len(documents_due)} document(s) newly due for an expiry reminder "
          f"(within {args.doc_lead_days} days or already expired):")
    for d in documents_due:
        print(f"  {d['company_name']!r:<30} {d['label']:<32} expires {d['expiry_date']}  "
              f"({d['days_left']} days{' overdue' if d['days_left'] < 0 else ' left'})")

    print(f"\n{len(tasks_due)} tender task(s) newly due for a reminder "
          f"(within {args.task_lead_days} days or already overdue):")
    for t in tasks_due:
        print(f"  {t['tender_label']:<20} {t['description']:<50} due {t['due_date']}  "
              f"({t['days_left']} days{' overdue' if t['days_left'] < 0 else ' left'})")

    report = {"documents": documents_due, "tasks": tasks_due}
    if args.out:
        with open(args.out, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nWrote {args.out}")

    return report


if __name__ == "__main__":
    main()
