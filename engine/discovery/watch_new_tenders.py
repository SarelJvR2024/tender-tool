"""
Stream 5 (discovery), new-tender watch: runs the national OCDS discovery feed
(etenders_national.py), scores every release against the real company profile
(assess_tender.py), and diffs against a local "seen" store so a run only ever
reports releases it has never reported before - not the same few hundred
releases every single time this is run.

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
ocid (falling back to contract_number for the rare release with no ocid), so
a release already reported is never reported again even if its score would
change on a later run (a verdict can drift as more of the document becomes
readable, but re-notifying about something already seen defeats the point of
a "what's new" alert).

Usage:
    python3 watch_new_tenders.py [--days N] [--profile PATH] [--seen-store PATH]
        [--buyer SUBSTRING] [--out report.json]

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

DEFAULT_SEEN_STORE = os.path.join(os.path.dirname(__file__), "..", "..", "state", "seen_tenders.json")

# Verdicts worth waking Sarel up for. "closed" (already past closing) and
# "not_a_fit" (wrong discipline/no CIDB match) are scored and recorded in the
# seen store like everything else, but never reported - reporting those would
# train him to ignore the alerts.
REPORT_WORTHY_VERDICTS = {"strong_fit", "possible", "needs_review"}


def load_seen(path):
    try:
        return json.load(open(path))
    except (OSError, json.JSONDecodeError):
        return {}


def save_seen(path, seen):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(seen, f, indent=2)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=14,
                     help="how many days back to search for releases (default 14 - wide enough to "
                          "survive a missed run or two without losing anything, since the seen "
                          "store - not the date window - is what prevents duplicate reports)")
    ap.add_argument("--profile", default=None,
                     help=f"path to a company profile JSON (default: {assess_tender.DEFAULT_PROFILE_PATH})")
    ap.add_argument("--seen-store", default=DEFAULT_SEEN_STORE)
    ap.add_argument("--buyer", default=None,
                     help="case-insensitive substring filter on the buyer/organ-of-state name")
    ap.add_argument("--out", default=None, help="write the full list of newly-seen, report-worthy releases to this JSON file")
    args = ap.parse_args()

    profile = assess_tender.load_company_profile(args.profile)
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

    new_releases = []
    for r in normalized:
        key = r.get("ocid") or r.get("contract_number")
        if not key or key in seen:
            continue
        try:
            result = assess_tender.assess_release(r, profile)
        except Exception as e:
            result = {"contract_number": r.get("contract_number"), "verdict": "ERROR", "error": str(e)}
        seen[key] = {
            "first_seen": today.isoformat(),
            "contract_number": r.get("contract_number"),
            "title": r.get("title"),
            "verdict": result.get("verdict"),
        }
        if result.get("verdict") in REPORT_WORTHY_VERDICTS:
            new_releases.append({**result, "ocid": r.get("ocid"), "documents": r.get("documents")})

    save_seen(args.seen_store, seen)

    print(f"\n{len(new_releases)} new, report-worthy release(s) (never seen before, "
          f"verdict in {sorted(REPORT_WORTHY_VERDICTS)}):")
    for r in new_releases:
        docs = ", ".join(d["url"] for d in (r.get("documents") or []) if d.get("url")) or "(no document URL on file)"
        print(f"  {r.get('contract_number'):>14}  {r['verdict']:<14}  {r.get('buyer')}  -  {r.get('title')}")
        print(f"      closes {r.get('closing_date')}  |  {docs}")

    if args.out:
        with open(args.out, "w") as f:
            json.dump(new_releases, f, indent=2)
        print(f"\nWrote {args.out}")

    return new_releases


if __name__ == "__main__":
    main()
