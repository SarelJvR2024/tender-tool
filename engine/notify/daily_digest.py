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
three raw reports by hand. The ACTUAL sending of this JSON as an email to a
real customer is engine/notify/send_digest_emails.py's job, not this
script's - see that module's own docstring for the provider (Resend) and
the env var it needs.

Opt-in (2026-10-20, Sarel directly asked: "yes let's make this an optional
email that the customer can decide if they want to receive it."):
company_members.daily_digest_opt_in (migration 0073) defaults to false, and
filter_opted_in() below drops every roster entry that hasn't explicitly
opted in BEFORE any digest is built for them - not just before sending.
This is a pure function (no network), unit-tested on its own in
test_digest_opt_in.py; the live/local roster loaders below just populate
the "email_opt_in" field it reads.

Every "today" in this file is watch_deadlines.SAST-anchored (enterprise-
readiness audit round 1, 2026-10-20), not a naive datetime.date.today() -
the worker container has no TZ set and runs in UTC by default, so a naive
call is one calendar day behind the real SAST date for the whole 00:00-
01:59 SAST window every day. See watch_deadlines.py's own SAST constant
comment for the full reasoning.

What this script reuses rather than reimplements, concretely:
  - New-tender fit: the Discovery feed's own per-company scoring -
    watch_new_tenders.fan_out() (each tender's documents read once,
    assess_tender.read_release(), then scored for each company with
    assess_tender.score_release() against that company's OWN profile), run
    fresh against the national OCDS feed. In live mode the profiles come
    from engine/discovery/company_profiles.py's all_company_profiles() -
    each company's own Experience Library disciplines, CIDB grading, B-BBEE
    and offices, exactly what the Discovery feed itself uses - and each
    person's digest gets only their own company's verdicts. In local mode
    the one --profile file is the one company. REPORT_WORTHY_VERDICTS is
    imported from watch_new_tenders.py, not re-declared, so "report-worthy"
    means the same thing in both places.
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
  - Seen stores (live mode), in the database since 2026-10-17 (migration
    0041; before, both lived in state/seen_digest_readiness.json on whichever
    host ran the digest): deadline items in deadline_reminders_seen under
    consumer 'daily_digest' (its own rows - the watch_deadlines.py report
    keeps separate ones, so one reporting an item never hides it from the
    other), readiness statuses in digest_readiness_seen. Local mode has no
    seen store at all (it never needed one: its expiry items are recomputed
    from the profile file every run).
  - Submission due soon: the same national-feed fetch used for new-tender
    fit, filtered to closing_date inside the lead window - no separate
    fetch, no separate scoring.

Two run modes, because this environment has no live Supabase project
(confirmed: no app/.env.local, no NEXT_PUBLIC_SUPABASE_URL/
SUPABASE_SERVICE_ROLE_KEY in the environment - see docs/specs/System-Status.md):

  --mode live (default when Supabase env vars are set): reads company_members
    (role + tender_role), companies, tender_tasks and field_provenance over
    the Supabase REST API, exactly like watch_deadlines.py already does, and
    every company's own profile (company_profiles.all_company_profiles; test
    companies included like the Discovery feed, --exclude-test-companies
    leaves them out). Every section is per company: a person sees only their
    own company's tender verdicts, document expiries, tasks and readiness
    changes. Verified by engine/notify/test_digest_live.py (in-memory rows,
    real sample tender PDFs) and a CLI run over a local PostgREST stand-in
    on a replayed scratch Postgres (Hardcoded-Assumptions-Audit §9.3), not
    against a real Supabase project - none exists (System-Status gap 9).

  --mode local (verified with a real run when it was first built): no
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
import gov_sources
import tender_changes
import assess_tender
import company_profiles
import watch_new_tenders
import watch_deadlines
import watch_tender_updates
import discovery_downgrades
import system_alerts  # noqa: E402  (engine/alerts, on the path via watch_deadlines)

LOCAL_COMPANY_KEY = "local"  # --mode local: the one --profile company

DIGEST_CONSUMER = "daily_digest"  # deadline_reminders_seen.consumer (0041)
READINESS_TABLE = "digest_readiness_seen"  # 0041
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
# Tender updates (0039, engine/discovery/watch_tender_updates.py): an addendum,
# a moved closing/briefing date or a cancellation on a tender the company is
# actively pursuing. Not in the spec's matrix (it predates the watch); every
# role gets it - a moved closing date matters to whoever is working on the bid,
# whatever their part - and the viewer gets the count, like its other sections.
for _sections in SECTION_VISIBILITY.values():
    _sections.add("tender_updates")
# Listing changes (0051, engine/discovery/tender_changes.py): cancellations,
# moved closing/briefing dates, addenda listed, re-advertisements on tenders
# in the company's Discovery feed - pursued or not (tender_updates above is
# only for tenders being pursued, with the documents read). Every role, the
# viewer as a count, same reasoning as tender_updates.
for _sections in SECTION_VISIBILITY.values():
    _sections.add("listing_changes")
# Re-assessed tenders (0055, engine/discovery/discovery_downgrades.py): a
# Discovery verdict a re-score made WORSE (Sarel, 2026-10-17: "When evaluation
# downgrades opportunity it must be flagged"). Every role may get the section,
# but which items depends on the item: a downgrade on a tender the company is
# actively pursuing (tender_packs at found/bidding/submitted) goes to everyone,
# like a tender update - real work may already have gone into it; a plain
# Discovery-feed downgrade (no pack) only to the roles that get new tenders
# (full_cycle, viewer as a count), the same audience the match was reported to.
# A role left with nothing gets no key (see build_digest_for_person).
for _sections in SECTION_VISIBILITY.values():
    _sections.add("reassessed_tenders")

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


def load_readiness_seen_db(client):
    """digest_readiness_seen (0041) in find_readiness_changes()'s shape:
    {"prov::<field_provenance id>": status}. Returns (seen, loaded) -
    `loaded` the same mapping as stored, so only changes are written."""
    seen = {f"prov::{r['field_provenance_id']}": r["status"]
            for r in client.select(READINESS_TABLE, order="company_id.asc,field_provenance_id.asc")}
    return seen, dict(seen)


def save_readiness_seen_db(client, seen, loaded, owners):
    """Upserts every prov:: status that is new or changed. `owners` maps a
    prov:: key to its company (find_readiness_changes fills it from the
    row's tender pack) - None when the field_provenance row's own
    tender_pack_id didn't resolve to a pack (tender_pack_id is NOT NULL and
    cascades, so this only happens if the pack was deleted in the narrow
    window between find_readiness_changes()'s two Supabase reads). Returns
    rows written.

    QA pass, 2026-10-29: that case used to vanish with zero trace - skipped
    here with no print/alert at all, unlike watch_deadlines.save_seen_db()'s
    own "(seen key {k!r} has no company - not stored)" message for the
    identical shape of problem (a seen entry nobody can attribute to a
    company). Matched here so an operator reading the run's output can
    actually see why one fewer row was written than changes were found,
    instead of the write just silently being one short."""
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    rows = []
    for k, v in seen.items():
        if not k.startswith("prov::") or loaded.get(k) == v:
            continue
        if not owners.get(k):
            print(f"  (seen key {k!r} has no company - not stored)")
            continue
        rows.append({"company_id": owners[k], "field_provenance_id": k.split("::", 1)[1], "status": v, "updated_at": now})
    for i in range(0, len(rows), 200):
        client.upsert(READINESS_TABLE, rows[i:i + 200], "company_id,field_provenance_id")
    loaded.update({f"prov::{r['field_provenance_id']}": r["status"] for r in rows})
    return len(rows)


# ---------------------------------------------------------------------------
# New-tender fit + submission-due-soon: one fetch of the national feed,
# scored with assess_tender.py exactly as watch_new_tenders.py does, reused
# for both signals so the OCDS feed is only ever fetched once per run.
# ---------------------------------------------------------------------------

def fetch_releases(days=14, sources="all", with_documents=True):
    """The same government sources Discovery reads (gov_sources.py; the
    OCDS-only read with sources='ocds'), published in the last `days` days.
    Returns (releases, gov_sources result or None).

    with_documents threads through to gov_sources.releases_for_watch()'s own
    per-release document/detail-page reads (SANRAL's ~85 detail pages at 1s
    apart, Eskom/Transnet's per-tender document lists, etc.) - the SLOW part
    of a run, separate from and in addition to score_per_company()'s own
    fan_out(fetch_document=...) (the PDF text download used for scoring
    itself). Before this was threaded through, --no-fetch-documents (whose
    own help text promises "much faster, useful for a quick local run") only
    ever skipped the second of those two document reads - every gov_sources
    detail-page fetch still ran in full regardless of the flag, so a "quick"
    local run was never actually quick. QA-Edge-Case-Findings.md, 2026-10-19
    (nineteenth run)."""
    today = datetime.datetime.now(watch_deadlines.SAST).date()
    date_from = (today - datetime.timedelta(days=days)).isoformat()
    if sources == "ocds":
        raw = etenders_national.fetch_releases(date_from, today.isoformat())
        return [etenders_national.normalize(r) for r in raw], None
    names = gov_sources.ALL_SOURCES if sources == "all" else [x.strip() for x in sources.split(",")]
    releases, res = gov_sources.releases_for_watch(names, with_documents=with_documents)
    return gov_sources.published_since(releases, date_from), res


def listing_change_signals(changes, scored):
    """Listing changes (tender_changes.py, 0051: cancelled, closing date
    moved, addendum listed, buyer's site disagrees with eTenders...) on the
    tenders in THIS company's scored feed - matched by ocid. Cancellations
    and moved dates first."""
    mine = {r.get("ocid") for r in scored if r.get("ocid")}
    order = {"cancelled": 0, "closing_date_changed": 1, "sources_disagree": 2, "briefing_changed": 3,
             "readvertised": 4, "document_added": 5}
    out = [c for c in changes if c.get("ocid") in mine]
    return sorted(out, key=lambda c: (order.get(c.get("change_type"), 9), c.get("contract_number") or ""))


def score_per_company(releases, companies, fetch_documents=True, fetch_text=None):
    """{company key: [scored release]} - the Discovery feed's own fan-out
    (watch_new_tenders.fan_out: each tender read once, scored per company
    from that company's own profile). A fresh seen dict, so nothing is
    recorded in the Discovery seen store: the digest is a daily summary,
    not the "never reported before" alert. Every verdict up to needs_review
    is kept (submission_due needs the wide set; new_tender_signals narrows)."""
    out = {c["key"]: [] for c in companies}
    entries = watch_new_tenders.fan_out(releases, companies, {}, watch_new_tenders.REPORT_WORTHY_VERDICTS_WIDE,
                                        fetch_document=fetch_documents, fetch_text=fetch_text)
    for e in entries:
        release = {k: v for k, v in e.items() if k not in ("company_results", "company_reassessed")}
        for c in e["company_results"]:
            out[c["company_key"]].append({**release, "verdict": c["verdict"], "reasons": c["reasons"],
                                          "score_outlook": c["score_outlook"]})
    return out


def company_signals(company_key, scored_by_company, document_expiry, tender_tasks, readiness_changes,
                    submission_lead_days, company_id=None, tender_updates=None, listing_changes=None,
                    reassessed_tenders=None):
    """One company's signals. With company_id set (live mode), the
    company-tagged sections (every item watch_deadlines/find_readiness_changes
    returns carries company_id) are narrowed to that company - a person never
    sees another tenant's expiries, tasks or readiness changes."""
    def own(items):
        return items if company_id is None else [i for i in items if i.get("company_id") == company_id]
    scored = scored_by_company.get(company_key, [])
    return {
        "new_tenders": new_tender_signals(scored),
        "document_expiry": own(document_expiry),
        "tender_tasks": own(tender_tasks),
        "readiness_changes": own(readiness_changes),
        "submission_due": submission_due_signals(scored, lead_days=submission_lead_days),
        # Already narrowed to the companies pursuing each tender by the watch
        # (tender_update_notifications rows are per company); own() keeps a
        # person to their own company's rows like every other section.
        "tender_updates": own(tender_updates or []),
        "listing_changes": listing_change_signals(listing_changes or [], scored),
        # Per company (discovered_opportunities rows), pursued first.
        "reassessed_tenders": own(reassessed_tenders or []),
    }


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
    today = datetime.datetime.now(watch_deadlines.SAST).date()
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

def find_readiness_changes(url, key, seen, today, owners=None):
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
        if owners is not None:
            owners[seen_key] = (packs_by_id.get(r.get("tender_pack_id")) or {}).get("company_id")
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

def load_roster_live(url, key, company_id=None, client=None):
    """company_members, each person named by e-mail: company_member_labels()
    (0033, the Tender Workspace activity log's own lookup; answers the service
    role since 0048). company_members has no name column, so the e-mail is the
    name shown; a member whose e-mail can't be read is "a team member (no
    e-mail found)", never a raw user id."""
    path = "company_members?select=user_id,company_id,tender_role,daily_digest_opt_in,companies(legal_name)"
    if company_id:
        path += f"&company_id=eq.{company_id}"
    rows = watch_deadlines.supabase_request(url, key, path)
    labels = company_profiles.member_labels(client or company_profiles.RestClient(url, key))
    roster = []
    for r in rows:
        who = company_profiles.member_entry(r, labels)
        roster.append({
            "person_id": r["user_id"],
            "name": who["label"],
            "email": who["email"],
            "company_id": r["company_id"],
            "company_name": (r.get("companies") or {}).get("legal_name"),
            "tender_role": r.get("tender_role") or DEFAULT_ROLE,
            # Opt-in, not opt-out (0073) - missing/false/None all mean "not
            # opted in". filter_opted_in() is what actually enforces this;
            # this loader only reports the column truthfully.
            "email_opt_in": r.get("daily_digest_opt_in") is True,
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
            # Local mode has no company_members row to read a real opt-in
            # from - a roster entry opts in explicitly ("email_opt_in": true
            # in the roster file), same opt-in-not-opt-out default as live
            # mode. See config/team_roster.example.json.
            "email_opt_in": member.get("email_opt_in") is True,
        })
    return roster


def filter_opted_in(roster):
    """Keep only roster entries that have actually opted in to the daily
    digest email (company_members.daily_digest_opt_in, migration 0073, or
    the local roster file's own "email_opt_in"). Pure, no network - this is
    the single gate between "has a company_members/roster row" and "gets a
    digest built at all"; main() calls it right after loading the roster, so
    an opted-out person's digest is never built, not merely never sent.
    Anything other than exactly True (missing key, None, False, a truthy
    string typo) is treated as "not opted in" - this is an opt-in feature,
    never an opt-out one, per Sarel's own instruction."""
    return [p for p in roster if p.get("email_opt_in") is True]


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

    if "tender_updates" in visible:
        items = signals.get("tender_updates") or []
        if role == "viewer":
            digest["tender_updates"] = {"count": len(items),
                                        "most_urgent": items[0].get("urgency") if items else None}
        else:
            digest["tender_updates"] = items

    if "listing_changes" in visible:
        items = signals.get("listing_changes") or []
        if role == "viewer":
            digest["listing_changes"] = {"count": len(items),
                                         "cancelled": sum(1 for c in items if c.get("change_type") == "cancelled")}
        else:
            digest["listing_changes"] = items

    if "reassessed_tenders" in visible:
        items = [i for i in signals.get("reassessed_tenders") or []
                 if i.get("pursuing") or "new_tenders" in visible]
        if items:
            if role == "viewer":
                digest["reassessed_tenders"] = {"count": len(items),
                                                "pursuing_count": sum(1 for i in items if i.get("pursuing"))}
            else:
                digest["reassessed_tenders"] = items
            digest.setdefault("_delivered_downgrades", []).extend(i["opportunity_id"] for i in items)

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
    ap.add_argument("--days", type=int, default=14, help="tenders published in the last N days")
    ap.add_argument("--sources", default="all",
                     help="'all' government sources (gov_sources.py, default), a comma list, or 'ocds'")
    ap.add_argument("--no-fetch-documents", action="store_true",
                     help="metadata-only scoring (no per-release document download) - much faster, "
                          "useful for a quick local run; watch_new_tenders.py's own default fetches "
                          "documents, so a real scheduled run should leave this off")
    ap.add_argument("--doc-lead-days", type=int, default=watch_deadlines.DEFAULT_DOC_LEAD_DAYS)
    ap.add_argument("--task-lead-days", type=int, default=watch_deadlines.DEFAULT_TASK_LEAD_DAYS)
    ap.add_argument("--submission-lead-days", type=int, default=14)
    ap.add_argument("--exclude-test-companies", action="store_true",
                     help="live mode: leave companies flagged is_test_company out of the tender scoring "
                          "(default: scored like every other company, same as the Discovery feed)")
    ap.add_argument("--out", default=None, help="write the full list of per-person digests to this JSON file")
    args = ap.parse_args()

    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    mode = args.mode or ("live" if url and key else "local")

    today = datetime.datetime.now(watch_deadlines.SAST).date()

    if mode == "local":
        if not args.profile:
            print("ERROR: --mode local needs --profile <the company's profile JSON> (there is no default company).")
            sys.exit(1)
        profile = assess_tender.load_company_profile(args.profile)
        roster = load_roster_local(args.roster)
        companies = [{"company_id": None, "legal_name": None, "key": LOCAL_COMPANY_KEY, "profile": profile}]
        # local_document_expiry()/local_person_credential_expiry() read the
        # profile JSON's own top-level "company"/"key_people" (the same raw
        # shape suggest_pack.py/generate_cv.py read for the identical file) -
        # NOT assess_tender.load_company_profile()'s own return value above,
        # which is a DIFFERENT, already-transformed dict (disciplines/
        # bee_level/black_ownership_pct/has_cidb_grading/offices only - no
        # "company" or "key_people" key at all). Passing that transformed
        # `profile` here instead of the raw file meant `profile.get("company",
        # {})` and `profile.get("key_people", [])` always silently returned
        # {}/[] regardless of what was really in the file - document_expiry
        # and person_credential_expiry signals were unconditionally empty in
        # --mode local, for every company, with no error. QA pass, 2026-10-31
        # (the dedicated test for these two functions masked it: it hand-built
        # a {"key_people": [...]} fixture directly, bypassing this exact
        # wiring). --mode local is dev/offline-only - the real scheduled run
        # (.github/workflows/daily-digest.yml) always passes --mode live,
        # which reads Supabase directly and was never exposed to this.
        try:
            raw_profile = json.load(open(args.profile))
        except (OSError, json.JSONDecodeError) as e:
            # Same graceful degrade as assess_tender.load_company_profile()'s
            # own read of this exact file, moments earlier - that call already
            # printed its own WARNING and fell back silently; this one must
            # not newly turn the same bad file into an unhandled crash.
            print(f"  WARNING: could not re-read {args.profile!r} for document/person-credential expiry ({e}) - "
                  "those two sections will be empty this run.")
            raw_profile = {}
        document_expiry = (local_document_expiry(raw_profile, today, args.doc_lead_days)
                           + local_person_credential_expiry(raw_profile, today, args.doc_lead_days))
        tender_tasks = []  # Supabase-only, no local fixture (see module docstring)
        readiness_changes = []  # Supabase-only
        tender_updates, updates_client = [], None  # Supabase-only (0039)
        reassessed = []  # Supabase-only (0055)
    else:
        if not url or not key:
            print("ERROR: --mode live needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
            sys.exit(1)
        client = company_profiles.RestClient(url, key)
        roster = load_roster_live(url, key)
        companies = company_profiles.all_company_profiles(client, not args.exclude_test_companies)
        # A database error here fails the run loudly (recorded in system_alerts
        # by the __main__ guard) - never "nothing seen", which would re-report everything.
        seen, seen_loaded = watch_deadlines.load_seen_db(client, DIGEST_CONSUMER)
        readiness_seen, readiness_loaded = load_readiness_seen_db(client)
        owners = {}
        document_expiry = (watch_deadlines.find_due_documents(url, key, seen, today, args.doc_lead_days)
                           + watch_deadlines.find_due_person_credentials(url, key, seen, today, args.doc_lead_days)
                           # 0050: catalog registrations (company -> "document", person/director ->
                           # "person_credential") and property documents, same routing
                           + watch_deadlines.registration_reminders.find_due_registrations(url, key, seen, today, args.doc_lead_days)
                           + watch_deadlines.registration_reminders.find_due_property_documents(url, key, seen, today, args.doc_lead_days))
        tender_tasks = watch_deadlines.find_due_tasks(url, key, seen, today, args.task_lead_days)
        readiness_changes = find_readiness_changes(url, key, readiness_seen, today, owners)
        # Updates the tender-update watch already alerted on, not yet in a
        # digest (tender_update_notifications.digested_at, 0039). A failure
        # here must not cost anyone the rest of their digest.
        updates_client = client
        try:
            tender_updates = watch_tender_updates.pending_digest_updates(updates_client)
        except Exception as e:
            print(f"WARNING: tender updates could not be read ({e}) - digest goes out without them.")
            system_alerts.record("digest", f"The daily digest could not read tender updates: {type(e).__name__}: {e}",
                                 "error", exc=e)
            tender_updates, updates_client = [], None
        # Discovery verdicts a re-score made worse, not yet in a digest (0055).
        try:
            reassessed = discovery_downgrades.pending_digest_downgrades(client)
        except Exception as e:
            print(f"WARNING: re-assessed tenders could not be read ({e}) - digest goes out without them.")
            system_alerts.record("digest", f"The daily digest could not read re-assessed tenders: {type(e).__name__}: {e}",
                                 "error", exc=e)
            reassessed = []

    # Opt-in gate (0073): drop anyone who hasn't explicitly opted in BEFORE
    # building anything for them, not just before sending. roster_total is
    # kept only for the log line below - everything after this uses the
    # filtered list.
    roster_total = len(roster)
    roster = filter_opted_in(roster)
    print(f"Roster: {roster_total} {'person' if roster_total == 1 else 'people'}, "
          f"{len(roster)} opted in to the daily digest email ({roster_total - len(roster)} not opted in).")
    if not roster:
        print("Nobody has opted in - nothing to build. (This is expected until people turn the toggle on at /company.)")

    print(f"Scoring the national feed ({args.days} days) for {len(companies)} compan"
          f"{'y' if len(companies) == 1 else 'ies'}, each from its own profile...")
    releases, gov_res = fetch_releases(args.days, args.sources, with_documents=not args.no_fetch_documents)
    if gov_res is not None and gov_res.get("errors"):
        # Same gap as watch_new_tenders.py's own equivalent call site:
        # gov_sources.fetch_all() isolates one source's own failure from the
        # rest, but nothing ever surfaced that to Sarel - a source silently
        # missing from a whole digest run, invisible outside stdout.
        failed = ", ".join(sorted(gov_res["errors"]))
        system_alerts.record(
            "digest",
            f"{len(gov_res['errors'])} government source(s) failed this run and were skipped: {failed}",
            "warning", detail=str(gov_res["errors"]))
    scored_by_company = score_per_company(releases, companies,
                                          fetch_documents=not args.no_fetch_documents)
    # Listing changes on the same read: recorded in the change store (Supabase
    # tables in live mode, state/ JSON locally) and every change detected this
    # run is matched to each company's feed. A failure must not cost anyone
    # the rest of their digest.
    listing_changes = []
    if gov_res is not None:
        try:
            store = (tender_changes.SupabaseStore(company_profiles.RestClient(url, key)) if mode == "live"
                     else tender_changes.LocalStore())
            tender_changes.run(gov_res, store)
            # Everything recorded in the last day on any tender in a company's
            # feed - including what an earlier watch_new_tenders.py run today
            # recorded from its own read (it runs the same tracker).
            feed_ocids = {r.get("ocid") for rows in scored_by_company.values() for r in rows}
            since = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=26)
            listing_changes = store.recent_changes(feed_ocids, since)
        except Exception as e:
            print(f"WARNING: listing changes could not be tracked ({e}) - digest goes out without them.")
            system_alerts.record("digest", f"The daily digest could not track listing changes: {type(e).__name__}: {e}",
                                 "error", exc=e)

    if mode == "live":
        n = (watch_deadlines.save_seen_db(client, seen, seen_loaded, DIGEST_CONSUMER)
             + save_readiness_seen_db(client, readiness_seen, readiness_loaded, owners))
        print(f"  Seen stores: deadline_reminders_seen ({DIGEST_CONSUMER}) + {READINESS_TABLE} - {n} row(s) written")

    digests, totals, delivered_downgrades = [], {}, set()
    for p in roster:
        # One bad roster entry (a malformed/corrupted row - missing a key
        # signals() or build_digest_for_person() assumes) must not cost
        # everyone else their digest. Enterprise-readiness audit round 2,
        # 2026-10-20: this loop previously had no isolation at all - one
        # bad entry raised uncaught and aborted every digest after it in
        # roster order, with no alert, silently.
        try:
            ckey = LOCAL_COMPANY_KEY if mode == "local" else p["company_id"]
            signals = company_signals(ckey, scored_by_company, document_expiry, tender_tasks, readiness_changes,
                                      args.submission_lead_days, company_id=None if mode == "local" else p["company_id"],
                                      tender_updates=tender_updates, listing_changes=listing_changes,
                                      reassessed_tenders=reassessed)
            for k, v in signals.items():
                totals.setdefault(k, {})[ckey] = len(v)
            d = build_digest_for_person(p, signals)
            delivered_downgrades.update(d.pop("_delivered_downgrades", []))
            digests.append(d)
        except Exception as e:
            label = p.get("email") or p.get("user_id") or "(unidentified roster entry)"
            print(f"  WARNING: could not build a digest for {label} ({type(e).__name__}: {e}) - skipping this one, "
                  "the rest of the run continues.")
            system_alerts.record("digest", f"Could not build a digest for one roster entry ({label}): "
                                 f"{type(e).__name__}: {e}", "error", exc=e)

    def total(k):
        return sum((totals.get(k) or {}).values())
    print(f"\nSignals this run (summed over the {len({p['company_id'] for p in roster})} roster compan"
          f"{'y' if len({p['company_id'] for p in roster}) == 1 else 'ies'}): "
          f"{total('new_tenders')} new matching tender(s), "
          f"{total('document_expiry')} document(s) due for expiry reminder, "
          f"{total('tender_tasks')} tender task(s) due, "
          f"{total('readiness_changes')} readiness change(s), "
          f"{total('submission_due')} tender(s) closing soon, "
          f"{total('tender_updates')} tender update(s) (addenda, new documents), "
          f"{total('listing_changes')} listing change(s) (cancellations, date moves) on tenders in the feed, "
          f"{total('reassessed_tenders')} re-assessed tender(s) no longer as good a fit.")

    # Each update is carried by one digest only: mark the ones that went to a
    # roster company as digested (the watch already alerted on them).
    if updates_client is not None:
        roster_companies = {p["company_id"] for p in roster}
        delivered = [u for u in tender_updates if u["company_id"] in roster_companies]
        try:
            watch_tender_updates.mark_digested(updates_client, delivered)
        except Exception as e:
            print(f"WARNING: could not mark {len(delivered)} tender update(s) as digested ({e}) - "
                  "they will be carried again tomorrow.")

    # Each downgrade is carried once: only the ones that reached at least one
    # person (a plain-feed downgrade in a company with no full_cycle/viewer
    # member stays pending - it is still flagged on the Discovery card).
    if mode == "live" and delivered_downgrades:
        try:
            discovery_downgrades.mark_digested(client, [i for i in reassessed if i["opportunity_id"] in delivered_downgrades])
        except Exception as e:
            print(f"WARNING: could not mark {len(delivered_downgrades)} re-assessed tender(s) as digested ({e}) - "
                  "they will be carried again tomorrow.")

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
    # `profile.get("company", {})` only substitutes {} when the key is
    # ABSENT, not when it's present with None - a real profile.json shape
    # (same "null present, not missing" distinction already fixed for the
    # identical file's "key_people"/"projects" keys in generate_cv.py/
    # suggest_pack.py). "or {}" degrades null the same as missing.
    company = profile.get("company") or {}
    fields = [
        ("coid_letter_of_good_standing_expiry", "COID Letter of Good Standing"),
        ("sars_tcs_pin_expiry", "SARS Tax Compliance Status PIN"),
    ]
    due = []
    for col, label in fields:
        expiry = company.get(col)
        if not expiry:
            continue
        # watch_deadlines.days_until() rather than reimplementing the same
        # parse inline: this function's own docstring already calls itself
        # the "local-mode equivalent" of find_due_documents(), and a bare
        # fromisoformat() here crashed on a malformed date with no handling
        # at all (watch_deadlines QA pass).
        left = watch_deadlines.days_until(expiry, today)
        if left is None or left > lead_days:
            continue
        due.append({
            "type": "document", "field": col, "label": label,
            "expiry_date": expiry, "days_left": left,
            "status": "expired" if left < 0 else "renew_soon",
        })
    pi = company.get("professional_indemnity_insurance") or {}
    pi_expiry = pi.get("period_to")
    if pi_expiry:
        left = watch_deadlines.days_until(pi_expiry, today)
        if left is not None and left <= lead_days:
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
    # Same null-vs-missing fix as local_document_expiry()'s own "company"
    # read just above - "key_people": null is a real shape, not just absent.
    for person in profile.get("key_people") or []:
        q = person.get("qualifications") or {}
        for col, label, lead_override, num_col in watch_deadlines.TRACKED_PERSON_EXPIRY_FIELDS:
            expiry = q.get(col)
            if not expiry:
                continue
            left = watch_deadlines.days_until(expiry, today)
            # days_until() returns None for a malformed date too, not just a
            # missing one (watch_deadlines QA pass) - this call site already
            # guards "missing" with the `if not expiry` above, so it must
            # guard "malformed" the same way, or a bad date here would trade
            # days_until()'s own ValueError for a TypeError one line down.
            if left is None or left > (lead_override if lead_override is not None else lead_days):
                continue
            due.append({
                "type": "person_credential", "person_name": person.get("name"), "field": col,
                "label": label, "registration_number": q.get(num_col), "expiry_date": expiry,
                "days_left": left, "status": "expired" if left < 0 else "renew_soon",
            })
    return due


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # the run itself broke (feed down, database unreachable): Sarel must hear of it
        system_alerts.record("digest", f"The daily digest run failed: {type(e).__name__}: {e}", "critical", exc=e)
        raise
