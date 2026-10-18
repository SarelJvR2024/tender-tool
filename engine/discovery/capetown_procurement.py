"""
Discovery, direct buyer reader: City of Cape Town's own Procurement Portal
(web1.capetown.gov.za/web1/procurementportal) - its open RFQs and its RFQ
award notices.

The City's formal tenders go to the eTenders portal (44 open "City of Cape
Town" rows on 17 Oct 2026) and reach Discovery that way. Its requests for
quotation don't: on 17 Oct 2026 the City's own portal listed 246 open RFQs
(posted that day and the days before, closing within about two weeks), none
of them on eTenders. They are small, fast procurement (protective clothing,
tools, plumbing and electrical supplies, minor services) - the kind of
government work a lead service lists and a free feed misses.

Award notices: /Award/ViewAwards lists the City's recent RFQ awards
(reference, title, category, status, award date) and each detail page names
the supplier awarded ("GH12700188 ... To: ALWAYS SUPERLATIVE"). No amount is
published there. award_outcomes.py reads these (--source capetown).

Access: the public "RFQ" and "Awards" pages render their tables in the page
HTML (no API, no login - registering is only needed to quote). No CAPTCHA.
robots.txt 404. Nothing personal is on the list pages.

Usage:
    python3 capetown_procurement.py [--awards] [--out FILE.json]
"""
import argparse
import html
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402

SOURCE = "capetown_procurement"
BASE = "https://web1.capetown.gov.za/web1/procurementportal"
RFQ_URL = BASE + "/RFQ"
AWARDS_URL = BASE + "/Award/ViewAwards"
BUYER = "City of Cape Town"

ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
CELL = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S)
DETAIL = re.compile(r"href=\"(/web1/procurementportal/(?:RFQ|Award)/Details/(\d+))\"")


def _text(fragment):
    return sh.clean(html.unescape(re.sub(r"<[^>]+>", " ", fragment or "")))


def parse_table(page):
    """[(cells, detail_path, detail_id)] for every data row of the page's table."""
    out = []
    for row in ROW.findall(page):
        cells = [_text(c) for c in CELL.findall(row)]
        if not cells or cells[0] in (None, "Reference Number"):
            continue
        m = DETAIL.search(row)
        out.append((cells, m.group(1) if m else None, m.group(2) if m else None))
    return out


def normalize_rfq(cells, path, detail_id):
    # Reference Number | Title | Category | Closing Date | Closing (sortable) | Posted | Posted (sortable)
    ref, title, category = cells[0], cells[1], cells[2]
    closing = cells[4] if len(cells) > 4 and cells[4] else cells[3]
    posted = cells[6] if len(cells) > 6 and cells[6] else (cells[5] if len(cells) > 5 else None)
    url = f"https://web1.capetown.gov.za{path}" if path else RFQ_URL
    return sh.release(
        ocid=f"capetown-rfq:{detail_id or ref}",
        contract_number=ref, title=title, description=title, buyer=BUYER,
        procurement_category=category,
        closing_date=sh.iso_sast(closing), opening_date=sh.iso_sast(posted),
        # The RFQ's own page is the document: the specification and quote form sit behind it.
        documents=[],
        source=SOURCE, source_id=detail_id or ref, source_url=url,
        status="advertised", province="Western Cape", tender_type="Request for Quotation",
        published_date=sh.iso_sast(posted),
    )


def fetch_rfqs(log=print):
    page = sh.http_get(RFQ_URL, timeout=120).decode("utf-8", errors="replace")
    rels = [normalize_rfq(*row) for row in parse_table(page) if len(row[0]) >= 4]
    log(f"  City of Cape Town procurement portal: {len(rels)} open RFQs")
    return rels


AWARD_TO = re.compile(r"\|\s*To\s*\|\s*([^|]+?)\s*\|", re.I)


def parse_award_detail(page):
    flat = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "|", page)))
    flat = re.sub(r"(\|\s*)+", "|", flat)
    m = AWARD_TO.search(flat)
    return sh.clean(m.group(1)) if m else None


def fetch_awards(limit=50, with_supplier=True, log=print):
    """Recent RFQ award notices: [{reference, title, category, status,
    award_date, supplier, detail_url}]. with_supplier reads each detail page
    (one request each, paused) for the supplier's name."""
    import time
    page = sh.http_get(AWARDS_URL, timeout=120).decode("utf-8", errors="replace")
    out = []
    for cells, path, detail_id in parse_table(page)[:limit]:
        if len(cells) < 5:
            continue
        rec = {"source": SOURCE, "buyer": BUYER, "reference": cells[0], "title": cells[1],
               "category": cells[2], "status": cells[3],
               "award_date": sh.iso_sast(cells[5] if len(cells) > 5 and cells[5] else cells[4]),
               "detail_url": f"https://web1.capetown.gov.za{path}" if path else None, "supplier": None}
        if with_supplier and path:
            try:
                rec["supplier"] = parse_award_detail(sh.http_get(rec["detail_url"], timeout=60).decode("utf-8", errors="replace"))
            except Exception as e:
                log(f"  WARNING: Cape Town award {cells[0]} detail failed: {e}")
            time.sleep(0.5)
        out.append(rec)
    log(f"  City of Cape Town awards: {len(out)} read")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--awards", action="store_true", help="read the RFQ award notices instead of open RFQs")
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    if args.awards:
        rows = fetch_awards(limit=args.limit)
        for a in rows[:15]:
            print(f"  {a['reference']:>12}  {a['award_date']}  {a['supplier']}  -  {a['title'][:50]}")
    else:
        rows = fetch_rfqs()
        for r in rows[:15]:
            print(f"  {r['contract_number']:>12}  closes {r['closing_date']}  {r['procurement_category']}  -  {(r['title'] or '')[:50]}")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(rows, f, indent=2)
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
