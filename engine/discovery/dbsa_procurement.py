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
        closing_date=sh.iso_sast(_strip_time_suffix(row["closing"])),
        published_date=sh.iso_sast(row["published"]),
    )


_AT_TIME = re.compile(r"\s*@\s*\d{1,2}H\d{2}", re.I)


def _strip_time_suffix(s):
    """DBSA writes closing times as '02 November 2026 @ 23H55' -
    parse_sast() reads neither the day-month-year word order nor the 'H'
    time separator, so only the date part is usable here; the exact
    closing time is still on the tender's own detail/advert, not lost."""
    if not s:
        return None
    s = _AT_TIME.sub("", s).strip()
    m = re.match(r"(\d{1,2})\s+(\w+)\s+(20\d{2})", s)
    if not m:
        return None
    day, month_name, year = m.groups()
    months = {name: i for i, name in enumerate(
        ["january", "february", "march", "april", "may", "june", "july",
         "august", "september", "october", "november", "december"], start=1)}
    month = months.get(month_name.lower())
    if not month:
        return None
    return f"{year}-{month:02d}-{int(day):02d}"


def fetch_releases(log=print):
    page = fetch_list()
    rows = parse_table(page)
    out = [normalize(r) for r in rows]
    out = [r for r in out if not r["is_closed"]]
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
