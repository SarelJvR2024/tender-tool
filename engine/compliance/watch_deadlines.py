"""
Deadline watch: document-expiry reminders + tender task/deadline reminders.

Same family and same deliberate boundary as
engine/discovery/watch_new_tenders.py: find what's newly due for a reminder,
diff against a "seen" store in the database so a run only ever reports something once
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

Two independent things get watched, in one run, sharing one seen store
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

   TRACKED_EXPIRY_FIELDS below lists only columns that really exist on
   `companies`: COID (0001_init_schema.sql) plus the five added by
   0014_vault_compliance_documents.sql after Sarel confirmed them
   ("10. Yes.", 2026-10-16) - SARS TCS PIN, professional indemnity
   insurance, ISO 9001 certificate, bank confirmation letter and B-BBEE
   proof (certificate or QSE/EME sworn affidavit). That closes the
   COID-only limitation recorded in
   docs/specs/Document-Expiry-Tracked-Fields-Open-Item.md. CSD registration
   still has no expiry column (not part of Sarel's answer), so it is still
   not tracked.

   The bank letter has an issue date, not an expiry; the tracked column is
   the generated bank_confirmation_letter_valid_until (letter date + 3
   months), with its own 30-day lead time - a 60-day window on a 3-month
   letter would fire a month after it was issued. Matches
   app/lib/vaultDocuments.ts BANK_LETTER_RENEW_SOON_DAYS, so the vault badge
   and the reminder agree.

1b. Per-person professional registrations (People page, app/app/people/;
   Deep-Dive item 21). TRACKED_PERSON_EXPIRY_FIELDS lists the per-person
   expiry columns that really exist on `people`: ECSA and SACPCMP
   (0035_person_registration_expiry.sql - before it, people only had the
   date each registration was GRANTED, ecsa_date/sacpcmp_date, which is not
   an expiry), and SACNASP and SAGC (0040 - optional, recorded only where a
   tender asks for them). Same lead-time window, same seen-store, same status
   escalation as the company documents: all go through _expiry_window(),
   one mechanism, not a second one. Other professional bodies (SACAP,
   SACPLAN, ...) have no registration column on people yet; since 0050 they
   are held through the shared registrations catalog instead (1c).

1c. Registrations / licences / accreditations from the shared catalog
   (0050 registration_types + held_registrations: PSIRA, SETA accreditation,
   waste permits, SACAP, HPCSA ...) held by the company, a person or a
   director/shareholder, and per-building property documents with a
   valid-until date (0050 property_documents). One row = one tracked expiry,
   whatever the body - registration_reminders.py, through the same
   _expiry_window() and seen store.

2. Tender task due dates (tender_tasks, migration 0009_tender_tasks.sql -
   app/app/tenders/[id]/page.tsx's task/deadline timeline). Reports any
   not-yet-done task whose due_date is inside --task-lead-days (default 14 -
   deliberately shorter than the 60-day document lead time: a task like
   "confirm the subcontractor" needs a much tighter warning than a
   compliance certificate does) or already overdue.

Usage:
    python3 watch_deadlines.py [--doc-lead-days 60] [--task-lead-days 14]
        [--out report.json]

Requires the same environment variables as engine/seed_supabase_company.py:
    NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
(service-role key, not anon - this reads across every tenant, which the
anon key's RLS would never allow; same justification as every other
engine/*.py script that talks to Supabase directly.)

The "seen" store is the deadline_reminders_seen table (migration 0041, one
row per company x consumer x item key; this script is consumer
'watch_deadlines', the daily digest keeps its own 'daily_digest' rows).
Until 2026-10-17 it was state/seen_deadlines.json - a file on whichever
machine ran the watch, which a redeploy or a second host forgets (Sarel:
"why would anything be saved in local instead of database"). Same pattern
as Discovery's discovery_seen_releases (0038). It tracks every (item,
due-or-expiry-date, status) already reported, so a document or task stays
in the window without re-triggering a report every run. A database read or
write error fails the run loudly (and is recorded in system_alerts) - it
never falls back to "nothing seen" and re-reports everything. If the underlying date changes - a document gets renewed to a new
expiry, a task's due date gets pushed - that is a new key, so it reports
again, exactly like a genuinely new deadline. A task that leaves the
"not done" set (marked done) simply stops being fetched, so it needs no
explicit removal from the seen store.

Escalation and closing dates (2026-10-17 scenario pass): the key also
carries the item's status, so a document is reported once while "renew
soon" and once more when it lapses, and a task once while due and once more
when overdue - before, the lapse itself was never reported. A third check,
find_documents_lapsing_before_closing(), reports a document that is outside
the expiry window today but will have lapsed by the closing date of a tender
the company is preparing (engine/compliance/test_watch_deadlines_urgency.py).
"""
import os
import sys
import json
import argparse
import datetime
import urllib.request
import urllib.error

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "discovery"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "alerts"))
import company_profiles  # noqa: E402  (RestClient: the paged service-role select/upsert)
import system_alerts  # noqa: E402
import registration_reminders  # noqa: E402  (0050: catalog registrations + property documents)

SEEN_TABLE = "deadline_reminders_seen"  # 0041
CONSUMER = "watch_deadlines"

# See module docstring part 1 - only columns that really exist on `companies`
# (0001 + 0014) go here. (field_column, human_label, lead_days_override);
# None = use --doc-lead-days.
TRACKED_EXPIRY_FIELDS = [
    ("coid_letter_of_good_standing_expiry", "COID Letter of Good Standing", None),
    ("sars_tcs_pin_expiry", "SARS Tax Compliance Status PIN", None),
    ("pi_insurance_expiry", "Professional indemnity insurance", None),
    ("iso_9001_expiry", "ISO 9001 certificate", None),
    ("bank_confirmation_letter_valid_until", "Bank confirmation letter (3-month validity)", 30),
    ("bee_proof_expiry", "B-BBEE proof (certificate or sworn affidavit)", None),
]

# Per-person registrations (0035). Same (column, label, lead_days_override)
# shape as TRACKED_EXPIRY_FIELDS; the number column is carried into the
# report so the reminder says which registration it is.
TRACKED_PERSON_EXPIRY_FIELDS = [
    ("ecsa_expiry", "ECSA professional registration", None, "ecsa_number"),
    ("sacpcmp_expiry", "SACPCMP professional registration", None, "sacpcmp_number"),
    # 0040 (audit Q5): optional registrations, recorded only for the people a
    # tender needs them for - a person with none recorded has a null expiry
    # and is skipped by _expiry_window(), exactly like ECSA/SACPCMP.
    ("sacnasp_expiry", "SACNASP (Pr Sci.Nat) professional registration", None, "sacnasp_number"),
    ("sagc_expiry", "SAGC (Geomatics) professional registration", None, "sagc_number"),
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


def load_seen_db(client, consumer=CONSUMER):
    """The reminder seen store (0041) for one consumer, in the find_*
    functions' dict shape: {seen_key: {first_seen, kind, company_id}}.
    Returns (seen, loaded) - `loaded` is the set of keys already stored, so
    save_seen_db() writes only the new ones."""
    seen = {}
    for row in client.select(SEEN_TABLE, {"consumer": consumer}, order="company_id.asc,seen_key.asc"):
        seen[row["seen_key"]] = {"first_seen": row.get("first_seen"), "kind": row.get("kind"),
                                 "company_id": row["company_id"]}
    return seen, set(seen)


def save_seen_db(client, seen, loaded, consumer=CONSUMER):
    """Writes every key the find_* functions recorded this run. Every entry
    carries its company_id (the row is per tenant); one without is skipped
    with a message rather than guessed. Returns rows written."""
    rows = []
    for k, e in seen.items():
        if k in loaded or not isinstance(e, dict):
            continue
        if not e.get("company_id"):
            print(f"  (seen key {k!r} has no company - not stored)")
            continue
        rows.append({"company_id": e["company_id"], "consumer": consumer, "seen_key": k,
                     "kind": e.get("kind") or "unknown", "first_seen": e.get("first_seen")})
    for i in range(0, len(rows), 200):
        client.upsert(SEEN_TABLE, rows[i:i + 200], "company_id,consumer,seen_key")
    loaded.update(r["seen_key"] for r in rows)
    return len(rows)


def days_until(date_str, today):
    """Mirrors app/lib/dates.ts's daysUntil: midnight-truncated, ceil'd.

    None also means "can't tell, treat as no reminder due" for a malformed
    date, not just a missing one - confirmed this matters for real: this
    function is called, with no per-item error handling, from a loop over
    EVERY company's documents, EVERY person's registrations and EVERY
    held_registration/property_document across the WHOLE multi-tenant system
    (find_due_documents/find_due_person_credentials/registration_reminders).
    main()'s own try/except is one level up, around all of those calls
    together - so one malformed date anywhere, for any one company, used to
    abort the ENTIRE daily reminder run for EVERY company, not just the one
    with bad data. Recorded as a system alert (not raised) so the bad record
    is still visible and gets fixed, but doesn't block everyone else's
    reminders until it is."""
    if not date_str:
        return None
    try:
        d = datetime.date.fromisoformat(date_str[:10])
    except ValueError:
        system_alerts.record("deadlines", f"A tracked expiry date ('{date_str}') is not a valid "
                             "date - skipped, not treated as due, until it's corrected.",
                             "warning", context={"date_str": date_str})
        return None
    return (d - today).days


def _expiry_window(seen, key_prefix, kind, expiry, today, lead_days, company_id=None):
    """The one reminder rule shared by company documents and per-person
    registrations: None if there is no date or it is outside the lead-time
    window, or this (item, expiry, status) was already reported; otherwise
    records it in the seen-store and returns (days_left, status).

    The status is part of the key (2026-10-17): an item is reported once
    while "renew soon" and once more when it actually lapses. Before, a
    document reported at 60 days was never reported again - the moment it
    expired was silent. A changed expiry date (renewed) is a new key."""
    left = days_until(expiry, today)
    if left is None or left > lead_days:
        return None  # not expired and outside the reminder window
    status = "expired" if left < 0 else "renew_soon"
    seen_key = f"{key_prefix}::{expiry}::{status}"
    if seen_key in seen:
        return None
    seen[seen_key] = {"first_seen": today.isoformat(), "kind": kind, "company_id": company_id}
    return left, status


def find_due_documents(url, key, seen, today, lead_days):
    select_cols = "id,legal_name," + ",".join(col for col, _, _ in TRACKED_EXPIRY_FIELDS)
    companies = supabase_request(url, key, f"companies?select={select_cols}")

    due = []
    for company in companies:
        for col, label, lead_override in TRACKED_EXPIRY_FIELDS:
            expiry = company.get(col)
            if not expiry:
                continue
            hit = _expiry_window(seen, f"doc::{company['id']}::{col}", "document",
                                 expiry, today, lead_override if lead_override is not None else lead_days,
                                 company_id=company["id"])
            if not hit:
                continue
            left, status = hit

            due.append({
                "type": "document",
                "company_id": company["id"],
                "company_name": company.get("legal_name"),
                "field": col,
                "label": label,
                "expiry_date": expiry,
                "days_left": left,
                "status": status,
            })
    return due


def find_due_person_credentials(url, key, seen, today, lead_days):
    """Per-person registrations (TRACKED_PERSON_EXPIRY_FIELDS, 0035) inside
    the reminder window or already lapsed, across every person in every
    company - same window/seen-store rule as find_due_documents()."""
    select_cols = "id,company_id,name," + ",".join(
        f"{col},{num}" for col, _, _, num in TRACKED_PERSON_EXPIRY_FIELDS)
    people = supabase_request(url, key, f"people?select={select_cols}&order=name.asc")
    company_ids = sorted({p["company_id"] for p in people if p.get("company_id")})
    names = {}
    if company_ids:
        rows = supabase_request(url, key, f"companies?select=id,legal_name&id=in.({','.join(company_ids)})")
        names = {c["id"]: c.get("legal_name") for c in rows}

    due = []
    for person in people:
        for col, label, lead_override, num_col in TRACKED_PERSON_EXPIRY_FIELDS:
            expiry = person.get(col)
            hit = _expiry_window(seen, f"person::{person['id']}::{col}", "person_credential",
                                 expiry, today, lead_override if lead_override is not None else lead_days,
                                 company_id=person.get("company_id"))
            if not hit:
                continue
            left, status = hit
            due.append({
                "type": "person_credential",
                "company_id": person["company_id"],
                "company_name": names.get(person["company_id"]),
                "person_id": person["id"],
                "person_name": person.get("name"),
                "field": col,
                "label": label,
                "registration_number": person.get(num_col),
                "expiry_date": expiry,
                "days_left": left,
                "status": status,
            })
    return due


def find_documents_lapsing_before_closing(url, key, seen, today, lead_days=DEFAULT_DOC_LEAD_DAYS):
    """A document that is fine today - outside the normal doc-lead-days
    window - but will have lapsed by the closing date of a tender the
    company is preparing (has a tender_pack for, still open). The plain
    expiry window can't see this: a PIN expiring in 90 days is "current"
    until day 60, yet it is already useless for a tender closing on day 100.
    Same comparison as the compliance report (app/lib/tenderCompliance.ts
    validityAtClosing: valid ON the closing day counts). One report per
    (company, document, expiry, tender).

    `lead_days` must be the SAME value find_due_documents() is run with
    (main() passes args.doc_lead_days to both) - otherwise this duplicates
    find_due_documents()'s own report under a second, misleading framing.
    Confirmed live (2026-10-20): a document already inside the normal
    60-day window (e.g. expiring in 30 days) was ALSO reported here against
    any open tender closing after it, as "lapses before TENDER X closes" -
    even though the real, and only, reason is the ordinary upcoming renewal
    find_due_documents() already reported. Two reminders for one fact,
    the second one naming a tender that has nothing special to do with it."""
    select_cols = "id,legal_name," + ",".join(col for col, _, _ in TRACKED_EXPIRY_FIELDS)
    companies = {c["id"]: c for c in supabase_request(url, key, f"companies?select={select_cols}")}
    packs = supabase_request(url, key, "tender_packs?select=company_id,tender_id")
    tender_ids = sorted({p["tender_id"] for p in packs})
    tenders = {}
    if tender_ids:
        rows = supabase_request(url, key, f"tenders?select=id,contract_no,title,closing_date,status&id=in.({','.join(tender_ids)})")
        tenders = {t["id"]: t for t in rows}
    due = []
    for p in packs:
        company, tender = companies.get(p["company_id"]), tenders.get(p["tender_id"])
        if not company or not tender or tender.get("status") != "open" or not tender.get("closing_date"):
            continue
        # calendar day in SAST (UTC+2), like app/lib/dates.ts closingDayOf()
        # Both parses below run inside ONE loop over every (company, tender)
        # pack in the system - unguarded, one bad value aborted this whole
        # check for every company (same bug class as days_until(), QA
        # Finding 8). A bad value now skips just that pack/document, with an
        # alert so it still gets fixed.
        try:
            closing_ts = datetime.datetime.fromisoformat(str(tender["closing_date"]).replace("Z", "+00:00"))
        except ValueError:
            system_alerts.record("deadlines", f"Tender {tender['id']}'s closing date ('{tender['closing_date']}') "
                                 "is not a valid date - its lapsing-before-closing check was skipped.",
                                 "warning", context={"tender_id": tender["id"], "closing_date": tender["closing_date"]})
            continue
        closing_day = (closing_ts + datetime.timedelta(hours=2)).date() if closing_ts.tzinfo else closing_ts.date()
        to_closing = (closing_day - today).days
        if to_closing < 0:
            continue
        for col, label, lead_override in TRACKED_EXPIRY_FIELDS:
            expiry = company.get(col)
            if not expiry:
                continue
            left = days_until(expiry, today)  # None (alert recorded) for a malformed date
            if left is None:
                continue
            exp_day = today + datetime.timedelta(days=left)
            if exp_day >= closing_day or exp_day < today:
                continue  # covers the closing date / already expired (reported by find_due_documents)
            if left <= (lead_override if lead_override is not None else lead_days):
                continue  # already inside the normal window - find_due_documents reports this one
            seen_key = f"doc_before_closing::{company['id']}::{col}::{expiry}::{tender['id']}"
            if seen_key in seen:
                continue
            seen[seen_key] = {"first_seen": today.isoformat(), "kind": "document_before_closing",
                              "company_id": company["id"]}
            due.append({
                "type": "document_before_closing",
                "company_id": company["id"],
                "company_name": company.get("legal_name"),
                "field": col,
                "label": label,
                "expiry_date": expiry,
                "days_left": (exp_day - today).days,
                "tender_id": tender["id"],
                "tender_label": tender.get("contract_no") or tender.get("title") or tender["id"],
                "closing_date": closing_day.isoformat(),
                "days_to_closing": to_closing,
                "status": "lapses_before_closing",
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

        status = "overdue" if left < 0 else "due_soon"
        seen_key = f"task::{task['id']}::{task['due_date']}::{status}"  # overdue escalates, see find_due_documents
        if seen_key in seen:
            continue
        seen[seen_key] = {"first_seen": today.isoformat(), "kind": "task", "company_id": task.get("company_id")}

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
            "status": status,
            "kind": task.get("kind"),
        })
    return due


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--doc-lead-days", type=int, default=DEFAULT_DOC_LEAD_DAYS,
                     help=f"report a document this many days before it expires (default {DEFAULT_DOC_LEAD_DAYS}, matching app/lib/dates.ts)")
    ap.add_argument("--task-lead-days", type=int, default=DEFAULT_TASK_LEAD_DAYS,
                     help=f"report a tender task this many days before its due date (default {DEFAULT_TASK_LEAD_DAYS})")
    ap.add_argument("--out", default=None, help="write the full combined report to this JSON file")
    args = ap.parse_args()

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY "
              "(see app/.env.local.example) before running this.")
        sys.exit(1)

    today = datetime.date.today()
    client = company_profiles.RestClient(url, key)
    try:
        seen, loaded = load_seen_db(client)
        documents_due = find_due_documents(url, key, seen, today, args.doc_lead_days)
        credentials_due = find_due_person_credentials(url, key, seen, today, args.doc_lead_days)
        registrations_due = (registration_reminders.find_due_registrations(url, key, seen, today, args.doc_lead_days)
                             + registration_reminders.find_due_property_documents(url, key, seen, today, args.doc_lead_days))
        tasks_due = find_due_tasks(url, key, seen, today, args.task_lead_days)
        before_closing = find_documents_lapsing_before_closing(url, key, seen, today, args.doc_lead_days)
        written = save_seen_db(client, seen, loaded)
    except Exception as e:
        system_alerts.record("deadlines", f"The deadline-reminder watch failed: {type(e).__name__}: {e}",
                             "critical", exc=e)
        print(f"ERROR: deadline watch failed: {type(e).__name__}: {e}")
        sys.exit(1)
    print(f"Seen store: {SEEN_TABLE} (database) - {len(loaded) - written} reported before, {written} new\n")

    print(f"{len(documents_due)} document(s) newly due for an expiry reminder "
          f"(within {args.doc_lead_days} days or already expired):")
    for d in documents_due:
        print(f"  {d['company_name']!r:<30} {d['label']:<32} expires {d['expiry_date']}  "
              f"({d['days_left']} days{' overdue' if d['days_left'] < 0 else ' left'})")

    print(f"\n{len(credentials_due)} person registration(s) newly due for a renewal reminder "
          f"(within {args.doc_lead_days} days or already lapsed):")
    for c in credentials_due:
        print(f"  {c['company_name']!r:<30} {c['person_name']!r:<24} {c['label']:<34} expires {c['expiry_date']}  "
              f"({c['days_left']} days{' overdue' if c['days_left'] < 0 else ' left'})")

    print(f"\n{len(registrations_due)} catalog registration(s) / property document(s) newly due "
          f"(within {args.doc_lead_days} days or already lapsed):")
    for r in registrations_due:
        holder = r.get("person_name") or "(company)"
        print(f"  {r['company_name']!r:<30} {holder!r:<24} {r['label']:<40} expires {r['expiry_date']}  "
              f"({r['days_left']} days{' overdue' if r['days_left'] < 0 else ' left'})")

    print(f"\n{len(before_closing)} document(s) that will have lapsed by the closing date of a tender being prepared:")
    for d in before_closing:
        print(f"  {d['company_name']!r:<30} {d['label']:<32} expires {d['expiry_date']} - {d['tender_label']} closes {d['closing_date']}")

    print(f"\n{len(tasks_due)} tender task(s) newly due for a reminder "
          f"(within {args.task_lead_days} days or already overdue):")
    for t in tasks_due:
        print(f"  {t['tender_label']:<20} {t['description']:<50} due {t['due_date']}  "
              f"({t['days_left']} days{' overdue' if t['days_left'] < 0 else ' left'})")

    report = {"documents": documents_due, "person_credentials": credentials_due, "registrations": registrations_due, "documents_before_closing": before_closing, "tasks": tasks_due}
    if args.out:
        with open(args.out, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nWrote {args.out}")

    return report


if __name__ == "__main__":
    main()
