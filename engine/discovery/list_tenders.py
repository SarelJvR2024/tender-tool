"""
Stream 4 (discovery), part 1: list every open SANRAL tender.

The public page at /sanral-tenders/list/open-tenders only *renders* 10 rows
(a DataTables widget), but the handover brief already flagged this list as
incomplete ("showed only 10 tenders ... do not rely on it alone"). Observed
on 2026-10-15: the table is actually server-side paginated through a JSON
AJAX endpoint on the same path:

    GET /sanral-tenders/list/open-tenders
        ?pageSize=<n>&pageIndex=<p>&region_id=1&search=<text>&draw=1

region_id=1 is the "All / National" view (confirmed: a single call with
region_id=1 returned tenders from North West, Eastern Cape and Limpopo in
one response). This endpoint needs no cookies, no form submission and no
personal data - it is the same public data the page itself renders, just
without the 10-row client-side limit. The response's "total_filtered"
count (observed: 139) does not always equal the row count returned
(observed: 137) - this script does not try to explain that discrepancy,
it just reports both counts so a human can decide if a second page is
needed.

This script does NOT touch the per-tender "Download Documents" form - that
form is reCAPTCHA + CSRF protected and asks for personal data (full name,
company, phone, email). Automating past a reCAPTCHA is out of scope here;
see detail.py for what the detail page *can* tell you without that form.

Usage:
    python3 list_tenders.py [--page-size 200] [--search TEXT] [--out FILE.json]
"""
import argparse
import html
import json
import re
import sys
import urllib.parse
import urllib.request

LIST_URL = "https://www.nra.co.za/sanral-tenders/list/open-tenders"
USER_AGENT = "Mozilla/5.0 (tender-tool discovery; contact: Sarel)"

ROW_LINK_RE = re.compile(r'href="(?P<href>[^"]+)">(?P<ref>[^<]+)<')
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


def _clean_text(raw_html):
    text = re.sub(r"<[^>]+>", " ", raw_html or "")
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _parse_row(row):
    ref_cell, project_type, province, description, queries_to, closing_date = row[:6]
    m = ROW_LINK_RE.search(ref_cell)
    href = m.group("href") if m else None
    reference = html.unescape(m.group("ref")).strip() if m else _clean_text(ref_cell)
    slug = href.rsplit("/", 1)[-1] if href else None
    email_match = EMAIL_RE.search(html.unescape(queries_to or ""))
    return {
        "reference": reference,
        "slug": slug,
        "detail_url": urllib.parse.urljoin("https://www.nra.co.za", href) if href else None,
        "project_type": _clean_text(project_type),
        "province": _clean_text(province),
        "description": _clean_text(description),
        "queries_to_email": email_match.group(0) if email_match else None,
        "closing_date": closing_date.strip() if closing_date else None,
    }


def fetch_tenders(page_size=200, page_index=1, search="", region_id="1", list_slug="open-tenders"):
    """list_slug: SANRAL serves its other public lists from the same endpoint
    shape - "awarded-tenders" and "closed-tenders" (confirmed 2026-10-17, same
    6 columns, detail links under /awarded-tenders/<slug> and
    /closed-tenders/<slug>). award_outcomes.py reads those two."""
    params = {
        "pageSize": page_size,
        "pageIndex": page_index,
        "region_id": region_id,
        "search": search,
        "draw": 1,
    }
    url = LIST_URL.rsplit("/", 1)[0] + "/" + list_slug + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "X-Requested-With": "XMLHttpRequest"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.load(resp)
    rows = [_parse_row(r) for r in payload.get("tenders", [])]
    return rows, payload.get("total"), payload.get("total_filtered")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                  formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--page-size", type=int, default=200)
    ap.add_argument("--search", default="")
    ap.add_argument("--out", help="write JSON list to this file instead of stdout")
    args = ap.parse_args()

    rows, total, total_filtered = fetch_tenders(page_size=args.page_size, search=args.search)
    print(f"Fetched {len(rows)} tenders (API total={total}, total_filtered={total_filtered})",
          file=sys.stderr)
    if len(rows) < (total_filtered or 0):
        print(f"WARNING: fewer rows returned ({len(rows)}) than total_filtered ({total_filtered})"
              " - consider a second page or a larger --page-size", file=sys.stderr)

    out = json.dumps(rows, indent=2)
    if args.out:
        open(args.out, "w").write(out)
        print(f"Wrote {args.out}", file=sys.stderr)
    else:
        print(out)


if __name__ == "__main__":
    main()
