"""
Discovery, direct buyer reader: the Construction Industry Development
Board's OWN procurement (cidb.org.za/cidb-tenders/current-tenders/) - not
the contractor-registration/grading system this product already reads
elsewhere (cidbGrading.ts), CIDB's own buying as an organisation.

The page's visible table is rendered client-side from a plain JSON feed
(cidb.org.za/tenders.json - found via the page's own JS, no API key, no
login) - checked live 2026-10-18: 34 rows total. Every row's own "status"
field reads "active" regardless of outcome (confirmed on rows the site
itself labels Awarded/Closed) - the real state is "realstatus"
("Open"/"Closed"/"Awarded"/etc, 1 Open of 34 checked). No explicit
closing-date field is published (only advert/award timestamps) -
closing_date is left unset, same "unknown is not expired" convention every
other reader in this package uses for a field its source doesn't state.

`description` is sometimes NOT plain text: checked live 2026-11-07, 8 of 25
reachable rows (Awarded, so not yet seen on an Open row, but a real,
recurring base rate on this exact feed, not a one-off) embed a raw HTML
`<a href="...">Click here</a> to download the Pricing Schedule.`/Addendum
sentence - a second real document (a pricing schedule or addendum) that
isn't in tender_advert_file or tender_briefing_file at all, and would be
silently missing from `documents` entirely. One row (cidb 005 2526) even
has a malformed tag (`href=...xlsx"` with no opening quote) - the real
site's own markup, not a hypothetical. `_extract_description_links()`
pulls any such link(s) out into `documents` and strips the markup back to
plain text for `title`/`description`, tolerating the unquoted-href case.

Usage:
    python3 cidb_tenders.py [--out FILE.json]
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402

SOURCE = "cidb_tenders"
BASE = "https://www.cidb.org.za"
FEED_URL = BASE + "/tenders.json"
BUYER = "Construction Industry Development Board (cidb)"

# href's value may or may not be quoted (a real row on this feed, cidb 005
# 2526, has `href=https://...xlsx"` - a missing opening quote with the
# closing one still there) - `"?` on both sides tolerates either shape.
# The captured trailing text (after the optional "to download ") becomes
# the document's title; it falls back to the anchor's own text ("Click
# here" is not useful, but better than nothing) when there is none.
_DESC_LINK_RE = re.compile(
    r'<a\s+[^>]*?href\s*=\s*"?([^"\s>]+)"?[^>]*>([^<]*)</a>\s*(?:to\s+download\s+)?([^.\r\n<]*)\.?',
    re.I,
)


def _extract_description_links(description):
    """(documents, plain_text) - any <a href=...> link(s) embedded in a
    cidb description, pulled out as real documents, with the markup
    stripped from the text so what's shown to a bidder is the real
    sentence, not literal HTML."""
    if not description or "<" not in description:
        return [], description
    docs = []
    for m in _DESC_LINK_RE.finditer(description):
        title = sh.clean(m.group(3)) or sh.clean(m.group(2)) or "Linked document"
        docs.append({"title": title, "url": m.group(1)})
    text = re.sub(r"<a\s+[^>]*>[^<]*</a>", "", description)
    text = re.sub(r"<[^>]+>", "", text)
    return docs, text


def fetch_feed():
    return sh.http_json(FEED_URL, timeout=60)


def normalize(row):
    desc_docs, plain_description = _extract_description_links(row.get("description"))
    advert = row.get("tender_advert_file")
    docs = [{"title": "Tender advert", "url": advert}] if advert else []
    briefing_doc = row.get("tender_briefing_file")
    if briefing_doc:
        docs.append({"title": "Briefing document", "url": briefing_doc})
    docs += [d for d in desc_docs if d["url"] not in {x["url"] for x in docs}]
    return sh.release(
        ocid=f"cidb-tenders:{row.get('tender_ID')}",
        contract_number=sh.clean(row.get("bid_number")),
        title=sh.clean(plain_description),
        description=sh.clean(plain_description),
        buyer=BUYER,
        documents=docs,
        source=SOURCE, source_id=str(row.get("tender_ID")),
        source_url=BASE + "/cidb-tenders/current-tenders/",
        status="advertised" if (row.get("realstatus") or "").lower() == "open" else (row.get("realstatus") or "").lower() or None,
        published_date=sh.iso_sast(row.get("tender_advert_date_time")),
        modified_date=sh.iso_sast(row.get("tender_awards_date_time")),
    )


def fetch_releases(log=print):
    data = fetch_feed()
    rows = data.get("tm_tenders") or []
    out = [normalize(r) for r in rows if (r.get("realstatus") or "").lower() == "open"]
    log(f"  cidb tenders: {len(out)} open of {len(rows)} listed ({data.get('tender_count')} reported by the feed)")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    rels = fetch_releases()
    for r in rels[:15]:
        print(f"  {(r['contract_number'] or '-'):>20}  {(r['title'] or '')[:65]}")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(rels, f, indent=2)
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
