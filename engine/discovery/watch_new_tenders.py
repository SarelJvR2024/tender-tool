"""
Stream 5 (discovery), new-tender watch: runs the national OCDS discovery feed
(etenders_national.py), scores every release against EVERY company in the
system - each from its own profile (company_profiles.py: that company's own
Experience Library disciplines, CIDB grading, B-BBEE and offices) - and diffs
against a per-company "seen" store so a run only ever reports, per company,
releases it has never reported to that company before.

Fan-out, not one shared verdict (Sarel, 2026-10-17, Hardcoded-Assumptions-Audit
Q4: "It should score for all companies in the app. Nothing must be klipcorp
specific, they are just a company, not a benchmark"). Before this, the feed
was scored against config/klipcorp_profile.json and every result attached to
"Klipcorp (Pty) Ltd". Now each tender's documents are read ONCE
(assess_tender.read_release) and that reading is scored separately for each
company (assess_tender.score_release), so the same tender can be a strong fit
for one company and not a fit for another. Each company's report-worthy
verdict becomes its own discovered_opportunities row
(seed_supabase_opportunities.py).

Why this exists: Sarel cannot auto-download SANRAL's own tender documents
(gated behind a name/company/email form plus a CAPTCHA - see
etenders_national.py's module docstring for the full distinction between that
gate and this public, unauthenticated OCDS API). Until that's solved, the
realistic automation boundary is: find what's new, score it, and hand back
the real document URL(s) so a human can click through in under a minute. This
script is exactly that boundary - it never tries to fetch SANRAL's own gated
documents itself.

The "seen" store tracks, per company, every release this script has scored
for that company, keyed by ocid (falling back to contract_number for the rare
release with no ocid), with a fingerprint of the profile it was scored
against. A company added later is scored on the releases still in the window.
A company already scored on a release is not scored or notified again -
unless one of these holds (Sarel, 2026-10-17):
  - its OWN profile changed since (the stored profile_fingerprint differs
    from company_profiles.profile_fingerprint() of its profile now - e.g. it
    tagged new Experience Library items, added an office, got a CIDB
    grading): the release is re-scored for that company, its seen row is
    updated, and a report-worthy verdict is reported again as new, marked
    rescored="profile_changed" with the previous_verdict. The tender didn't
    change; the company's situation did.
  - its last scoring raised (verdict ERROR): retried on every run instead of
    being remembered as seen (rescored="retry_after_error"), and every
    failure is recorded in system_alerts (engine/alerts/system_alerts.py) so
    it reaches Sarel instead of sitting in the seen store.
A verdict that merely drifts on the same profile (more of a document became
readable) is still not re-reported - that would defeat the point of a
"what's new" alert. A seen entry with no stored fingerprint (written before
fingerprints existed) gets the current one, so only a LATER change counts.

Where it lives (audit follow-up (d), Sarel 2026-10-17):
  - Supabase mode (every company from the database): the
    discovery_seen_releases table (migration 0038), one row per company x
    release, with the verdict and a fingerprint of the profile it was scored
    against. Read for the releases in this run's window, new rows written at
    the end. This is the real store: it survives a redeploy or a run from
    another machine, and it is per company because scoring is.
  - --profile files (a local run without Supabase): the local JSON file
    (--seen-store, default state/seen_tenders.json). File companies have no
    company_id to key a database row on, so this is the only store there.
    The JSON file is never used in Supabase mode, and the database is never
    silently skipped: if the table can't be read or written the run fails
    loudly instead of re-reporting (or forgetting) everything.

Test companies (companies.is_test_company) are scored and reported like any
other company (audit follow-up (a), Sarel 2026-10-17: "let it come up in the
discovery results"); --exclude-test-companies leaves them out.

Usage:
    python3 watch_new_tenders.py [--days N] [--buyer SUBSTRING]
        [--out report.json] [--exclude-test-companies]
        (every company, read from Supabase: NEXT_PUBLIC_SUPABASE_URL +
        SUPABASE_SERVICE_ROLE_KEY; seen store = discovery_seen_releases)
    python3 watch_new_tenders.py --profile a.json --profile b.json ... [--seen-store PATH]
        (local run without Supabase: exactly the companies these files name;
        seen store = the local JSON file)
There is no default profile file: with neither Supabase nor --profile the
script stops instead of scoring the feed for one sample company.

Exit/output contract for whatever wraps this (an email/WhatsApp notifier,
a scheduled task): prints one line per newly-seen, report-worthy release to
stdout, and - with --out - writes the full list as JSON for the caller to
format into a real notification. Nothing here sends a notification itself;
that is a deliberately separate concern (see docs/specs).
"""
import os
import sys
import json
import argparse
import datetime

sys.path.insert(0, os.path.dirname(__file__))
import etenders_national
import assess_tender
import company_profiles
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "alerts"))
import system_alerts  # noqa: E402

DEFAULT_SEEN_STORE = os.path.join(os.path.dirname(__file__), "..", "..", "state", "seen_tenders.json")

# Verdicts worth waking Sarel up for. "closed" (already past closing) and
# "not_a_fit" (wrong discipline/no CIDB match) are scored and recorded in the
# seen store like everything else, but never reported - reporting those would
# train him to ignore the alerts.
#
# "needs_review" is deliberately NOT in the default set, confirmed by running
# this for real against the live national feed (2026-10-16, no buyer filter):
# of 74 report-worthy releases, 72 were needs_review and only 2 were
# strong_fit - almost all of that needs_review bulk was categorize()'s
# "could not match a discipline, could be anything" fallback firing on
# obviously unrelated procurement (kitchen consumables, a diamond valuator,
# a GSM lift intercom system), not a genuine "might be relevant, worth a
# look" case. An email with 72 irrelevant tenders in it trains the reader to
# stop opening it. --include-needs-review opts back into the wider sweep for
# someone doing a manual review, not for the automated daily alert.
REPORT_WORTHY_VERDICTS = {"strong_fit", "possible"}
REPORT_WORTHY_VERDICTS_WIDE = REPORT_WORTHY_VERDICTS | {"needs_review"}


def load_seen(path):
    try:
        return json.load(open(path))
    except (OSError, json.JSONDecodeError):
        return {}


def save_seen(path, seen):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(seen, f, indent=2)


SEEN_TABLE = "discovery_seen_releases"  # 0038
SEEN_CHUNK = 100  # release keys per in.(...) read / rows per upsert


def release_key(r):
    return r.get("ocid") or r.get("contract_number")


def _chunks(items, n=SEEN_CHUNK):
    for i in range(0, len(items), n):
        yield items[i:i + n]


def load_seen_db(client, releases):
    """The database seen store (0038) for these releases, in fan_out()'s
    dict shape: {release_key: {first_seen, ocid, contract_number, title,
    companies: {company_id: verdict}, fingerprints: {company_id: sha256}}}.
    Only the releases in this run's window are read - the table grows with
    every run, the window doesn't. Returns (seen, loaded) where `loaded` maps
    each stored (release_key, company_id) pair to its stored (verdict,
    profile_fingerprint), so save_seen_db() writes only new or changed rows."""
    keys = sorted({k for k in (release_key(r) for r in releases) if k})
    seen, loaded = {}, {}
    for chunk in _chunks(keys):
        for row in client.select(SEEN_TABLE, {"release_key": chunk}, order="company_id.asc,release_key.asc"):
            k = row["release_key"]
            e = seen.setdefault(k, {"first_seen": row.get("first_seen"), "ocid": row.get("ocid"),
                                    "contract_number": row.get("contract_number"), "title": row.get("title"),
                                    "companies": {}, "fingerprints": {}})
            if row.get("first_seen") and (not e["first_seen"] or row["first_seen"] < e["first_seen"]):
                e["first_seen"] = row["first_seen"]
            e["companies"][row["company_id"]] = row["verdict"]
            if row.get("profile_fingerprint"):
                e["fingerprints"][row["company_id"]] = row["profile_fingerprint"]
            loaded[(k, row["company_id"])] = (row["verdict"], row.get("profile_fingerprint"))
    return seen, loaded


def save_seen_db(client, seen, loaded, companies):
    """Writes every (release, company) pair fan_out() scored this run that
    is new, or whose verdict / profile fingerprint changed (a re-score after a
    profile change or an ERROR retry - updated in place, first_seen kept).
    Only database companies (with a company_id) - a --profile file company
    has no row to key on. Returns rows written."""
    by_key = {c["key"]: c for c in companies if c.get("company_id")}
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    rows = []
    for k, e in seen.items():
        for ckey, verdict in (e.get("companies") or {}).items():
            c = by_key.get(ckey)
            if not c:
                continue
            fp = (e.get("fingerprints") or {}).get(ckey) or company_profiles.profile_fingerprint(c["profile"])
            if loaded.get((k, c["company_id"])) == (verdict or "ERROR", fp):
                continue
            rows.append({"company_id": c["company_id"], "release_key": k, "ocid": e.get("ocid"),
                         "contract_number": e.get("contract_number"), "title": e.get("title"),
                         "verdict": verdict or "ERROR", "profile_fingerprint": fp,
                         "first_seen": e.get("first_seen"), "scored_at": now})
    for chunk in _chunks(rows):
        client.upsert(SEEN_TABLE, chunk, "company_id,release_key")
    loaded.update({(r["release_key"], r["company_id"]): (r["verdict"], r["profile_fingerprint"]) for r in rows})
    return len(rows)


RELEASE_FIELDS = ("contract_number", "buyer", "title", "description", "closing_date", "categories",
                  "document_depth", "signals", "confidence_note")


def _pending(entry, companies, fps):
    """{company key: why} for the companies to (re-)score on this release:
    None = never scored, "retry_after_error" = last scoring raised,
    "profile_changed" = the company's profile fingerprint differs from the
    one its verdict was scored against. A missing stored fingerprint is
    backfilled with the current one (only a later change counts)."""
    out = {}
    stored = entry.setdefault("fingerprints", {})
    for c in companies:
        k = c["key"]
        if k not in entry["companies"]:
            out[k] = None
        elif entry["companies"][k] in (None, "ERROR"):
            out[k] = "retry_after_error"
        elif not stored.get(k):
            stored[k] = fps[k]
        elif stored[k] != fps[k]:
            out[k] = "profile_changed"
    return out


def fan_out(releases, companies, seen, report_worthy, today=None, fetch_document=True, fetch_text=None):
    """Scores each release once per company not yet scored on it - and again
    for a company whose own profile changed since, or whose last scoring
    raised (see the module docstring). Returns the new, report-worthy
    releases: release-level facts (the same for every company) plus
    `company_results`, one entry per company whose OWN verdict is
    report-worthy - {company_id, legal_name, company_key, verdict, reasons,
    score_outlook, rescored, previous_verdict}; `rescored` is None for a
    first scoring, else "profile_changed" / "retry_after_error". Mutates
    `seen`. A seen-store entry written before the fan-out (no "companies"
    key) was scored against one shared profile file, not any company's own
    rows, so it is scored again for every company."""
    today = (today or datetime.date.today()).isoformat()
    fps = {c["key"]: company_profiles.profile_fingerprint(c["profile"]) for c in companies}
    out = []
    for r in releases:
        key = release_key(r)
        if not key:
            continue
        entry = seen.get(key)
        if not entry or not isinstance(entry.get("companies"), dict):
            entry = {"first_seen": (entry or {}).get("first_seen") or today, "ocid": r.get("ocid"),
                     "contract_number": r.get("contract_number"), "title": r.get("title"), "companies": {},
                     "fingerprints": {}}
            seen[key] = entry
        why = _pending(entry, companies, fps)
        pending = [c for c in companies if c["key"] in why]
        if not pending:
            continue
        ctx = {"ocid": r.get("ocid"), "contract_number": r.get("contract_number"), "buyer": r.get("buyer")}
        try:
            reading = assess_tender.read_release(r, fetch_document=fetch_document, fetch_text=fetch_text)
        except Exception as e:
            reading, read_error = None, str(e)
            system_alerts.record("discovery", f"Could not read a discovered tender for scoring: {type(e).__name__}: {e}",
                                 "error", exc=e, context=ctx)
        results, base = [], None
        for c in pending:
            try:
                if reading is None:
                    raise RuntimeError(read_error)
                res = assess_tender.score_release(r, reading, c["profile"])
            except Exception as e:
                res = {"contract_number": r.get("contract_number"), "verdict": "ERROR", "error": str(e)}
                if reading is not None:  # a read failure was recorded once above, not once per company
                    system_alerts.record("discovery", f"Scoring a tender for a company failed: {type(e).__name__}: {e}",
                                         "error", exc=e, context={**ctx, "company_id": c.get("company_id"),
                                                                  "company": c.get("legal_name")})
            previous = entry["companies"].get(c["key"])
            entry["companies"][c["key"]] = res.get("verdict")
            entry["fingerprints"][c["key"]] = fps[c["key"]]
            base = base or (res if res.get("verdict") != "ERROR" else None)
            if res.get("verdict") in report_worthy:
                results.append({"company_id": c["company_id"], "legal_name": c["legal_name"], "company_key": c["key"],
                                "verdict": res["verdict"], "reasons": res.get("reasons") or [],
                                "score_outlook": res.get("score_outlook"), "rescored": why[c["key"]],
                                "previous_verdict": previous if why[c["key"]] else None})
        if results:
            out.append({**{k: base.get(k) for k in RELEASE_FIELDS}, "ocid": r.get("ocid"),
                        "documents": r.get("documents"), "company_results": results})
    return out


def load_companies(profile_paths=None, include_test_companies=True, client=None):
    """--profile files if given, else every company in Supabase (test
    companies included unless include_test_companies=False). Never a default
    sample profile. Returns (companies, source, client) - client is the
    Supabase client in Supabase mode (it also holds the seen store), else None."""
    if profile_paths:
        return company_profiles.profiles_from_files(profile_paths), "profile files", None
    client = client or company_profiles.RestClient.from_env()
    if client is None:
        raise SystemExit("ERROR: no companies to score for. Set NEXT_PUBLIC_SUPABASE_URL and "
                         "SUPABASE_SERVICE_ROLE_KEY (every company in the system is scored from its own rows), "
                         "or pass --profile for a local run. There is deliberately no default company profile.")
    return company_profiles.all_company_profiles(client, include_test_companies), "Supabase", client


def run(releases, companies, report_worthy, client=None, seen_store=DEFAULT_SEEN_STORE, today=None,
        fetch_document=True, fetch_text=None, log=print):
    """fan_out() with the right seen store around it: the database table when
    `client` is set (Supabase mode), else the local JSON file."""
    if client is not None:
        seen, loaded = load_seen_db(client, releases)
        log(f"  Seen store: {SEEN_TABLE} (database) - {len(loaded)} company x release row(s) for this window")
        out = fan_out(releases, companies, seen, report_worthy, today, fetch_document, fetch_text)
        log(f"  Seen store: {save_seen_db(client, seen, loaded, companies)} row(s) written to {SEEN_TABLE} "
            "(new, re-scored after a profile change, or an ERROR retried)")
    else:
        seen = load_seen(seen_store)
        log(f"  Seen store: {seen_store} (local JSON - no Supabase companies in this run)")
        out = fan_out(releases, companies, seen, report_worthy, today, fetch_document, fetch_text)
        save_seen(seen_store, seen)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=14,
                     help="how many days back to search for releases (default 14 - wide enough to "
                          "survive a missed run or two without losing anything, since the seen "
                          "store - not the date window - is what prevents duplicate reports)")
    ap.add_argument("--profile", action="append", default=None,
                     help="a company profile JSON to score for (repeatable) - a local run without Supabase. "
                          "Without it, every company in Supabase is scored from its own rows.")
    ap.add_argument("--exclude-test-companies", action="store_true",
                     help="leave out companies flagged is_test_company (Supabase mode). Default: they are "
                          "scored and reported like every other company (Sarel, 2026-10-17)")
    ap.add_argument("--seen-store", default=DEFAULT_SEEN_STORE,
                     help="local JSON seen store, used only for a --profile run (no Supabase companies). "
                          "In Supabase mode the seen store is the discovery_seen_releases table.")
    ap.add_argument("--buyer", default=None,
                     help="case-insensitive substring filter on the buyer/organ-of-state name")
    ap.add_argument("--out", default=None, help="write the full list of newly-seen, report-worthy releases to this JSON file")
    ap.add_argument("--include-needs-review", action="store_true",
                     help="also report needs_review verdicts, not just strong_fit/possible - noisy on the "
                          "unfiltered national feed (confirmed: 72 of 74 on a real run were irrelevant "
                          "categories), use for a manual sweep, not the automated daily alert")
    args = ap.parse_args()

    report_worthy = REPORT_WORTHY_VERDICTS_WIDE if args.include_needs_review else REPORT_WORTHY_VERDICTS
    companies, source, client = load_companies(args.profile, not args.exclude_test_companies)
    print(f"Scoring for {len(companies)} compan{'y' if len(companies) == 1 else 'ies'} ({source}): "
          + ", ".join(c["legal_name"] or c["key"] for c in companies))
    if not companies:
        print("  No companies to score for - nothing to do.")
        return []

    today = datetime.date.today()
    date_from = (today - datetime.timedelta(days=args.days)).isoformat()
    date_to = today.isoformat()
    print(f"Fetching OCDS releases from {date_from} to {date_to}...")
    raw = etenders_national.fetch_releases(date_from, date_to)
    normalized = [etenders_national.normalize(r) for r in raw]
    if args.buyer:
        needle = args.buyer.lower()
        normalized = [r for r in normalized if r["buyer"] and needle in r["buyer"].lower()]
    print(f"  {len(normalized)} release(s) in range" + (f" matching buyer '{args.buyer}'" if args.buyer else ""))

    new_releases = run(normalized, companies, report_worthy, client, args.seen_store, today)

    print(f"\n{len(new_releases)} new, report-worthy release(s) for at least one company "
          f"(verdict in {sorted(report_worthy)}):")
    for r in new_releases:
        docs = ", ".join(d["url"] for d in (r.get("documents") or []) if d.get("url")) or "(no document URL on file)"
        print(f"  {r.get('contract_number'):>14}  {r.get('buyer')}  -  {r.get('title')}")
        for c in r["company_results"]:
            again = {"profile_changed": f"  (re-scored: its profile changed since; was {c.get('previous_verdict')})",
                     "retry_after_error": "  (re-scored: the last scoring failed)"}.get(c.get("rescored"), "")
            print(f"      {c['verdict']:<14} {c['legal_name']}{again}")
        print(f"      closes {r.get('closing_date')}  |  {docs}")

    if args.out:
        with open(args.out, "w") as f:
            json.dump(new_releases, f, indent=2)
        print(f"\nWrote {args.out}")

    return new_releases


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # the run itself broke (feed down, database unreachable): Sarel must hear of it
        system_alerts.record("discovery", f"The new-tender watch run failed: {type(e).__name__}: {e}", "critical", exc=e)
        raise
