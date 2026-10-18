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

The buyer's own category (audit O1, Sarel 2026-10-17). OCDS carries only
goods / services / works. The eTenders website's own table data
(Home/PaginatedTenderOpportunities, the JSON its public Opportunities page
loads - also unauthenticated, no CAPTCHA) carries the buyer's pick from the
site's 91-entry Category dropdown. fetch_site_categories() reads it once per
run and attach_site_categories() joins it on the ocid's numeric suffix (the
site's tender id). It is stored and shown as a CROSS-CHECK on Tender Tool's
own taxonomy (taxonomy.Taxonomy.etenders_crosscheck), never instead of it:
the buyers' own categories are too coarse to sort by (29% of live tenders sit
in three catch-all buckets - Discipline-Taxonomy-Findings.md §1.1). Only the
category is kept; the site rows' contact names and e-mails are dropped.

Usage:
    python3 etenders_national.py --days 14 [--buyer "SANRAL"] [--out report.json] [--no-site-categories]
"""
import sys
import json
import time
import argparse
import datetime
import urllib.parse
import urllib.request
import urllib.error

API_BASE = "https://ocds-api.etenders.gov.za/api/OCDSReleases"
# The public eTenders site's own table data (the JSON behind
# Home/opportunities) - read ONLY for each tender's "category", the buyer's
# own pick from the site's 91-entry Category dropdown, which the OCDS API does
# not carry (audit O1, Sarel 2026-10-17: read it as a cross-reference
# alongside Tender Tool's own categories). Public, unauthenticated, the same
# request the site's table makes; one paginated pass per Discovery run.
SITE_OPPORTUNITIES = "https://www.etenders.gov.za/Home/PaginatedTenderOpportunities"
SITE_PAGE_SIZE = 500
SITE_MAX_PAGES = 20  # 10 000 tenders - the site advertised 2 211 on 2026-10-17
OCID_PREFIX = "ocds-9t57fa-"  # National Treasury's OCDS publisher prefix
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


def dedupe_releases(raw):
    """OCDS paging has a confirmed real quirk: the same release (identical
    release `id`) sometimes turns up twice, usually straddling a page
    boundary. Keeps the first occurrence of each release id; a release with
    no `id` at all (seen on a handful of older records) falls back to its
    ocid instead of being dropped outright. Returns (deduped, dupes_removed)."""
    seen = set()
    out = []
    dupes = 0
    for r in raw:
        key = r.get("id") or r.get("ocid")
        if key is not None and key in seen:
            dupes += 1
            continue
        if key is not None:
            seen.add(key)
        out.append(r)
    return out, dupes


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
    deduped, dupes = dedupe_releases(all_releases)
    if dupes:
        print(f"  removed {dupes} duplicate release(s) (same release id seen twice)")
    return deduped


def site_id_of(ocid):
    """The eTenders site's tender id for an OCDS release: the ocid's numeric
    suffix (ocds-9t57fa-174436 -> "174436"; confirmed 2026-10-17 by joining
    the site's rows to OCDS releases). None for any other shape."""
    if ocid and ocid.startswith(OCID_PREFIX) and ocid[len(OCID_PREFIX):].isdigit():
        return ocid[len(OCID_PREFIX):]
    return None


def fetch_site_page(start, length, status=1, timeout=90):
    q = urllib.parse.urlencode({"draw": 1, "start": start, "length": length, "status": status})
    req = urllib.request.Request(f"{SITE_OPPORTUNITIES}?{q}", headers={
        "User-Agent": "TenderTool-Discovery/1.0 (category cross-reference; one pass per run)",
        "X-Requested-With": "XMLHttpRequest", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def fetch_site_categories(status=1, page_size=SITE_PAGE_SIZE, max_pages=SITE_MAX_PAGES, fetch_page=None, log=print):
    """{site tender id: {"category", "category_id"}} for every tender the
    site currently lists (status 1 = advertised). Only the category is kept -
    the rows also carry contact names and e-mail addresses, which Tender Tool
    has no use for here. A page that fails is retried once and then skipped:
    this is cross-reference data, so a site outage never stops Discovery
    (the releases just carry no site category, and the run says so).
    Returns (categories, note)."""
    fetch_page = fetch_page or fetch_site_page
    out, failed, total = {}, [], None
    for page in range(max_pages):
        start = page * page_size
        data = None
        for attempt in range(2):
            try:
                data = fetch_page(start, page_size, status)
                break
            except Exception as e:  # noqa: BLE001 - any failure: retry once, then skip the page
                err = e
                time.sleep(2 * (attempt + 1))
        if data is None:
            failed.append(f"rows {start}-{start + page_size - 1}: {err}")
            if total is not None and start + page_size >= total:
                break
            continue
        total = data.get("recordsTotal", total)
        rows = data.get("data") or []
        for r in rows:
            if r.get("id") is not None and r.get("category"):
                out[str(r["id"])] = {"category": r["category"].strip(), "category_id": r.get("categoriesID")}
        if len(rows) < page_size or (total is not None and start + page_size >= total):
            break
    note = f"{len(out)} tender categories read from the eTenders site"
    if total is not None:
        note += f" (site lists {total})"
    if failed:
        note += f"; {len(failed)} page(s) failed: " + "; ".join(failed)[:300]
    log(f"  eTenders site categories: {note}")
    return out, note


def attach_site_categories(releases, site_categories):
    """Sets etenders_category / etenders_category_id on each normalised
    release whose site id is in the map; None otherwise (not read - never
    guessed). Returns how many matched."""
    n = 0
    for r in releases:
        sc = site_categories.get(site_id_of(r.get("ocid")) or "")
        r["etenders_category"] = sc["category"] if sc else None
        r["etenders_category_id"] = sc.get("category_id") if sc else None
        n += bool(sc)
    return n


def normalize(release):
    tender = release.get("tender", {}) or {}
    buyer = release.get("buyer", {}) or {}
    period = tender.get("tenderPeriod", {}) or {}
    docs = tender.get("documents", []) or []
    closing_date = period.get("endDate")
    now = datetime.datetime.now().isoformat()
    # On the live API tender.id is the eTenders portal's internal number
    # (e.g. "174382"), tender.title is the buyer's bid number (e.g.
    # "RFX6000003683") and tender.description is the actual title - checked
    # against the portal's own tender_No/description for the same ids
    # (Award-Outcomes-Findings.md "side finding"; fixed 2026-10-17 with
    # etenders_portal.py). So contract_number is the bid number, title the
    # description, and the portal id is kept as portal_id.
    bid_number = tender.get("title")
    return {
        "ocid": release.get("ocid"),
        "contract_number": bid_number or tender.get("id"),
        "portal_id": tender.get("id"),
        "title": tender.get("description") or bid_number,
        "description": tender.get("description"),
        "buyer": buyer.get("name"),
        "procurement_category": tender.get("mainProcurementCategory"),
        "closing_date": closing_date,
        "opening_date": period.get("startDate"),
        # True only when we have a closing date and it has passed - no closing
        # date on file is NOT treated as closed (it's unknown, not expired).
        "is_closed": bool(closing_date and closing_date <= now),
        "documents": [{"title": d.get("title"), "url": d.get("url")} for d in docs],
        "awards": release.get("awards", []),
        "contracts": release.get("contracts", []),
        "has_award_data": bool(release.get("awards")),
        # the buyer's own eTenders site category - filled by
        # attach_site_categories() (a separate read of the site), else None
        "etenders_category": None,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=14,
                     help="how many days back from today to search (default 14)")
    ap.add_argument("--buyer", default=None,
                     help="case-insensitive substring filter on the buyer/organ-of-state name")
    ap.add_argument("--out", default=None, help="write the full normalized report to this JSON file")
    ap.add_argument("--no-site-categories", action="store_true",
                    help="don't read the eTenders site's own category for each tender (cross-reference only)")
    args = ap.parse_args()

    today = datetime.date.today()
    date_from = (today - datetime.timedelta(days=args.days)).isoformat()
    date_to = today.isoformat()

    print(f"Fetching OCDS releases from {date_from} to {date_to}...")
    raw = fetch_releases(date_from, date_to)
    print(f"  {len(raw)} releases fetched")

    normalized = [normalize(r) for r in raw]
    if not args.no_site_categories:
        site, _ = fetch_site_categories()
        print(f"  {attach_site_categories(normalized, site)} of {len(normalized)} releases matched a site category")
    if args.buyer:
        needle = args.buyer.lower()
        normalized = [r for r in normalized if r["buyer"] and needle in r["buyer"].lower()]
        print(f"  {len(normalized)} match buyer filter '{args.buyer}'")

    open_now = [r for r in normalized if r["closing_date"] and not r["is_closed"]]
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
