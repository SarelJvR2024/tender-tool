"""
Stream 5 (discovery), national layer: pulls open-contracting data straight from
National Treasury's own public OCDS API - not a scrape, not a browser, not
anything that touches a reCAPTCHA. This is a completely different situation
from SANRAL's own site (see download_documents.py's module docstring for that
investigation): a government open-data API, published under the Open Data
Commons PDDL license (public-domain-equivalent, confirmed 2026-10-16 from the
API's own response body - every response names it:
https://opendatacommons.org/licenses/pddl/1-0/111), with no robots.txt entry,
no terms-of-use page found anywhere on etenders.gov.za, and no auth required.
Built for exactly this kind of machine consumption - OCDS (Open Contracting
Data Standard) exists specifically so third parties can build on procurement
data without asking permission release by release.

Confirmed live against the real API 2026-10-16, not assumed from documentation
(none was found - no swagger.json/swagger/v1/swagger.json resolved):
  GET https://ocds-api.etenders.gov.za/api/OCDSReleases
      ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD   (both required - confirmed by the
                                                 API's own 400 error body:
                                                 "dateFrom and dateTo fields are
                                                 required.")
      &PageNumber=N&PageSize=N                  (optional, default page 1/100;
                                                 response echoes a "links.next"
                                                 URL for the next page, no total
                                                 count given)

Two real data-quality limits, confirmed by direct testing, not assumed from the
Open Cities Lab research the spec doc already cites:
  - tender.status is an empty string on every release sampled (400 releases
    checked across Jan-Oct 2026) - there is no reliable "is this open vs
    closed vs awarded" flag in this field. Filter on tenderPeriod.endDate
    against today's date instead.
  - releases[].awards and releases[].contracts were empty on every release
    sampled across both a recent window (Jul-Oct 2026, 400 releases) and an
    older one (Jan-Jun 2024, 100 releases, though that query also returned
    intermittent HTTP 500s - the API appears less reliable for older date
    ranges). Award/price data is NOT something this module can promise to
    surface reliably yet - it reports whatever award/contract data a release
    actually carries, but "who won and at what price" will come up empty for
    the overwhelming majority of releases. This matches, rather than
    contradicts, the spec doc's own citation of the 2019/2020 Open Cities Lab
    finding that award-stage fields are rarely completed.

This module does NOT replace engine/discovery/run_discovery.py (SANRAL's own
site, which remains the authoritative source for SANRAL's own tenders and the
only source for the actual tender *documents* - this API's "documents" field
only ever points back to the same organ of state's own download links, which
still need a human to fetch for anything reCAPTCHA-gated, same as before). It
widens discovery to every organ of state that publishes through National
Treasury's portal - provincial departments, municipalities, SOEs - which
SANRAL's own site was never going to cover.

Usage:
    python3 etenders_national.py --days 14 [--buyer "SANRAL"] [--out report.json]
"""
import sys
import json
import time
import argparse
import datetime
import urllib.request
import urllib.error

API_BASE = "https://ocds-api.etenders.gov.za/api/OCDSReleases"
PAGE_SIZE = 100
MAX_PAGES = 200  # hard stop so a bug can't loop forever against a live government API


def fetch_page(date_from, date_to, page, retries=3, backoff=2.0):
    url = f"{API_BASE}?dateFrom={date_from}&dateTo={date_to}&PageNumber={page}&PageSize={PAGE_SIZE}"
    last_err = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.load(r)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last_err = e
            time.sleep(backoff * (attempt + 1))
    raise RuntimeError(f"Failed to fetch page {page} after {retries} attempts: {last_err}")


def fetch_releases(date_from, date_to, max_pages=MAX_PAGES):
    """Pages through the API for one date window. Confirmed live 2026-10-16: the
    API itself breaks with HTTP 500 around page 5-6 (roughly 500-600 records in),
    regardless of date range - reproduced on both a recent window and an older
    one (2024 H1), so this is a real upstream limitation, not a transient blip
    or something caused by this client. Stops cleanly and returns whatever was
    fetched rather than crashing the whole discovery run over it - a narrower
    date window (fewer total releases) avoids hitting the wall at all."""
    all_releases = []
    for page in range(1, max_pages + 1):
        try:
            data = fetch_page(date_from, date_to, page)
        except RuntimeError as e:
            print(f"  WARNING: stopped at page {page} ({e}) - "
                  f"keeping the {len(all_releases)} releases already fetched. "
                  f"Try a narrower --days window to get the rest.")
            break
        releases = data.get("releases", [])
        if not releases:
            break
        all_releases.extend(releases)
        if not data.get("links", {}).get("next"):
            break
    return all_releases


def normalize(release):
    tender = release.get("tender", {}) or {}
    buyer = release.get("buyer", {}) or {}
    period = tender.get("tenderPeriod", {}) or {}
    docs = tender.get("documents", []) or []
    return {
        "ocid": release.get("ocid"),
        "contract_number": tender.get("id"),
        "title": tender.get("title"),
        "description": tender.get("description"),
        "buyer": buyer.get("name"),
        "procurement_category": tender.get("mainProcurementCategory"),
        "closing_date": period.get("endDate"),
        "opening_date": period.get("startDate"),
        "documents": [{"title": d.get("title"), "url": d.get("url")} for d in docs],
        "awards": release.get("awards", []),
        "contracts": release.get("contracts", []),
        "has_award_data": bool(release.get("awards")),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=14,
                     help="how many days back from today to search (default 14)")
    ap.add_argument("--buyer", default=None,
                     help="case-insensitive substring filter on the buyer/organ-of-state name")
    ap.add_argument("--out", default=None, help="write the full normalized report to this JSON file")
    args = ap.parse_args()

    today = datetime.date.today()
    date_from = (today - datetime.timedelta(days=args.days)).isoformat()
    date_to = today.isoformat()

    print(f"Fetching OCDS releases from {date_from} to {date_to}...")
    raw = fetch_releases(date_from, date_to)
    print(f"  {len(raw)} releases fetched")

    normalized = [normalize(r) for r in raw]
    if args.buyer:
        needle = args.buyer.lower()
        normalized = [r for r in normalized if r["buyer"] and needle in r["buyer"].lower()]
        print(f"  {len(normalized)} match buyer filter '{args.buyer}'")

    open_now = [r for r in normalized
                if r["closing_date"] and r["closing_date"] > datetime.datetime.now().isoformat()]
    with_awards = [r for r in normalized if r["has_award_data"]]

    print(f"\nStill open (closing date in the future): {len(open_now)}")
    print(f"Carrying actual award/price data: {len(with_awards)} "
          f"(expected to be rare - see module docstring)")
    for r in open_now[:20]:
        print(f"  {r['contract_number']:>14}  closes {r['closing_date']}  "
              f"{r['buyer']}  -  {r['title']}")

    if args.out:
        report = {
            "generated_at": datetime.datetime.now().isoformat(),
            "date_from": date_from, "date_to": date_to,
            "buyer_filter": args.buyer,
            "total_releases": len(normalized),
            "open_now_count": len(open_now),
            "with_award_data_count": len(with_awards),
            "releases": normalized,
        }
        with open(args.out, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\nWrote {args.out}")


if __name__ == "__main__":
    main()
