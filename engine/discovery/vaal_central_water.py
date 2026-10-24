"""
Discovery, direct buyer reader: Vaal Central Water Board's own tenders
page (vaalcentralwater.co.za/advertised-tenders/).

Flagged as a candidate by the SOE-catalog research
(docs/specs/Government-Buyer-Catalog-SOEs.md: PFMA Schedule 3B, "Reachable,
real content - 9 tenders ... Not yet cross-checked against eTenders"). That
check is now done, this same session (2026-10-20): `etenders_portal.py
--buyer "vaal central"` returns exactly 4 small services/goods tenders
(VCW27/051, VCW27/028A, VCW27/055B, VCW27/053 - calibration, a software
licence, aircon servicing), a completely different and non-overlapping
reference series from the 9 construction/infrastructure tenders this
site's own "advertised-tenders" page carries (VCW380/PWLPLM/24,
VCW440/STEELBPTB/26, VCW438/LIMS3/26, VCW439/TAMSVCW3/26, VCW403/SECURE/25,
VCW422/CONTR/IRM2/26, BW283/ARWWTW/22, VCW269/ERPIS/21, VCW410/WINWTW/25) -
a confirmed real gap, not assumed.

Reachability note, confirmed this same session: a curl fetch with a
Chrome-style User-Agent string was refused by this site's WAF
(server: BitNinja-WafPro) with a connection reset before any response -
looked at first like the same kind of automated-traffic block seen
elsewhere in this research, but a plain curl/8.5.0 UA, and separately
source_http.py's own USER_AGENT string, both got a normal HTTP 200. The
block is UA-specific, not blanket; this module reads the page the same way
every other reader does (source_http.http_get, source_http.USER_AGENT),
which already works.

Page structure (confirmed from the real page source, 2026-10-20): a plain
WordPress/Elementor page, no JS rendering needed, no pagination controls
present (checked - this is everything the page has). Each tender is one
"e-flex e-con-boxed e-con e-parent" row (the same wrapper class the page's
own 2 header rows also use - a header row simply has no VCW/BW reference
in it and is skipped, not an error). Within a row, in order: the reference
number, the title (both sometimes wrapped in <strong>, sometimes not -
confirmed inconsistent on the real page, both handled), "Date uploaded:"
and "Closing date:" each as a label <p> followed by a value <p>, then one
or more document buttons (elementor-button links with an href and a
button-text span). Document counts vary per tender (1 to 9 on the page
checked) - every button present is read, not just the first.

Date format: full month names, both Title Case and UPPERCASE on the same
page ("11 SEPTEMBER 2026", "25 May 2026") - source_http.parse_sast's DMY
format was extended this session to accept a full month name, not just
Rand Water's 3-letter abbreviation (see its own docstring).

Usage:
    python3 vaal_central_water.py [--out FILE.json]
"""
import argparse
import html
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402

SOURCE = "vaal_central_water"
LIST_URL = "https://vaalcentralwater.co.za/advertised-tenders/"
BUYER = "Vaal Central Water Board"

ROW_SPLIT = re.compile(
    r'<div class="elementor-element elementor-element-\w+(?:\s+[\w-]+)*\s+e-flex e-con-boxed e-con e-parent"'
)
# The column-header row's own wrapper carries an extra "elementor-hidden-mobile"
# class the real tender rows don't have (confirmed on the real page,
# 2026-10-20) - the (?:\s+[\w-]+)* above tolerates that, and any other extra
# class a future markup tweak might add, so a row never silently glues onto
# its neighbour instead of splitting out on its own (a glued chunk's REF_FIELDS
# match would grab the first tender's fields and silently drop the second).
ROW_FIELDS = re.compile(
    r'<p>\s*(?:<strong>)?\s*((?:VCW|BW)[^<]*?)\s*(?:</strong>)?\s*</p>.*?'
    r'<p>\s*(?:<strong>)?\s*(.*?)\s*(?:</strong>)?\s*</p>.*?'
    r'Date uploaded:</p>\s*<p>\s*([^<]*?)\s*</p>.*?'
    r'Closing date:</p>\s*<p>\s*([^<]*?)\s*</p>',
    re.S,
)
DOC_LINK = re.compile(
    r'<a class="elementor-button[^"]*" href="([^"]+)">\s*'
    r'<span class="elementor-button-content-wrapper">\s*'
    r'<span class="elementor-button-text">([^<]*)</span>',
    re.S,
)


def _text(fragment):
    return sh.clean(html.unescape(re.sub(r"<[^>]+>", " ", fragment or "")))


def parse_tenders(page):
    """[(reference, title, uploaded_text, closing_text, [(url, label), ...])]
    for every tender row on the page. The page's own 2 header rows share the
    same row wrapper class as a real tender row but carry no VCW/BW
    reference, so they fail ROW_FIELDS and are skipped here - not a parse
    failure. Raises if nothing at all parses, since that would mean the
    page's structure changed in some way this reader no longer recognises,
    not that the board genuinely has zero tenders (the page has never been
    seen empty)."""
    rows = []
    for chunk in ROW_SPLIT.split(page):
        m = ROW_FIELDS.search(chunk)
        if not m:
            continue
        ref, title, uploaded, closing = (_text(g) for g in m.groups())
        if not ref:
            continue
        docs = [(_text(url), _text(label)) for url, label in DOC_LINK.findall(chunk)]
        rows.append((ref, title, uploaded, closing, docs))
    if not rows:
        raise RuntimeError(
            "vaal_central_water: 0 tenders parsed from a 200 response - "
            "the page's own markup has likely changed (row/field classes, "
            "or the reference-number prefix). Fix the parser before "
            "trusting an empty result as 'no open tenders'."
        )
    return rows


def normalize(ref, title, uploaded, closing, docs):
    return sh.release(
        ocid=f"vaal_central_water:{ref}",
        contract_number=ref, title=title, description=title, buyer=BUYER,
        # Vaal Central Water's own listing gives a date only, never a time -
        # see iso_sast_closing()'s own docstring.
        closing_date=sh.iso_sast_closing(closing),
        published_date=sh.iso_sast(uploaded),
        documents=[{"title": label or None, "url": url} for url, label in docs if url],
        source=SOURCE, source_id=ref, source_url=LIST_URL,
        status="advertised", tender_type="Tender",
    )


def fetch_releases(log=print):
    page = sh.http_get(LIST_URL, timeout=90).decode("utf-8", errors="replace")
    rels = [normalize(*row) for row in parse_tenders(page)]
    log(f"  Vaal Central Water Board: {len(rels)} advertised tenders")
    return rels


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    rows = fetch_releases()
    for r in rows:
        print(f"  {r['contract_number']:<22} closes {r['closing_date']}  {len(r['documents'])} docs  -  "
              f"{(r['title'] or '')[:60]}")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(rows, f, indent=2)
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
