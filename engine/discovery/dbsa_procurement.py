"""
Discovery, direct buyer reader: the Development Bank of Southern Africa's
own procurement page (dbsa.org/procurement) - its "Open RFPs and RFRs"
table, not the separate awarded/cancelled archive page.

A plain Drupal page: the open-opportunities table is in the page's own
HTML (no API, no login, no CAPTCHA) - checked live 2026-10-18: a 3-column
table (title incl. reference number, date published, closing date). Each
row's title cell also carries the supporting-document links for that RFP,
which are read inline rather than needing a second per-tender page fetch.

Usage:
    python3 dbsa_procurement.py [--out FILE.json]
"""
import argparse
import hashlib
import html
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402

SOURCE = "dbsa_procurement"
BASE = "https://www.dbsa.org"
LIST_URL = BASE + "/procurement"
BUYER = "Development Bank of Southern Africa (DBSA)"

ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
CELL = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S)
REF = re.compile(r"\b((?:RF[PIQR]|EOI)\s*\d{1,4}\s*/\s*20\d{2})\b", re.I)
DOC_LINK = re.compile(r'<a[^>]+href="([^"]+)"[^>]*>([^<]{1,150})</a>', re.I)


def _text(fragment):
    return sh.clean(html.unescape(re.sub(r"<[^>]+>", " ", fragment or "")))


def fetch_list():
    return sh.http_get(LIST_URL, timeout=60).decode("utf-8", errors="replace")


def parse_table(page):
    out = []
    for row_html in ROW.findall(page):
        cells = CELL.findall(row_html)
        if len(cells) < 3:
            continue
        title = _text(cells[0])
        if not title or title.lower().startswith("open rfp"):
            continue  # header row
        m = REF.search(title)
        ref = re.sub(r"\s+", "", m.group(1)).upper() if m else None
        docs = []
        for href, link_text in DOC_LINK.findall(cells[0]):
            url = href if href.startswith("http") else BASE + href
            docs.append({"title": _text(link_text) or "Document", "url": html.unescape(url)})
        out.append({
            "title": title, "ref": ref,
            "published": _text(cells[1]) if len(cells) > 1 else None,
            "closing": _text(cells[2]) if len(cells) > 2 else None,
            "documents": docs,
        })
    return out


def normalize(row):
    return sh.release(
        ocid=f"dbsa-procurement:{row['ref'] or sh.norm_ref(row['title'])}",
        contract_number=row["ref"],
        title=row["title"],
        description=row["title"],
        buyer=BUYER,
        documents=row["documents"],
        source=SOURCE, source_id=row["ref"] or sh.norm_ref(row["title"]), source_url=LIST_URL,
        status="advertised",
        closing_date=_parse_dbsa_closing(row["closing"]),
        published_date=sh.iso_sast(row["published"]),
    )


_AT_TIME = re.compile(r"\s*(?:@|at)\s*(\d{1,2})H(\d{2})", re.I)


def _parse_dbsa_closing(s):
    """DBSA writes closing times as '02 November 2026 @ 23H55' (or, found
    live 2026-11-03, 'at 23H55' - DBSA switched the separator word on their
    own page sometime after this function's own 2026-10-29 fix, silently
    re-breaking it the same way) - parse_sast() reads the day-month-year
    word order but not the 'H' time separator, so convert either '@ 23H55'
    or 'at 23H55' to the '23:55' form parse_sast() already understands
    (Rand Water's own format) rather than discarding it. The original
    2026-10-29 finding: the pre-fix version stripped the time suffix
    entirely and fed the bare date through iso_sast(), which defaults a
    time-only-unknown date to SAST midnight - but DBSA HAD stated a real
    time here, so this quietly turned a 23:55 close into a 00:00 one shown
    as "(Time TBC in RFP)" on the same day, nearly a full day earlier than
    DBSA's own stated deadline. Only a genuinely time-less closing (none
    seen in practice, but not ruled out) falls back to
    iso_sast_closing()'s 11:00 SAST convention, the same as every other
    confirmed date-only source."""
    if not s:
        return None
    m = _AT_TIME.search(s)
    if not m:
        return sh.iso_sast_closing(s)
    s = _AT_TIME.sub(f" {int(m.group(1)):02d}:{m.group(2)}", s).strip()
    return sh.iso_sast(s)


def _disambiguate_reused_refs(rels):
    """DBSA's own procurement page lists one RFP more than once when it is
    relisted with an addendum - confirmed live, 2026-11-07: ref
    "RFP185/2026" was two separate table rows, same closing date, slightly
    different title wording (one names "Addendum 01" and the compulsory
    briefing's GPS coordinates), published on two different dates (28 Oct
    and 2 Nov) - a real re-advertisement/addendum notice, not a parsing
    artefact or a duplicate row to collapse.

    Left alone, both rows get the identical ocid
    ("dbsa-procurement:<ref>"), and this engine's own per-release scoring/
    seeding (watch_new_tenders.fan_out()'s own release_key(),
    seed_supabase_opportunities.seed()'s own (company_id, ocid) upsert)
    would treat them as the SAME release scored and reported twice in one
    run, with whichever is written last silently overwriting the other's
    discovered_opportunities row and reasons - the exact pattern kouga.py's
    own _disambiguate_reused_refs() (2026-11-06) found and fixed for
    Kouga's reused Ref No.

    DBSA's own page has no stable per-row detail URL to suffix with the way
    Kouga's own per-card link let that fix do it (every DBSA row shares the
    one list page as source_url) - published_date is the one field that
    differed between the two real duplicate rows checked live, so it is
    used instead; a short hash of the title is the last-resort fallback for
    the (unseen in practice) case where even published_date collides too,
    so two such rows are never silently merged into one. Only a colliding
    ocid is touched: every non-colliding row keeps exactly the ocid it
    always had, so this doesn't re-trigger a "new tender" alert for every
    other DBSA tender that was never ambiguous."""
    by_ocid = {}
    for r in rels:
        by_ocid.setdefault(r["ocid"], []).append(r)
    for base_ocid, group in by_ocid.items():
        if len(group) < 2:
            continue
        seen_suffix = set()
        for r in group:
            suffix = r.get("published_date") or ""
            if not suffix or suffix in seen_suffix:
                suffix = hashlib.sha256((r.get("title") or "").encode()).hexdigest()[:10]
            seen_suffix.add(suffix)
            r["ocid"] = f"{base_ocid}:{suffix}"


def fetch_releases(log=print):
    page = fetch_list()
    rows = parse_table(page)
    out = [normalize(r) for r in rows]
    out = [r for r in out if not r["is_closed"]]
    _disambiguate_reused_refs(out)
    log(f"  DBSA procurement: {len(out)} open RFPs/RFRs")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    rels = fetch_releases()
    for r in rels[:15]:
        print(f"  {(r['contract_number'] or '-'):>14}  closes {r['closing_date']}  {(r['title'] or '')[:55]}")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(rels, f, indent=2)
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
