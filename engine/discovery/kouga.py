"""
Discovery, direct buyer reader: Kouga Local Municipality's own open-tenders
listing (kouga.gov.za/tenders/status/open).

Flagged by this round's catalog research
(docs/specs/Government-Buyer-Catalog-Round4-Final-Sweep.md) as high-volume
but with a high overlap rate on a small first-page sample - checked further
this session (2026-10-21): of the 10 tenders on page 1 alone, only 3
(231/2026, 247/2026, 225/2026) are on eTenders under "kouga" as a buyer -
`etenders_portal.py --buyer "kouga"` returns only 4 rows total, period,
against an own-site "open" listing that runs to 28 pages (confirmed from
the page's own "last page" pagination link, not guessed) - the earlier
"high overlap" read was really "the 3 that DO overlap happen to also be
the 3 most recent", not a high fraction of the real total.

Page structure, confirmed from the real page source: `/tenders` (and the
equivalent `/tenders/status/open`) is server-rendered (no JS needed, unlike
its own `/tenders` landing page without a status, which IS a JS shell -
the `/status/open` and bare `/page/N` paths are the real listing). Each
tender is one `<a class="box">` card: title, "Ref No:", "Start Date:",
"Closing Date:" (day-month-abbreviation-year, e.g. "20 Oct 2026" -
source_http.parse_sast's existing DMY format already handles this, no new
date format needed). 10 cards per page. Includes real cancellation/erratum
notices alongside ordinary tenders (kept, not filtered - the title says
what it is).

Usage:
    python3 kouga.py [--out FILE.json] [--max-pages N]
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402

SOURCE = "kouga"
BASE_URL = "https://www.kouga.gov.za"
LIST_URL = BASE_URL + "/tenders/status/open"
BUYER = "Kouga Local Municipality"

# A hard ceiling, not the expected count (confirmed 28 real pages, 2026-10-21)
# - just a safety cap so a pagination-parsing bug can never turn into an
# unbounded fetch loop against a real buyer's site.
MAX_PAGES_CAP = 60

CARD_RE = re.compile(
    r'<a href="([^"]+)" title="View tender[^"]*" class="box">.*?'
    r'<h3>([^<]*)</h3>.*?'
    r'Ref No:</strong>([^<]*)</div>.*?'
    r'Start Date:</strong>([^<]*)</div>.*?'
    r'Closing Date:</strong>([^<]*)</div>',
    re.S)
PAGE_LINK_RE = re.compile(r"/tenders/page/(\d+)")


def parse_cards(html):
    return [(url, sh.clean(title), sh.clean(ref), sh.clean(start), sh.clean(closing))
            for url, title, ref, start, closing in CARD_RE.findall(html)]


def max_page(html):
    """The real last-page number from the page's own ">|' jump-to-last
    pagination link - never hardcoded, never guessed."""
    nums = [int(n) for n in PAGE_LINK_RE.findall(html)]
    return max(nums) if nums else 1


def normalize(url, title, ref, start, closing):
    return sh.release(
        ocid=f"kouga:{ref}",
        contract_number=ref, title=title, description=title, buyer=BUYER,
        closing_date=sh.iso_sast(closing),
        published_date=sh.iso_sast(start),
        documents=[],  # the listing card has no document link - only the detail page would, not fetched here
        source=SOURCE, source_id=ref, source_url=url,
        status="advertised", tender_type="Tender",
    )


def fetch_releases(max_pages=None, log=print):
    page1 = sh.http_get(LIST_URL, timeout=90).decode("utf-8", errors="replace")
    cards = parse_cards(page1)
    if not cards:
        raise RuntimeError(
            "kouga: 0 tender cards parsed from a 200 response on page 1 - the listing page's own "
            "markup has likely changed. Fix the parser before trusting an empty result as 'no open tenders'."
        )
    last = max_page(page1)
    if last > MAX_PAGES_CAP:
        raise RuntimeError(
            f"kouga: page 1's own pagination names page {last} as the last one - past this reader's "
            f"safety cap of {MAX_PAGES_CAP}. Confirm that's real before raising the cap (a parsing bug "
            "reading some unrelated number as a page link would look exactly like this)."
        )
    if max_pages:
        last = min(last, max_pages)
    rels = [normalize(*c) for c in cards]
    for p in range(2, last + 1):
        html = sh.http_get(f"{LIST_URL}/page/{p}", timeout=90).decode("utf-8", errors="replace")
        page_cards = parse_cards(html)
        if not page_cards:
            log(f"  WARNING: kouga page {p} of {last} had 0 cards - stopping early rather than guessing further")
            break
        rels.extend(normalize(*c) for c in page_cards)
    log(f"  Kouga Local Municipality: {len(rels)} open tenders from {last} page(s)")
    return rels


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=None)
    ap.add_argument("--max-pages", type=int, default=None)
    args = ap.parse_args()
    rows = fetch_releases(max_pages=args.max_pages)
    for r in rows[:25]:
        print(f"  {r['contract_number']:<10} closes {r['closing_date']}  -  {(r['title'] or '')[:70]}")
    if len(rows) > 25:
        print(f"  ... and {len(rows) - 25} more")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(rows, f, indent=2)
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
