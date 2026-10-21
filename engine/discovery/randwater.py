"""
Discovery, direct buyer reader: Rand Water's own bids portal
(bids.randwater.co.za), the "ALL BIDS" listing page.

Flagged for a possible reader by the government-coverage research
(Marketing-Pricing-Strategy.md section 11.3: "Rand Water, PRASA ... Not
reachable from this environment ... Re-check from another network"). Sarel
reached it fine from his own browser (2026-10-20) and shared the real page
source of https://bids.randwater.co.za/Public/Procurement/Bids/
ViewPublishedBids.aspx, which this module is built against.

IMPORTANT, confirmed this same session: three separate automated fetch
attempts (this sandbox's curl, this sandbox's WebFetch tool, and the
original research pass's own environment) were all refused - a TLS chain
error from curl, HTTP 503 from WebFetch and from the research pass. A real
browser works. This is the same pattern section 11.5 found for Engineering
News (403) and News24 (Cloudflare challenge) - automated-traffic blocking,
not a flaky server. **This module has never been run against the live
site** - everything below is verified only against the real saved page
source, offline (test_randwater.py). Whether a scheduled run (e.g. from a
GitHub Actions runner) can reach this site at all is unconfirmed and may
simply fail the same way. Do not assume it works in production because it
parses correctly here.

Page structure (confirmed from the real page source, 2026-10-20): the bid
list is rendered directly in the HTML response of ViewPublishedBids.aspx -
a DevExpress ASPxNewsControl (no separate API/AJAX call; confirmed from the
same page's own captured Network panel: 14 requests, zero XHR/Fetch). Each
bid is one <table class="dxhlControl_Office365"> block holding its
reference (dxhlHeader_Office365), "CLOSING DATE: <date>" (dxhlDate_Office365)
and title (dxhlContent_Office365). The control's own init script carries
'pageCount':N - only page 1 is ever read here; if a future "ALL BIDS" page
ever needs a 2nd page, that's a DevExpress AJAX callback
(WebForm_DoCallback), not a plain GET, and NOT implemented - parse_bids()
raises rather than silently dropping bids off any page past the first.

Per-bid detail (documents, full description) is a DevExpress popup loaded
by the same AJAX-callback mechanism, triggered by the page's own
ASPx.HLTClick JS handler - not a plain URL. Reproducing that blind, without
ever being able to test it live, is a different and much riskier job than
reading the listing; deliberately not attempted here. This reader gives the
same shape of value Discovery already gets from every other direct-site
source before its own detail/document reading was added (reference, title,
closing date) - real, but partial.

Usage:
    python3 randwater.py [--out FILE.json]
"""
import argparse
import html
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402

SOURCE = "randwater"
LIST_URL = "https://bids.randwater.co.za/Public/Procurement/Bids/ViewPublishedBids.aspx"
BUYER = "Rand Water"

BID_BLOCK = re.compile(
    r'dxhlHeader_Office365[^>]*>\s*(.*?)\s*</div>.*?'
    r'dxhlDate_Office365[^>]*>\s*CLOSING DATE:\s*(.*?)\s*</div>.*?'
    r'dxhlContent_Office365[^>]*>\s*(.*?)\s*</div>',
    re.S,
)
PAGE_COUNT = re.compile(r"'pageCount'\s*:\s*(\d+)")


def _text(fragment):
    return sh.clean(html.unescape(re.sub(r"<[^>]+>", " ", fragment or "")))


def parse_bids(page):
    """[(reference, closing_date_text, title)] for every bid on page 1 of
    the "ALL BIDS" listing. Raises if the page's own script says there's
    more than one page - see this module's own docstring for why a 2nd
    page isn't read rather than silently dropping those bids."""
    m = PAGE_COUNT.search(page)
    if m and int(m.group(1)) > 1:
        raise RuntimeError(
            f"randwater: ALL BIDS now has {m.group(1)} pages, not 1 - "
            "this reader only ever reads page 1 (see module docstring: "
            "page 2+ needs a DevExpress AJAX callback, not implemented). "
            "Fix before trusting this run's results."
        )
    out = []
    for ref, closing, title in BID_BLOCK.findall(page):
        ref, closing, title = _text(ref), _text(closing), _text(title)
        if not ref:
            continue
        out.append((ref, closing, title))
    return out


def normalize(ref, closing, title):
    return sh.release(
        ocid=f"randwater:{ref}",
        contract_number=ref, title=title, description=title, buyer=BUYER,
        closing_date=sh.iso_sast(closing),
        # Per-bid documents sit behind a DevExpress AJAX popup, not read here
        # - see this module's own docstring.
        documents=[],
        source=SOURCE, source_id=ref, source_url=LIST_URL,
        status="advertised", tender_type="RFQ",
    )


def fetch_releases(log=print):
    page = sh.http_get(LIST_URL, timeout=120).decode("utf-8", errors="replace")
    rels = [normalize(*row) for row in parse_bids(page)]
    log(f"  Rand Water bids portal: {len(rels)} open bids")
    return rels


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    rows = fetch_releases()
    for r in rows[:15]:
        print(f"  {r['contract_number']:>12}  closes {r['closing_date']}  -  {(r['title'] or '')[:60]}")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(rows, f, indent=2)
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
