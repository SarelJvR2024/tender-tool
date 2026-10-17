"""
Role-based daily digest: one email's worth of content per person, per
company, built from the signals that already exist elsewhere in this repo -
never a new scoring/matching/expiry implementation of its own. See
docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md's "Roles and the
role-based daily digest" section for the five roles and the full
event-type x role content matrix this script implements; see
docs/supabase/migrations/0010_add_tender_workflow_role.sql for where the
role itself is stored (company_members.tender_role).

Same family, same notification boundary, as watch_new_tenders.py and
watch_deadlines.py: this script ASSEMBLES a report and writes it as JSON
(--out). It does not send an email, Slack message, or anything else -
Sarel's one real notification channel today is the scheduled check-in that
emails him from these scripts' own output (confirmed by grep: no smtplib,
sendgrid, resend, nodemailer or send_email anywhere in this repo as of
2026-10-16). This script's output is written to be read the same way:
either by a human, or by that same scheduled check-in, which can now also
read one well-known file per person instead of inventing email content from
three raw reports by hand.

What this script reuses rather than reimplements, concretely:
  - New-tender fit: engine/discovery/assess_tender.py's assess_release()
    (the exact same scoring assess_tender.py already does for
    watch_new_tenders.py), run fresh against the national OCDS feed.
    REPORT_WORTHY_VERDICTS is imported from watch_new_tenders.py, not
    re-declared, so "report-worthy" means the same thing in both places.
  - Document expiry + tender tasks: engine/compliance/watch_deadlines.py's
    find_due_documents()/find_due_person_credentials()/find_due_tasks() are
    called directly, unchanged. Per-person registrations (ECSA/SACPCMP,
    0035) ride in the document_expiry section as type "person_credential":
    full_cycle sees them, cv_admin sees only them, finance never sees them,
    viewer gets them in the count.
    This script does NOT re-read companies/tender_tasks itself - whatever
    watch_deadlines.py's own TRACKED_EXPIRY_FIELDS list covers (today: just
    COID Letter of Good Standing - see that script's own docstring and
    docs/specs/Document-Expiry-Tracked-Fields-Open-Item.md for why) is
    exactly what this digest covers too. If that list grows, this script
    picks up the change for free.
  - Readiness changes: field_provenance (migration 0002), read directly
    here because no existing script already reads it outside the Next.js
    app itself - this is new code, but a new READ against an existing
    table, not a new scoring concept. A true "status changing" signal (not
    just "is currently flagged") needs its own seen-store, same pattern as
    the other two scripts; see find_readiness_changes() below.
  - Submission due soon: the same national-feed fetch used for new-tender
    fit, filtered to closing_date inside the lead window - no separate
    fetch, no separate scoring.

Two run modes, because this environment has no live Supabase project
(confirmed: no app/.env.local, no NEXT_PUBLIC_SUPABASE_URL/
SUPABASE_SERVICE_ROLE_KEY in the environment - see docs/specs/System-Status.md):

  --mode live (default when Supabase env vars are set): reads company_members
    (role + tender_role), companies, tender_tasks and field_provenance over
    the Supabase REST API, exactly like watch_deadlines.py already does.
    Written but NOT verified end-to-end against a real project in this
    environment - flagged honestly, same as every other "live" path this
    repo's engine scripts have had to add without a live project to test
    against (see write_admin_harness_results.py's and seed_supabase_*.py's
    own history).

  --mode local (the only mode actually run and verified this pass): no
    Supabase needed. Takes a small local roster file (--roster, see
    config/team_roster.example.json for the shape - name/email/tender_role
    per person) standing in for company_members until a live project
    exists, reads document-expiry signals straight from a company profile
    JSON (--profile, same file assess_tender.py already reads) since that
    file actually HAS richer expiry data today (COID, SARS TCS PIN,
    professional indemnity) than the Supabase schema does yet, and skips
    readiness-changes and tender-tasks (both Supabase-only - no local
    fixture equivalent exists for either, same honest gap watch_deadlines.py
    already flags for document-expiry's missing columns). New-tender fit
    and submission-due-soon both work fully in local mode, since they only
    ever needed the public OCDS feed + a profile JSON, same as
    watch_new_tenders.py.

Usage:
    python3 daily_digest.py --mode local --profile ../../config/klipcorp_profile.json \\
        --roster ../../config/team_roster.json --out digest_report.json

    python3 daily_digest.py --mode live --out digest_report.json
        (requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
"""
import os
import sys
import json
import argparse
import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "discovery"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "compliance"))
import etenders_national
import assess_tender
import watch_new_tenders
import watch_deadlines

DEFAULT_SEEN_STORE = os.path.join(os.path.dirname(__file__), "..", "..", "state", "seen_digest_readiness.json")
DEFAULT_ROSTER_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "config", "team_roster.json")

VALID_ROLES = ("full_cycle", "validator", "cv_admin", "finance", "viewer")
DEFAULT_ROLE = "full_cycle"

# Which digest sections each role's email includes at all, per the Part 2
# content matrix in the spec. A role not listed for a section gets no key
# for that section in its digest at all - not an empty list - so the "-"
# cells in the matrix are visible in the output shape, not just in this
# source file's comments.
SECTION_VISIBILITY = {
    "full_cycle": {"new_tenders", "document_expiry", "tender_tasks", "readiness_changes", "submission_due"},
    "validator": {"readiness_changes", "submission_due", "tender_tasks"},
    # document_expiry added with 0035: the matrix gives cv_admin only expiries that
    # block a specific person's registration, which now exist (person_credential).
    "cv_admin": {"tender_tasks", "readiness_changes", "document_expiry"},
    "finance": {"document_expiry", "tender_tasks", "readiness_changes", "submission_due"},
    "viewer": {"new_tenders", "document_expiry", "submission_due"},
}

# Heuristic keyword classifiers for sections that have no real "who cares
# about this" tag in the schema yet (tender_tasks.kind is a closed enum of
# standard milestones, not "about a person" vs "about money"; field_provenance
# .field_key is a free-text dotted path with no category column). Flagged as
# approximations, not exact - see the spec section and each function's own
# docstring. Deliberately conservative: when a classifier can't tell, it
# favors NOT showing the item to the narrower role rather than guessing it in,
# consistent with this repo's "silent wrong data is the main risk" lesson
# (SANRAL section of the spec).
CV_KEYWORDS = ("cv", "key_person", "key person", "reference", "specialist", "ecsa", "sacpcmp", "people.", "person")
FINANCE_KEYWORDS = ("financial", "bee", "b-bbee", "bbee", "coid", "tax", "sars", "bank", "vat", "pricing", "price", "insurance", "csd")


def classify_text(text, keywords):
    t = (text or "").lower()
    return any(k in t for k in keywords)


def load_seen(path):
    try:
        return json.load(open(path))
    except (OSError, json.JSONDecodeError):
        return {}


def save_seen(path, seen):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(seen, f, indent=2)


# ---------------------------------------------------------------------------
# New-tender fit + submission-due-soon: one fetch of the national feed,
# scored with assess_tender.py exactly as watch_new_tenders.py does, reused
# for both signals so the OCDS feed is only ever fetched once per run.
# ---------------------------------------------------------------------------

def fetch_scored_releases(profile, days=14, fetch_documents=True):
    today = datetime.date.today()
    date_from = (today - datetime.timedelta(days=days)).isoformat()
    date_to = today.isoformat()
    raw = etenders_national.fetch_releases(date_from, date_to)
    normalized = [etenders_national.normalize(r) for r in raw]
    scored = []
    for r in normalized:
        try:
            result = assess_tender.assess_release(r, profile, fetch_document=fetch_documents)
        except Exception as e:
            result = {"contract_number": r.get("contract_number"), "verdict": "ERROR", "error": str(e)}
        scored.append({**result, "ocid": r.get("ocid"), "closing_date": r.get("closing_date"),
                       "documents": r.get("documents")})
    return scored


def new_tender_signals(scored):
    """Report-worthy verdicts, exactly watch_new_tenders.py's own set - not
    re-declared, imported, so 'report-worthy' can never silently drift
    between the two scripts."""
    return [r for r in scored if r.get("verdict") in watch_new_tenders.REPORT_WORTHY_VERDICTS]


def submission_due_signals(scored, lead_days=14):
    """Any report-worthy or already-seen-as-relevant release closing inside
    the lead window - deliberately includes needs_review too (wider than
    new_tender_signals' default), since 'something you might be bidding on
    closes soon' is a different, more inclusive question than 'should you
    look at this at all'."""
    today = datetime.date.today()
    out = []
    for r in scored:
        if r.get("verdict") not in watch_new_tenders.REPORT_WORTHY_VERDICTS_WIDE:
            continue
        closing = r.get("closing_date")
        if not closing:
            continue
        try:
            closing_date = datetime.date.fromisoformat(closing[:10])
        except ValueError:
            continue
        days_left = (closing_date - today).days
        if 0 <= days_left <= lead_days:
            out.append({**r, "days_left": days_left})
    return out


# ---------------------------------------------------------------------------
# Readiness changes (live mode only - field_provenance has no local fixture).
# New code (nothing else reads field_provenance outside the Next.js app),
# but a read against an existing table, same honesty-first spirit as the
# rest of this script: only reports when a field's status actually CHANGED
# since this script last saw it (own seen-store, same pattern as
# watch_new_tenders.py/watch_deadlines.py), not every assumed_default/missing
# row on every run.
# ---------------------------------------------------------------------------

def find_readiness_changes(url, key, seen, today):
    rows = watch_deadlines.supabase_request(
        url, key, "field_provenance?select=id,tender_pack_id,field_key,status,reason,updated_at"
    )
    pack_ids = sorted({r["tender_pack_id"] for r in rows if r.get("tender_pack_id")})
    packs_by_id = {}
    if pack_ids:
        in_list = ",".join(pack_ids)
        packs = watch_deadlines.supabase_request(
            url, key, f"tender_packs?select=id,company_id,tender_id&id=in.({in_list})"
        )
        packs_by_id = {p["id"]: p for p in packs}

    changes = []
    for r in rows:
        seen_key = f"prov::{r['id']}"
        prev_status = seen.get(seen_key)
        cur_status = r["status"]
        if prev_status == cur_status:
            continue
        seen[seen_key] = cur_status
        if prev_status is None and cur_status in ("confirmed", "computed"):
            # First time this script has ever seen this row, and it's already
            # fine - not a "change" worth waking anyone up for.
            continue
        pack = packs_by_id.get(r.get("tender_pack_id"), {})
        changes.append({
            "field_provenance_id": r["id"],
            "company_id": pack.get("company_id"),
            "tender_id": pack.get("tender_id"),
            "field_key": r["field_key"],
            "previous_status": prev_status,
            "status": cur_status,
            "reason": r.get("reason"),
        })
    return changes


# ---------------------------------------------------------------------------
# Roster loading: live mode reads company_members; local mode reads a flat
# JSON roster file, same shape, so build_digests() below never has to know
# which mode produced the list.
# ---------------------------------------------------------------------------

def load_roster_live(url, key, company_id=None):
    path = "company_members?select=user_id,company_id,tender_role,companies(legal_name)"
    if company_id:
        path += f"&company_id=eq.{company_id}"
    rows = watch_deadlines.supabase_request(url, key, path)
    roster = []
    for r in rows:
        roster.append({
            "person_id": r["user_id"],
            "name": r.get("user_id"),  # live mode has no display name column on company_members itself;
            # the real digest-sender (email wrapper) is expected to resolve this against
            # auth.users/a profile table once one exists - flagged, not solved, here.
            "email": None,
            "company_id": r["company_id"],
            "company_name": (r.get("companies") or {}).get("legal_name"),
            "tender_role": r.get("tender_role") or DEFAULT_ROLE,
        })
    return roster


def load_roster_local(path):
    try:
        data = json.load(open(path))
    except (OSError, json.JSONDecodeError) as e:
        raise SystemExit(
            f"Could not read roster file {path!r} ({e}). "
            f"See config/team_roster.example.json for the expected shape."
        )
    roster = []
    for member in data.get("members", []):
        role = member.get("tender_role") or DEFAULT_ROLE
        if role not in VALID_ROLES:
            raise SystemExit(f"Roster entry {member.get('name')!r} has an unknown tender_role {role!r} "
                              f"(must be one of {VALID_ROLES})")
        roster.append({
            "person_id": member.get("email") or member.get("name"),
            "name": member.get("name"),
            "email": member.get("email"),
            "company_id": None,
            "company_name": data.get("company_legal_name"),
            "tender_role": role,
        })
    return roster


# ---------------------------------------------------------------------------
# Assemble one digest per person, filtered per the Part 2 matrix.
# ---------------------------------------------------------------------------

def build_digest_for_person(person, signals):
    role = person["tender_role"]
    visible = SECTION_VISIBILITY.get(role, SECTION_VISIBILITY[DEFAULT_ROLE])
    digest = {
        "person": {"name": person.get("name"), "email": person.get("email"), "tender_role": role},
        "company_name": person.get("company_name"),
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }

    if "new_tenders" in visible:
        items = signals["new_tenders"]
        if role == "viewer":
            closest = min((r.get("closing_date") for r in items if r.get("closing_date")), default=None)
            digest["new_tenders"] = {"count": len(items), "closest_closing_date": closest}
        else:
            digest["new_tenders"] = items

    if "document_expiry" in visible:
        items = signals["document_expiry"]
        # The section holds company documents (type "document") and, since
        # 0035, per-person professional registrations (type
        # "person_credential", watch_deadlines.find_due_person_credentials).
        if role == "finance":
            # Matrix: financial/tax/compliance documents - every company
            # document, but not a person's ECSA/SACPCMP renewal (not theirs to act on).
            items = [i for i in items if i.get("type") != "person_credential"]
        elif role == "cv_admin":
            # Matrix: only if the expiring item would block a specific person's own
            # registration being usable on a pack - exactly the person_credential
            # items; company documents stay out.
            items = [i for i in items if i.get("type") == "person_credential"]
        if role == "viewer":
            digest["document_expiry"] = {"count": len(items)}
        else:
            digest["document_expiry"] = items

    if "tender_tasks" in visible:
        items = signals["tender_tasks"]
        if role == "cv_admin":
            items = [t for t in items if classify_text(t.get("description"), CV_KEYWORDS)]
        elif role == "finance":
            items = [t for t in items if classify_text(t.get("description"), FINANCE_KEYWORDS)]
        elif role == "validator":
            # Matrix: only tasks whose status affects pack-review readiness. No real
            # "blocks submission" tag exists on tender_tasks yet (confirmed against
            # migration 0009_tender_tasks.sql) - approximated here as every not-done
            # task inside the lead window, same set watch_deadlines.py already surfaces,
            # with the approximation flagged rather than silently narrowed further.
            pass
        digest["tender_tasks"] = items

    if "readiness_changes" in visible:
        items = signals["readiness_changes"]
        if role == "cv_admin":
            items = [c for c in items if classify_text(c.get("field_key"), CV_KEYWORDS)]
        elif role == "finance":
            items = [c for c in items if classify_text(c.get("field_key"), FINANCE_KEYWORDS)]
        digest["readiness_changes"] = items

    if "submission_due" in visible:
        items = signals["submission_due"]
        if role == "cv_admin":
            items = []  # not in SECTION_VISIBILITY["cv_admin"] either - kept unreachable intentionally
        elif role == "finance":
            # Matrix: only if a financial document/pricing envelope is still outstanding.
            # No per-tender "pricing envelope status" field exists yet, so this is left
            # as the full report-worthy-closing-soon list with the same caveat as the
            # validator task approximation above, rather than invented filtering logic.
            pass
        if role == "viewer":
            digest["submission_due"] = {"count": len(items),
                                         "nearest_closing_date": min((r.get("closing_date") for r in items), default=None)}
        else:
            digest["submission_due"] = items

    return digest


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--mode", choices=["live", "local"], default=None,
                     help="live reads Supabase directly (needs NEXT_PUBLIC_SUPABASE_URL + "
                          "SUPABASE_SERVICE_ROLE_KEY); local uses --roster + --profile. "
                          "Default: live if both env vars are set, else local.")
    ap.add_argument("--profile", default=None,
                     help="local mode: the company profile JSON to use (required in local mode - no default company)")
    ap.add_argument("--roster", default=DEFAULT_ROSTER_PATH,
                     help="local mode: roster JSON (see config/team_roster.example.json)")
    ap.add_argument("--days", type=int, default=14, help="how many days back to search the national feed")
    ap.add_argument("--no-fetch-documents", action="store_true",
                     help="metadata-only scoring (no per-release document download) - much faster, "
                          "useful for a quick local run; watch_new_tenders.py's own default fetches "
                          "documents, so a real scheduled run should leave this off")
    ap.add_argument("--doc-lead-days", type=int, default=watch_deadlines.DEFAULT_DOC_LEAD_DAYS)
    ap.add_argument("--task-lead-days", type=int, default=watch_deadlines.DEFAULT_TASK_LEAD_DAYS)
    ap.add_argument("--submission-lead-days", type=int, default=14)
    ap.add_argument("--seen-store", default=DEFAULT_SEEN_STORE)
    ap.add_argument("--out", default=None, help="write the full list of per-person digests to this JSON file")
    args = ap.parse_args()

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    mode = args.mode or ("live" if url and key else "local")

    today = datetime.date.today()
    seen = load_seen(args.seen_store)

    if mode == "local":
        if not args.profile:
            print("ERROR: --mode local needs --profile <the company's profile JSON> (there is no default company).")
            sys.exit(1)
        profile = assess_tender.load_company_profile(args.profile)
        roster = load_roster_local(args.roster)
        print(f"Fetching OCDS releases ({args.days} days)...")
        scored = fetch_scored_releases(profile, days=args.days, fetch_documents=not args.no_fetch_documents)
        document_expiry = (local_document_expiry(profile, today, args.doc_lead_days)
                           + local_person_credential_expiry(profile, today, args.doc_lead_days))
        tender_tasks = []  # Supabase-only, no local fixture (see module docstring)
        readiness_changes = []  # Supabase-only
    else:
        if not url or not key:
            print("ERROR: --mode live needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
            sys.exit(1)
        roster = load_roster_live(url, key)
        profile = None
        scored = []
        print("WARNING: live mode's national-feed fetch needs a company profile per company "
              "(assess_tender.load_company_profile doesn't yet read one from Supabase) - "
              "new_tenders/submission_due will be empty in live mode until that's wired up. "
              "See docs/specs/System-Status.md.")
        document_expiry = (watch_deadlines.find_due_documents(url, key, seen, today, args.doc_lead_days)
                           + watch_deadlines.find_due_person_credentials(url, key, seen, today, args.doc_lead_days))
        tender_tasks = watch_deadlines.find_due_tasks(url, key, seen, today, args.task_lead_days)
        readiness_changes = find_readiness_changes(url, key, seen, today)

    save_seen(args.seen_store, seen)

    signals = {
        "new_tenders": new_tender_signals(scored),
        "document_expiry": document_expiry,
        "tender_tasks": tender_tasks,
        "readiness_changes": readiness_changes,
        "submission_due": submission_due_signals(scored, lead_days=args.submission_lead_days),
    }

    print(f"\nSignals this run: {len(signals['new_tenders'])} new matching tender(s), "
          f"{len(signals['document_expiry'])} document(s) due for expiry reminder, "
          f"{len(signals['tender_tasks'])} tender task(s) due, "
          f"{len(signals['readiness_changes'])} readiness change(s), "
          f"{len(signals['submission_due'])} tender(s) closing soon.")

    digests = [build_digest_for_person(p, signals) for p in roster]

    print(f"\n{len(digests)} per-person digest(s) built ({mode} mode):")
    for d in digests:
        shown = sorted(k for k in d if k not in ("person", "company_name", "generated_at"))
        print(f"  {d['person']['name']!r:<24} role={d['person']['tender_role']:<11} sections={shown}")

    if args.out:
        with open(args.out, "w") as f:
            json.dump(digests, f, indent=2)
        print(f"\nWrote {args.out}")

    return digests


def local_document_expiry(profile, today, lead_days):
    """Local-mode equivalent of watch_deadlines.find_due_documents(), reading
    the company profile JSON directly instead of Supabase. Deliberately
    covers MORE fields than watch_deadlines.py's own TRACKED_EXPIRY_FIELDS
    (which is limited to the one column that actually exists in the Supabase
    schema today - coid_letter_of_good_standing_expiry) because the real
    profile JSON already carries richer expiry data that the schema hasn't
    caught up to yet (see docs/specs/Document-Expiry-Tracked-Fields-Open-Item.md,
    written by the agent building watch_deadlines.py) - confirmed by reading
    config/klipcorp_profile.json directly, not assumed. This function is the
    local/dev stand-in; the live/production source of truth is and should
    stay watch_deadlines.py's own TRACKED_EXPIRY_FIELDS list once those
    columns exist in Supabase - this is not a second schema to keep in sync
    by hand forever, it's scaffolding until that migration lands.
    """
    company = profile.get("company", {})
    fields = [
        ("coid_letter_of_good_standing_expiry", "COID Letter of Good Standing"),
        ("sars_tcs_pin_expiry", "SARS Tax Compliance Status PIN"),
    ]
    due = []
    for col, label in fields:
        expiry = company.get(col)
        if not expiry:
            continue
        left = (datetime.date.fromisoformat(expiry[:10]) - today).days
        if left > lead_days:
            continue
        due.append({
            "type": "document", "field": col, "label": label,
            "expiry_date": expiry, "days_left": left,
            "status": "expired" if left < 0 else "renew_soon",
        })
    pi = company.get("professional_indemnity_insurance") or {}
    pi_expiry = pi.get("period_to")
    if pi_expiry:
        left = (datetime.date.fromisoformat(pi_expiry[:10]) - today).days
        if left <= lead_days:
            due.append({
                "type": "document", "field": "professional_indemnity_insurance.period_to",
                "label": "Professional indemnity insurance", "expiry_date": pi_expiry,
                "days_left": left, "status": "expired" if left < 0 else "renew_soon",
            })
    return due


def local_person_credential_expiry(profile, today, lead_days):
    """Local-mode stand-in for watch_deadlines.find_due_person_credentials():
    reads key_people[*].qualifications.<column> from the profile JSON for the
    same TRACKED_PERSON_EXPIRY_FIELDS columns (imported, not re-declared).
    No seen-store, same as local_document_expiry()."""
    due = []
    for person in profile.get("key_people", []):
        q = person.get("qualifications") or {}
        for col, label, lead_override, num_col in watch_deadlines.TRACKED_PERSON_EXPIRY_FIELDS:
            expiry = q.get(col)
            if not expiry:
                continue
            left = watch_deadlines.days_until(expiry, today)
            if left > (lead_override if lead_override is not None else lead_days):
                continue
            due.append({
                "type": "person_credential", "person_name": person.get("name"), "field": col,
                "label": label, "registration_number": q.get(num_col), "expiry_date": expiry,
                "days_left": left, "status": "expired" if left < 0 else "renew_soon",
            })
    return due


if __name__ == "__main__":
    main()
