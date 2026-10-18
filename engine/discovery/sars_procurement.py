"""
Discovery, direct buyer reader: South African Revenue Service's own
Published Tenders page (sars.gov.za/procurement/published-tenders/).

SARS runs its procurement notices on its own WordPress site, not through
the central eTenders portal under a SARS-branded row set the same way most
national departments do - checked live 2026-10-18, 10+ open RFP/RFI entries
with no table, just dated list items ("16 October 2026 - New Tender
RFP14/2026: <description>") each linking to the tender's own detail page.
Each detail page lists its PDF documents (advert, specification, Q&A,
addenda) as plain links.

Access: the listing page's HTML carries every open-tender title/date/link
directly (no API, no login, no CAPTCHA). No per-tender detail-page read is
needed for the listing itself; document links on the detail page are read
only when with_documents=True.

Usage:
    python3 sars_procurement.py [--no-documents] [--out FILE.json]
"""
import argparse
import html
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402

SOURCE = "sars_procurement"
BASE = "https://www.sars.gov.za"
LIST_URL = BASE + "/procurement/published-tenders/"
BUYER = "South African Revenue Service (SARS)"

# "16 October 2026 – New Tender" or "15 October 2026 –" (not every entry has
# "New Tender" after the dash) immediately followed by the <ul><li><a> for
# that date's tender(s).
DATE_BLOCK = re.compile(
    r"<strong>\s*(\d{1,2}\s+\w+\s+\d{4})\s*[–—-]\s*(?:New Tender)?\s*</strong>\s*<ul>(.*?)</ul>",
    re.S,
)
TENDER_LINK = re.compile(r'<a href="([^"]+/tender/[^"]+)"[^>]*>([^<]+)</a>', re.I)
REF = re.compile(r"\b(RF[PIQ]\s*\d{1,3}\s*/\s*20\d{2})\b", re.I)
DOC_LINK = re.compile(r'<a[^>]+href="([^"]+\.(?:pdf|docx?|xlsx?|zip))"[^>]*>([^<]{1,150})</a>', re.I)


def _text(fragment):
    return sh.clean(html.unescape(re.sub(r"<[^>]+>", " ", fragment or "")))


_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"], start=1)}
_TEXT_DATE = re.compile(r"(\d{1,2})\s+(\w+)\s+(\d{4})")


def _parse_text_date(s):
    """'16 October 2026' -> ISO date (SAST midnight), or None - the page's
    own date format, which source_http.parse_sast() doesn't read (it covers
    ISO and the US/Cape-Town-portal formats, not a month name)."""
    m = _TEXT_DATE.match(s or "")
    if not m:
        return None
    day, month_name, year = m.groups()
    month = _MONTHS.get(month_name.lower())
    if not month:
        return None
    return sh.iso_sast(f"{year}-{month:02d}-{int(day):02d}")


def fetch_list():
    # Unescaped up front: the date/tender markup uses HTML entities for its
    # dash ("16 October 2026 &#8211; New Tender"), and matching the raw
    # entity text is more fragile than normalising once before any regex
    # sees the page.
    return html.unescape(sh.http_get(LIST_URL, timeout=60).decode("utf-8", errors="replace"))


def fetch_documents(url):
    page = sh.http_get(url, timeout=60).decode("utf-8", errors="replace")
    docs, seen = [], set()
    for m in DOC_LINK.finditer(page):
        link, title = html.unescape(m.group(1)), _text(m.group(2))
        if link in seen or not title:
            continue
        seen.add(link)
        docs.append({"title": title, "url": link})
    return docs


def parse_listing(page):
    """One release per <a href=".../tender/..."> link found under a dated
    block (a date can carry more than one tender)."""
    out = []
    for date_str, block in DATE_BLOCK.findall(page):
        published = _parse_text_date(date_str)
        for url, text in TENDER_LINK.findall(block):
            text = html.unescape(text)
            m = REF.search(text)
            ref = re.sub(r"\s+", "", m.group(1)).upper() if m else None
            title = sh.clean(text.split("|")[0]) if "|" in text else sh.clean(text)
            out.append({"url": html.unescape(url), "title": title, "ref": ref, "published": published})
    return out


def normalize(entry, docs=None):
    return sh.release(
        ocid=f"sars-procurement:{entry['ref'] or sh.norm_ref(entry['url'])}",
        contract_number=entry["ref"],
        title=entry["title"],
        description=entry["title"],
        buyer=BUYER,
        documents=docs or [],
        source=SOURCE, source_id=entry["ref"] or entry["url"], source_url=entry["url"],
        status="advertised",
        published_date=entry["published"],
    )


def fetch_releases(with_documents=True, log=print):
    page = fetch_list()
    entries = parse_listing(page)
    # Same tender can appear once per section re-listing (e.g. a "What's
    # New" summary plus its own dated entry) - keep the first occurrence.
    seen, out = set(), []
    for e in entries:
        key = e["ref"] or e["url"]
        if key in seen:
            continue
        seen.add(key)
        docs = None
        if with_documents:
            try:
                docs = fetch_documents(e["url"])
            except Exception as ex:
                log(f"  WARNING: SARS documents for {e['ref']} failed: {ex}")
        out.append(normalize(e, docs))
    log(f"  SARS Published Tenders: {len(out)} open tenders")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-documents", action="store_true")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    rels = fetch_releases(with_documents=not args.no_documents)
    for r in rels[:15]:
        print(f"  {(r['contract_number'] or '-'):>14}  {(r['title'] or '')[:70]}")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(rels, f, indent=2)
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
