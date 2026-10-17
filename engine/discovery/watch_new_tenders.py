"""
Stream 5 (discovery), new-tender watch: runs the national OCDS discovery feed
(etenders_national.py), scores every release against EVERY company in the
system - each from its own profile (company_profiles.py: that company's own
Experience Library disciplines, CIDB grading, B-BBEE and offices) - and diffs
against a local "seen" store so a run only ever reports, per company,
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

The "seen" store (state/seen_tenders.json, gitignored - this is per-deployment
state, not code) tracks every release this script has ever scored, keyed by
ocid (falling back to contract_number for the rare release with no ocid), and
under it which companies it has been scored for ("companies": {company key:
verdict}). A company added later is scored on the releases still in the
window; a company already scored on a release is never re-notified about it,
even if its score would
change on a later run (a verdict can drift as more of the document becomes
readable, but re-notifying about something already seen defeats the point of
a "what's new" alert).

Usage:
    python3 watch_new_tenders.py [--days N] [--seen-store PATH] [--buyer SUBSTRING]
        [--out report.json] [--include-test-companies]
        (every company, read from Supabase: NEXT_PUBLIC_SUPABASE_URL +
        SUPABASE_SERVICE_ROLE_KEY)
    python3 watch_new_tenders.py --profile a.json --profile b.json ...
        (local run without Supabase: exactly the companies these files name)
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


RELEASE_FIELDS = ("contract_number", "buyer", "title", "description", "closing_date", "categories",
                  "document_depth", "signals", "confidence_note")


def fan_out(releases, companies, seen, report_worthy, today=None, fetch_document=True, fetch_text=None):
    """Scores each release once per company not yet scored on it. Returns the
    new, report-worthy releases: release-level facts (the same for every
    company) plus `company_results`, one entry per company whose OWN verdict is
    report-worthy - {company_id, legal_name, company_key, verdict, reasons,
    score_outlook}. Mutates `seen`. A seen-store entry written before the
    fan-out (no "companies" key) was scored against one shared profile file,
    not any company's own rows, so it is scored again for every company."""
    today = (today or datetime.date.today()).isoformat()
    out = []
    for r in releases:
        key = r.get("ocid") or r.get("contract_number")
        if not key:
            continue
        entry = seen.get(key)
        if not entry or not isinstance(entry.get("companies"), dict):
            entry = {"first_seen": (entry or {}).get("first_seen") or today,
                     "contract_number": r.get("contract_number"), "title": r.get("title"), "companies": {}}
            seen[key] = entry
        pending = [c for c in companies if c["key"] not in entry["companies"]]
        if not pending:
            continue
        try:
            reading = assess_tender.read_release(r, fetch_document=fetch_document, fetch_text=fetch_text)
        except Exception as e:
            reading, read_error = None, str(e)
        results, base = [], None
        for c in pending:
            try:
                if reading is None:
                    raise RuntimeError(read_error)
                res = assess_tender.score_release(r, reading, c["profile"])
            except Exception as e:
                res = {"contract_number": r.get("contract_number"), "verdict": "ERROR", "error": str(e)}
            entry["companies"][c["key"]] = res.get("verdict")
            base = base or (res if res.get("verdict") != "ERROR" else None)
            if res.get("verdict") in report_worthy:
                results.append({"company_id": c["company_id"], "legal_name": c["legal_name"], "company_key": c["key"],
                                "verdict": res["verdict"], "reasons": res.get("reasons") or [],
                                "score_outlook": res.get("score_outlook")})
        if results:
            out.append({**{k: base.get(k) for k in RELEASE_FIELDS}, "ocid": r.get("ocid"),
                        "documents": r.get("documents"), "company_results": results})
    return out


def load_companies(profile_paths=None, include_test_companies=False, client=None):
    """--profile files if given, else every company in Supabase. Never a
    default sample profile."""
    if profile_paths:
        return company_profiles.profiles_from_files(profile_paths), "profile files"
    client = client or company_profiles.RestClient.from_env()
    if client is None:
        raise SystemExit("ERROR: no companies to score for. Set NEXT_PUBLIC_SUPABASE_URL and "
                         "SUPABASE_SERVICE_ROLE_KEY (every company in the system is scored from its own rows), "
                         "or pass --profile for a local run. There is deliberately no default company profile.")
    return company_profiles.all_company_profiles(client, include_test_companies), "Supabase"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=14,
                     help="how many days back to search for releases (default 14 - wide enough to "
                          "survive a missed run or two without losing anything, since the seen "
                          "store - not the date window - is what prevents duplicate reports)")
    ap.add_argument("--profile", action="append", default=None,
                     help="a company profile JSON to score for (repeatable) - a local run without Supabase. "
                          "Without it, every company in Supabase is scored from its own rows.")
    ap.add_argument("--include-test-companies", action="store_true",
                     help="also score companies flagged is_test_company (Supabase mode)")
    ap.add_argument("--seen-store", default=DEFAULT_SEEN_STORE)
    ap.add_argument("--buyer", default=None,
                     help="case-insensitive substring filter on the buyer/organ-of-state name")
    ap.add_argument("--out", default=None, help="write the full list of newly-seen, report-worthy releases to this JSON file")
    ap.add_argument("--include-needs-review", action="store_true",
                     help="also report needs_review verdicts, not just strong_fit/possible - noisy on the "
                          "unfiltered national feed (confirmed: 72 of 74 on a real run were irrelevant "
                          "categories), use for a manual sweep, not the automated daily alert")
    args = ap.parse_args()

    report_worthy = REPORT_WORTHY_VERDICTS_WIDE if args.include_needs_review else REPORT_WORTHY_VERDICTS
    companies, source = load_companies(args.profile, args.include_test_companies)
    print(f"Scoring for {len(companies)} compan{'y' if len(companies) == 1 else 'ies'} ({source}): "
          + ", ".join(c["legal_name"] or c["key"] for c in companies))
    if not companies:
        print("  No companies to score for - nothing to do.")
        return []
    seen = load_seen(args.seen_store)

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

    new_releases = fan_out(normalized, companies, seen, report_worthy, today)
    save_seen(args.seen_store, seen)

    print(f"\n{len(new_releases)} new, report-worthy release(s) for at least one company "
          f"(verdict in {sorted(report_worthy)}):")
    for r in new_releases:
        docs = ", ".join(d["url"] for d in (r.get("documents") or []) if d.get("url")) or "(no document URL on file)"
        print(f"  {r.get('contract_number'):>14}  {r.get('buyer')}  -  {r.get('title')}")
        for c in r["company_results"]:
            print(f"      {c['verdict']:<14} {c['legal_name']}")
        print(f"      closes {r.get('closing_date')}  |  {docs}")

    if args.out:
        with open(args.out, "w") as f:
            json.dump(new_releases, f, indent=2)
        print(f"\nWrote {args.out}")

    return new_releases


if __name__ == "__main__":
    main()
