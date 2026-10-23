"""
Stream 5 (discovery), new-tender watch: reads every government tender source
(gov_sources.py: the eTenders portal in full, SANRAL, Eskom, Transnet, Cape
Town - or the OCDS feed alone with --sources ocds), scores every release against EVERY company in the
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
verdict becomes its own discovered_opportunities row: main() calls
seed_supabase_opportunities.seed() itself in Supabase mode (unless --no-seed),
so a scheduled run of this script alone is enough to populate /discovery -
see --no-seed's help for the one case where you'd still run
seed_supabase_opportunities.py by hand against --out instead.

main() also calls download_discovered_documents.download_for_releases()
itself (unless --no-download-documents), right after seeding: every
document on this run's discovered releases is downloaded and permanently
stored (discovered_opportunity_documents / the 'discovered-tender-documents'
bucket, migration 0071) - automatically, at discovery time, for every
source except SANRAL (reCAPTCHA v3 wall - see that script's docstring and
migration 0071's header). Idempotent across runs: a document already on
file is never re-downloaded.

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
A re-score that makes the verdict WORSE is flagged, not silent (Sarel,
2026-10-17: "When evaluation downgrades opportunity it must be flagged"): a
re-scored company whose new verdict is no longer report-worthy is listed in
the release's `company_reassessed` (with its previous_verdict), so the seeder
can mark the company's existing Discovery row "was strong_fit, now not_a_fit"
(discovery_downgrades.py, migration 0055) instead of leaving it saying a
match; the CLI prints every downgrade. A release with only such entries is in
--out with an empty `company_results`.
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
import concurrent.futures

sys.path.insert(0, os.path.dirname(__file__))
import etenders_national
import gov_sources
import assess_tender
import company_profiles
import discovery_downgrades
import seed_supabase_opportunities
import download_discovered_documents
import source_http as sh  # SAST - see both date.today() fixes below
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


# Listing facts a direct reader / the eTenders portal carries (gov_sources.py,
# source_http.release) - passed through to discovered_opportunities (0051).
LISTING_FIELDS = ("source", "listing_sources", "province", "tender_type", "briefing", "status")
RELEASE_FIELDS = ("contract_number", "buyer", "title", "description", "closing_date", "categories",
                  "etenders_category", "etenders_category_check",  # audit O1 cross-reference
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


FAN_OUT_READ_WORKERS = 12  # read_release() is I/O-bound (network fetches, each
# with its own 45s hard deadline - assess_tender.fetch_pdf_text's own 30s
# timeout + 15s grace) and touches no shared state, so a bounded thread pool
# is safe here. Before this, every release's document read ran strictly
# sequentially: with ~1,400+ releases in the 14-day window and dozens of
# slow/dead document hosts, those 45s stalls stacked up one at a time -
# confirmed live via py-spy on a run that took 4.5 hours instead of the
# normal ~20 minutes (genuinely progressing the whole time, never hung;
# flagged by a sibling session's own daily tender-watch check-in, 2026-10-23,
# worse as more companies onboard since a brand-new company's first-ever
# scoring pass reads the FULL window). Scoring itself (score_release) stays
# sequential, right after this, exactly as before - it's fast (no I/O) and
# mutates `seen`/`entry`, which a thread pool would need to synchronise for
# no real benefit. An overall wall-clock run budget (the sibling's other
# suggestion) is a real, separate idea - deliberately not built here without
# working out what "stop early" should leave in the seen store for the
# releases it never got to; flagged, not half-built.


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
    rows, so it is scored again for every company.

    The document read for each release that needs one runs concurrently
    (FAN_OUT_READ_WORKERS, see its own comment) - everything else here stays
    single-threaded and in release order, same as before."""
    today = (today or datetime.datetime.now(sh.SAST).date()).isoformat()
    fps = {c["key"]: company_profiles.profile_fingerprint(c["profile"]) for c in companies}

    # Pass 1 (fast, no I/O, release order): which releases actually need a
    # document read, and the seen-store bookkeeping that was already done
    # up front regardless of pending/reading.
    prepared = []
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
        prepared.append((r, entry, why, pending))

    # Pass 2 (slow, I/O-bound, unordered): read every prepared release's own
    # documents concurrently - read_release() takes no mutable state, so
    # this is safe. One release's slow/dead host no longer serialises behind
    # every other release's own 45s hard timeout.
    readings = {}
    if prepared:
        with concurrent.futures.ThreadPoolExecutor(max_workers=FAN_OUT_READ_WORKERS) as pool:
            futures = {pool.submit(assess_tender.read_release, r, fetch_document=fetch_document,
                                   fetch_text=fetch_text): i
                      for i, (r, _entry, _why, _pending) in enumerate(prepared)}
            for fut in concurrent.futures.as_completed(futures):
                i = futures[fut]
                try:
                    readings[i] = (fut.result(), None)
                except Exception as e:
                    readings[i] = (None, e)

    # Pass 3 (fast, no I/O, release order): score each release's pending
    # companies - unchanged from before this fix, just reading the
    # concurrently-fetched result instead of fetching it inline.
    out = []
    for i, (r, entry, why, pending) in enumerate(prepared):
        reading, read_exc = readings[i]
        ctx = {"ocid": r.get("ocid"), "contract_number": r.get("contract_number"), "buyer": r.get("buyer")}
        if reading is None:
            read_error = str(read_exc)
            system_alerts.record("discovery", f"Could not read a discovered tender for scoring: {type(read_exc).__name__}: {read_exc}",
                                 "error", exc=read_exc, context=ctx)
        results, reassessed, base = [], [], None
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
            elif why[c["key"]] and res.get("verdict") in discovery_downgrades.FIT_VERDICTS:
                # Re-scored and no longer report-worthy: the seeder flags the
                # company's existing Discovery row if this is a downgrade.
                reassessed.append({"company_id": c["company_id"], "legal_name": c["legal_name"],
                                   "company_key": c["key"], "verdict": res["verdict"],
                                   "reasons": res.get("reasons") or [], "score_outlook": res.get("score_outlook"),
                                   "rescored": why[c["key"]], "previous_verdict": previous})
        if results or reassessed:
            out.append({**{k: base.get(k) for k in RELEASE_FIELDS}, "ocid": r.get("ocid"),
                        "documents": r.get("documents"),
                        **{k: r.get(k) for k in LISTING_FIELDS if r.get(k) is not None},
                        "company_results": results, "company_reassessed": reassessed})
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
    ap.add_argument("--sources", default="all",
                     help="'all' (default: every government source in gov_sources.py), a comma list of "
                          "gov_sources names, or 'ocds' for the old OCDS-only read")
    ap.add_argument("--no-track-changes", action="store_true",
                     help="skip tender_changes.py's listing-change tracking on this run's read")
    ap.add_argument("--no-site-categories", action="store_true",
                     help="don't read the buyer's own category from the eTenders site (a cross-reference "
                          "shown next to Tender Tool's categories; never used for the fit verdict)")
    ap.add_argument("--include-needs-review", action="store_true",
                     help="also report needs_review verdicts, not just strong_fit/possible - noisy on the "
                          "unfiltered national feed (confirmed: 72 of 74 on a real run were irrelevant "
                          "categories), use for a manual sweep, not the automated daily alert")
    ap.add_argument("--no-seed", action="store_true",
                     help="don't write the report-worthy releases to discovered_opportunities (Supabase mode "
                          "only - this is the step that actually makes them show up on /discovery; skip it "
                          "only for a dry run or when you'll seed --out separately with seed_supabase_opportunities.py)")
    ap.add_argument("--no-download-documents", action="store_true",
                     help="don't download and permanently store this run's documents to "
                          "discovered_opportunity_documents / the 'discovered-tender-documents' bucket "
                          "(migration 0071, Supabase mode only - every source except SANRAL, which stays "
                          "a human click-through). Skip only for a dry run.")
    args = ap.parse_args()

    report_worthy = REPORT_WORTHY_VERDICTS_WIDE if args.include_needs_review else REPORT_WORTHY_VERDICTS
    companies, source, client = load_companies(args.profile, not args.exclude_test_companies)
    print(f"Scoring for {len(companies)} compan{'y' if len(companies) == 1 else 'ies'} ({source}): "
          + ", ".join(c["legal_name"] or c["key"] for c in companies))
    if not companies:
        print("  No companies to score for - nothing to do.")
        return []

    today = datetime.datetime.now(sh.SAST).date()
    date_from = (today - datetime.timedelta(days=args.days)).isoformat()
    date_to = today.isoformat()
    if args.sources == "ocds":
        print(f"Fetching OCDS releases from {date_from} to {date_to}...")
        raw = etenders_national.fetch_releases(date_from, date_to)
        normalized = [etenders_national.normalize(r) for r in raw]
    else:
        # Every government source (gov_sources.py): the eTenders portal read in
        # full (the OCDS API above stops at ~300-600 releases, about a fifth of a
        # 14-day window), plus SANRAL, Eskom, Transnet and Cape Town direct.
        # --days keeps its meaning: tenders published in the last N days (a
        # listing with no publish date, e.g. SANRAL's list, is always kept).
        names = gov_sources.ALL_SOURCES if args.sources == "all" else [x.strip() for x in args.sources.split(",")]
        print(f"Reading government tender sources: {', '.join(names)}...")
        normalized, res = gov_sources.releases_for_watch(names)
        if res.get("errors"):
            # gov_sources.fetch_all() already isolates one source's own
            # failure from the rest (confirmed: a 5xx/timeout/429 there
            # degrades to a WARNING print and that source's releases are
            # simply missing from this run) - but nothing downstream of it
            # ever reads res["errors"], so a whole source silently failing
            # (or being rate-limited) was invisible outside this script's
            # own stdout. One summary alert per run, not one per source.
            failed = ", ".join(sorted(res["errors"]))
            system_alerts.record(
                "discovery",
                f"{len(res['errors'])} government source(s) failed this run and were skipped: {failed}",
                "warning", detail=str(res["errors"]))
        if not args.no_track_changes:
            # Same read, so one scheduled run covers both: what is new
            # (below) and what changed on every listing (cancellations,
            # moved closing dates, addenda listed - tender_changes.py, 0051).
            import tender_changes
            store = tender_changes.SupabaseStore(client) if client is not None else tender_changes.LocalStore()
            try:
                new_changes, _, _ = tender_changes.run(res, store)
                print(f"  Listing changes: {len(new_changes)} new (cancellations, date moves, addenda listed...)")
            except Exception as e:
                print(f"  WARNING: listing change tracking failed ({e}) - new-tender scoring continues.")
        normalized = gov_sources.published_since(normalized, date_from)
    if args.buyer:
        needle = args.buyer.lower()
        normalized = [r for r in normalized if r["buyer"] and needle in r["buyer"].lower()]
    print(f"  {len(normalized)} release(s) in range" + (f" matching buyer '{args.buyer}'" if args.buyer else ""))
    if not args.no_site_categories:
        # The buyer's own eTenders category, next to Tender Tool's own (audit
        # O1). Cross-reference only: a site outage leaves it null, nothing else.
        # A release read from the portal (gov_sources / etenders_portal)
        # already carries it; the portal list is fetched separately only for
        # eTenders releases that don't (an OCDS-only run).
        missing = [r for r in normalized if not r.get("etenders_category") and etenders_national.site_id_of(r.get("ocid"))]
        if missing:
            site, _ = etenders_national.fetch_site_categories()
            etenders_national.attach_site_categories(missing, site)
        n = sum(1 for r in normalized if r.get("etenders_category"))
        print(f"  {n} of {len(normalized)} release(s) carry the buyer's own eTenders category")

    new_releases = run(normalized, companies, report_worthy, client, args.seen_store, today)

    worthy = [r for r in new_releases if r["company_results"]]
    print(f"\n{len(worthy)} new, report-worthy release(s) for at least one company "
          f"(verdict in {sorted(report_worthy)}):")
    for r in worthy:
        docs = ", ".join(d["url"] for d in (r.get("documents") or []) if d.get("url")) or "(no document URL on file)"
        print(f"  {r.get('contract_number'):>14}  {r.get('buyer')}  -  {r.get('title')}")
        for c in r["company_results"]:
            again = {"profile_changed": f"  (re-scored: its profile changed since; was {c.get('previous_verdict')})",
                     "retry_after_error": "  (re-scored: the last scoring failed)"}.get(c.get("rescored"), "")
            if discovery_downgrades.is_downgrade(c.get("previous_verdict"), c["verdict"]):
                again += "  DOWNGRADE - flagged on its Discovery card"
            print(f"      {c['verdict']:<14} {c['legal_name']}{again}")
        print(f"      closes {r.get('closing_date')}  |  {docs}")

    downgrades = [(r, c) for r in new_releases for c in r.get("company_reassessed") or []
                  if discovery_downgrades.is_downgrade(c.get("previous_verdict"), c["verdict"])]
    if downgrades:
        print(f"\n{len(downgrades)} re-assessment(s) now WORSE than what the company was shown "
              "(flagged on its Discovery card by seed_supabase_opportunities.py, and in its next digest):")
        for r, c in downgrades:
            print(f"  {r.get('contract_number'):>14}  {c['legal_name']}: was {c['previous_verdict']}, now {c['verdict']}"
                  f"  ({c['rescored']})")

    if args.out:
        with open(args.out, "w") as f:
            json.dump(new_releases, f, indent=2)
        print(f"\nWrote {args.out}")

    if client is not None and not args.no_seed:
        # This is the step that actually puts a release on /discovery - a
        # watch run that scores and reports but never calls this leaves
        # every report-worthy match sitting unseen in company_results,
        # never a discovered_opportunities row (Sarel, 2026-10-19: "why is
        # nothing being pulled into our system"). Previously a human had to
        # run seed_supabase_opportunities.py by hand against --out; doing it
        # here means a scheduled watch run alone is enough.
        written = seed_supabase_opportunities.seed(client, new_releases)
        total = sum(written.values())
        print(f"\nSeeded {total} discovered_opportunities row(s) across {len(written)} compan"
              f"{'y' if len(written) == 1 else 'ies'}: " + ", ".join(f"{k}: {v}" for k, v in written.items()))
    elif client is None and new_releases and not args.no_seed:
        print("\n(Local --profile run - no Supabase company to seed discovered_opportunities for. "
              "Run without --profile, or seed --out with seed_supabase_opportunities.py separately.)")

    if client is not None and new_releases and not args.no_download_documents:
        # Permanently downloads/stores every document on this run's discovered
        # releases (every source except SANRAL - see migration 0071 and
        # download_discovered_documents.py's own docstring), idempotent across
        # runs. Independent of --no-seed: documents are stored even on a run
        # that skips writing discovered_opportunities, so a later --no-seed
        # re-seed from --out still finds the documents already on file.
        print("\nDownloading and storing this run's documents (discovered_opportunity_documents)...")
        doc_summary = download_discovered_documents.download_for_releases(new_releases, client)
        print(f"  {doc_summary['downloaded']} document(s) downloaded and stored, "
              f"{doc_summary['skipped_existing']} already on file, "
              f"{doc_summary['skipped_no_url']} need a human click-through (no direct URL), "
              f"{doc_summary['failed']} failed.")
    elif client is None and new_releases and not args.no_download_documents:
        print("\n(Local --profile run - no Supabase to store discovered_opportunity_documents in. "
              "Run without --profile, or download --out separately with download_discovered_documents.py.)")

    return new_releases


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # the run itself broke (feed down, database unreachable): Sarel must hear of it
        system_alerts.record("discovery", f"The new-tender watch run failed: {type(e).__name__}: {e}", "critical", exc=e)
        raise
