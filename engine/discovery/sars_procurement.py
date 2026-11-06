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
import urllib.parse

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
# Found 2026-11-01: this required "href" to be the literal first attribute
# right after "<a " (no tolerance for another attribute - class, target -
# appearing first). The real live site already puts other attributes before
# href on plenty of its own <a> tags elsewhere on the same pages (nav/social
# links checked directly) - a CMS/theme change that did the same for a
# tender link would silently drop that tender with no error, the same
# quiet-data-loss shape this session has found and fixed repeatedly for
# other sources. DOC_LINK below already tolerates this correctly
# (`<a[^>]+href=`) - TENDER_LINK alone had the rigid form. Re-verified
# against the real live listing page: identical matches before and after.
TENDER_LINK = re.compile(r'<a[^>]+href="([^"]+/tender/[^"]+)"[^>]*>([^<]+)</a>', re.I)
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
        # DOC_LINK has no scheme requirement (unlike TENDER_LINK/transnet_etenders.py's
        # own doc-link pattern) - a relative href ("/files/x.pdf") is a normal thing for
        # a real site's HTML, resolved here against the page it was found on (not just
        # SARS's site root - a detail page under a different path could have its own
        # relative base). An unresolved relative/scheme-less URL stored as-is made
        # download_discovered_documents.py's urllib.request.Request() raise ValueError
        # on construction - a plain crash, not one of urlopen's own network-error types,
        # so it was uncaught there and took out that run's ENTIRE document-download pass
        # on the first such link (QA-Edge-Case-Findings.md, 2026-10-19).
        link, title = urllib.parse.urljoin(url, html.unescape(m.group(1))), _text(m.group(2))
        if link in seen or not title:
            continue
        seen.add(link)
        docs.append({"title": title, "url": link})
    return docs


# Standing review, 2026-11-06: the page's separate "Published Tenders"
# detail section (its own <p><strong>title</strong><br>Closing Date:
# DD/MM/YYYY HH:MM (<a>...) ... </p> blocks - distinct from the dated <ul>
# summary list DATE_BLOCK/TENDER_LINK above read) states each tender's real
# closing date/time, never previously extracted since this source's own
# first commit (cace3f7) - confirmed live: both of SARS's 2 currently open
# tenders state one ("Closing Date: 17/11/2026 11:00", "10/11/2026 11:00"),
# so every SARS tender ever discovered has had no closing date at all.
# Day-first (DD/MM/YYYY), NOT source_http.parse_sast()'s own US-style
# month-first reading - deliberately NOT routed through parse_sast()'s
# ambiguous slash-date branch (a day and month both <=12, an entirely real
# case here, would silently transpose) - the day/month/year are parsed
# explicitly below and handed to sh.iso_sast() only as an unambiguous ISO
# string.
#
# The `(?:(?!<strong>).)*?` middle section is deliberate, not just a lazy
# `.*?`: caught by the fixture's own "What's New" <strong> headings sitting
# earlier on the same page than this detail section - an unbounded `.*?`
# jumped straight from THAT first unrelated <strong> all the way to the
# FIRST "Closing Date:" anywhere later in the page, attaching the wrong
# (or no, once its captured title fails REF.search()) date to the wrong
# entry and consuming the real match findall() needed. Refusing to cross
# into another <strong> keeps each match scoped to its own title block,
# regardless of what else appears earlier on the page.
_CLOSING_IN_BLOCK = re.compile(
    r"<strong>([^<]*?)</strong>(?:(?!<strong>).)*?Closing Date:\s*(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})",
    re.S,
)


def _closing_dates_by_ref(page):
    out = {}
    for title, d, mo, y, hh, mm in _CLOSING_IN_BLOCK.findall(page):
        m = REF.search(html.unescape(title))
        if not m:
            continue
        ref = re.sub(r"\s+", "", m.group(1)).upper()
        try:
            out[ref] = sh.iso_sast(f"{y}-{int(mo):02d}-{int(d):02d}T{int(hh):02d}:{int(mm):02d}:00")
        except ValueError:
            continue  # an out-of-range day/month (typo on the live page) - unreadable, not a crash
    return out


def parse_listing(page):
    """One release per <a href=".../tender/..."> link found under a dated
    block (a date can carry more than one tender). Each entry's closing date
    (if the page states one for that ref, see _closing_dates_by_ref()) is
    attached here, not guessed from the dated-block heading itself (that's
    the publish date, a different field)."""
    closing_by_ref = _closing_dates_by_ref(page)
    out = []
    for date_str, block in DATE_BLOCK.findall(page):
        published = _parse_text_date(date_str)
        for url, text in TENDER_LINK.findall(block):
            text = html.unescape(text)
            m = REF.search(text)
            ref = re.sub(r"\s+", "", m.group(1)).upper() if m else None
            title = sh.clean(text.split("|")[0]) if "|" in text else sh.clean(text)
            out.append({"url": html.unescape(url), "title": title, "ref": ref, "published": published,
                        "closing": closing_by_ref.get(ref) if ref else None})
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
        closing_date=entry.get("closing"),
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
