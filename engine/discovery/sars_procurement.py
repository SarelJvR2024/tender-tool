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

# Found 2026-11-07, live: EVERY document link SARS's own detail page gives -
# including its own primary tender pack, not just an "addendum"-style
# update - is a WordPress pretty permalink with NO file extension in the URL
# at all (e.g. "/rfp18-2026-tender-pack/", "/rfp-18-2026-qa/", 301-redirecting
# server-side to the real .pdf - confirmed with a real `curl -L`). DOC_LINK
# above, which requires the href to literally END in a file extension,
# matched ZERO of these against the real live detail page for EITHER of
# SARS's 2 currently open tenders (RFP14/2026, RFP18/2026) - confirmed by
# running the real, unmodified fetch_documents() against the real live HTML:
# every SARS tender's own documents, including the one thing a bidder
# actually needs (the tender pack itself), have been silently captured as an
# empty list since this reader's first commit (cace3f7) - a bigger, more
# fundamental gap than the "bare addendum announcement" risk this was
# originally opened to check (QA-Edge-Case-Findings.md, Finding 183).
#
# The real detail page always wraps its real document links the same way: a
# `<p><strong>Main</strong></p>` marker (the tender pack), optionally
# followed by a `<p><strong>Supporting</strong></p>` marker and more links
# (briefing presentations, Q&A, pricing templates - confirmed live on
# RFP18/2026), all inside the post's own one `elementor-widget-theme-post-
# content` widget's `elementor-widget-container`. Its <a> tags are sometimes
# wrapped in a <span> (the live "Price template" link) but the <a> itself is
# never nested inside another <a>. Scoping to this one widget - stopping at
# its own container's first closing </div> - is deliberate: the detail
# page's shared nav/footer chrome (Home/About SARS/Careers/Media/...) is ALSO
# a plain `<a href="https://www.sars.gov.za/...">` link with no extension;
# naively dropping DOC_LINK's extension requirement page-wide would have
# swept all of that in as bogus "documents" instead of fixing the real gap.
_DOC_SECTION = re.compile(r"<p>\s*<strong>\s*Main\s*</strong>\s*</p>(.*?)</div>", re.S | re.I)
# No {1,150} title cap here (unlike DOC_LINK/TENDER_LINK) - confirmed live,
# RFP18/2026's own primary tender-pack link reuses the FULL tender title as
# its link text (168 characters), longer than DOC_LINK's own cap. Safe
# without a cap because this pattern only ever runs against the small,
# already-scoped _DOC_SECTION match above, never the whole page.
_SECTION_LINK = re.compile(r'<a[^>]+href="([^"]+)"[^>]*>([^<]+)</a>', re.I)


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
    # DOC_LINK (raw-file-extension hrefs) first, then the "Main"/"Supporting"
    # section match (pretty-permalink hrefs, see _DOC_SECTION's own comment
    # above - this is the one that actually matches anything on the real
    # live site today). Both run: if SARS's own site ever starts linking a
    # raw .pdf directly again (a template/CMS change), that's still picked
    # up too, not replaced by this fix.
    candidates = list(DOC_LINK.finditer(page))
    section_m = _DOC_SECTION.search(page)
    if section_m:
        candidates += list(_SECTION_LINK.finditer(section_m.group(1)))
    for m in candidates:
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


# Standing review, 2026-11-07: named as a live backlog item three prior
# passes running (System-Status.md) after kouga.py's and dbsa_procurement.py's
# own sibling fixes - SARS's own `ocid` (normalize(), above) is built from
# the raw Ref No. alone, with no secondary disambiguator, the identical
# pre-fix shape both of those readers had. No live collision has been
# observed on SARS's own page yet (2 open tenders checked live 2026-11-07,
# 2 distinct refs - too small a sample to clear the risk, not proof the
# code is any safer) - fixed proactively here with a synthetic-fixture
# regression test (test_gov_sources.py's test_sars_reused_ref_...), per
# this review's own standing instruction to close out a named, scoped risk
# even without a live reproduction, rather than leaving it open indefinitely
# on the "wait for a live example" theory alone.
#
# Fixing the ocid alone would have been incomplete: fetch_releases()'s own
# in-page dedup below used to key on `ref or url`, so a genuine
# re-advertisement reusing the SAME ref under a DIFFERENT detail-page URL
# was silently DROPPED here, before it ever reached normalize()/ocid at
# all - worse than a downstream ocid collision (a dropped release, not just
# a merged one). Confirmed red on a synthetic fixture mirroring Kouga's and
# DBSA's own real reused-ref cases (an original "16 October" dated entry and
# a later "5 November" re-advertisement, same ref, two different URLs): the
# old `key = e["ref"] or e["url"]` kept only the first of the two. The dedup
# is now keyed on `url` alone, which still correctly collapses the SAME
# tender mentioned twice in different page sections (the dedup's own
# original, still-valid purpose - two mentions of one tender always share
# the identical detail-page URL) without conflating that with two
# DIFFERENT tenders that merely happen to reuse the same Ref No.
def _disambiguate_reused_refs(rels):
    """Suffixes a colliding ocid with its own URL slug - SARS always gives
    each tender its own stable detail-page URL (unlike DBSA, which shares
    one list page as source_url for every row), so no hash fallback is
    needed the way dbsa_procurement.py's own version requires. Only a
    colliding ref's ocid is touched: every non-colliding tender keeps
    exactly the ocid it always had, so this doesn't re-trigger a "new
    tender" alert for any SARS tender that was never ambiguous."""
    by_ref = {}
    for r in rels:
        by_ref.setdefault(r["contract_number"], []).append(r)
    for ref, group in by_ref.items():
        if not ref or len(group) < 2:
            continue
        for r in group:
            slug = (r["source_url"] or "").rstrip("/").rsplit("/", 1)[-1]
            r["ocid"] = f"sars-procurement:{ref}:{slug}"


def fetch_releases(with_documents=True, log=print):
    page = fetch_list()
    entries = parse_listing(page)
    # Same tender can appear once per section re-listing (e.g. a "What's
    # New" summary plus its own dated entry) - keyed on `url` (not ref, see
    # _disambiguate_reused_refs()'s own comment above for why a reused-but-
    # genuinely-different ref must NOT be collapsed here): two mentions of
    # the one real tender always share the identical detail-page URL, so
    # this still keeps the first occurrence of those; two DIFFERENT tenders
    # that happen to reuse the same Ref No. have different URLs and are now
    # both kept, to be disambiguated by ocid below instead of dropped.
    seen, out = set(), []
    for e in entries:
        key = e["url"]
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
    _disambiguate_reused_refs(out)
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
