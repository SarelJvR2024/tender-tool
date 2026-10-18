"""
Discovery, direct buyer reader: Transnet's own eTenders site
(transnetetenders.azurewebsites.net, linked from transnet.net).

Transnet publishes every operating division's tenders here (TNPA ports,
TFR freight rail, TPT port terminals, TE engineering, TPL pipelines, TCC
corporate). Checked live 2026-10-17: 104 open tenders on Transnet's site,
68 of them on the eTenders portal too (matched by the portal row carrying
Transnet's 6-digit tender key, e.g. "TNPA/2026/06/0004/114472/RFP"), so 36
open Transnet tenders reach Discovery only through this reader. (The portal
also carries Transnet rows this site doesn't - mostly TPT RFPs on TPT's own
system - so the two are combined, not swapped.)

Each tender's detail page lists its documents, addenda included, as public
blob links ("Addendum 01- TNPA2026070002114620RFP.pdf", "Addendum 02-...") -
so a re-read of the document list is also how tender_changes.py sees a new
Transnet addendum land.

Access: GET /Home/GetAdvertisedTenders - the JSON the "Advertised Tenders"
page's own table loads - and GET /Home/TenderDetails?Id=<rowKey> for the
document links. No login (sign-in is only for submitting a bid), no CAPTCHA,
robots.txt 404. The contact person's name and e-mail are dropped at parse
time.

Usage:
    python3 transnet_etenders.py [--no-documents] [--out FILE.json]
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402

SOURCE = "transnet_etenders"
BASE = "https://transnetetenders.azurewebsites.net"
LIST_URL = BASE + "/Home/GetAdvertisedTenders"
DETAIL_URL = BASE + "/Home/TenderDetails?Id={key}"
DOC_LINK = re.compile(r"href=['\"](https://publishedetenders\.blob\.core\.windows\.net/[^'\"]+)['\"]", re.I)
PAUSE_S = 0.4

DIVISIONS = {"TNPA": "Transnet National Ports Authority", "TFR": "Transnet Freight Rail",
             "TPT": "Transnet Port Terminals", "TE": "Transnet Engineering", "TPL": "Transnet Pipelines",
             "TCC": "Transnet Corporate Centre", "TP": "Transnet Property"}


def fetch_list():
    data = sh.http_json(LIST_URL, timeout=120, headers={"X-Requested-With": "XMLHttpRequest"})
    if not data.get("success"):
        raise RuntimeError("Transnet GetAdvertisedTenders returned success=false")
    return data.get("result") or []


def fetch_documents(key):
    page = sh.http_get(DETAIL_URL.format(key=urllib.parse.quote(str(key))), timeout=60).decode("utf-8", errors="replace")
    docs, seen = [], set()
    for m in DOC_LINK.finditer(page):
        url = html.unescape(m.group(1))
        if url in seen:
            continue
        seen.add(url)
        name = urllib.parse.unquote(url.rsplit("/", 1)[-1])
        docs.append({"title": name, "url": url.replace(" ", "%20")})
    return docs


def briefing(row):
    when = sh.iso_sast(row.get("briefingDate"))
    details = sh.clean(row.get("briefingDetails"))
    if not when and not details:
        return None
    compulsory = None
    if details:
        low = details.lower()
        compulsory = False if ("non-compulsory" in low or "non compulsory" in low) else ("compulsory" in low or None)
    return {"date": when, "compulsory": compulsory, "venue": (details or "")[:300] or None}


def normalize(row, docs=None):
    inst = (row.get("nameOfInstitution") or "").strip()
    desc = sh.clean(row.get("descriptionOfTender"))
    name = sh.clean(row.get("nameOfTender"))
    title = desc or name  # nameOfTender is often a short internal code ("BT1TRIMRFPWR2 Orchard")
    return sh.release(
        ocid=f"transnet-etenders:{row.get('rowKey')}",
        contract_number=sh.clean(row.get("tenderNumber")),
        title=title,
        description=desc,
        buyer=DIVISIONS.get(inst, f"Transnet ({inst})" if inst else "Transnet SOC Ltd"),
        procurement_category=sh.clean(row.get("tenderCategory")),
        closing_date=sh.iso_sast(row.get("closingDate")),
        opening_date=sh.iso_sast(row.get("publishedDate")),
        documents=docs or [],
        source=SOURCE, source_id=str(row.get("rowKey")),
        source_url=DETAIL_URL.format(key=row.get("rowKey")),
        status="advertised" if (row.get("tenderStatus") or "").lower() == "open" else (row.get("tenderStatus") or "").lower() or None,
        province=sh.clean(row.get("locationOfService")),
        tender_type=sh.clean(row.get("tenderType")),
        briefing=briefing(row),
        published_date=sh.iso_sast(row.get("publishedDate")),
    )


def fetch_releases(with_documents=True, log=print):
    rows = fetch_list()
    out = []
    for r in rows:
        docs = None
        if with_documents and r.get("rowKey"):
            try:
                docs = fetch_documents(r["rowKey"])
            except Exception as e:
                log(f"  WARNING: Transnet documents for {r.get('tenderNumber')} failed: {e}")
            time.sleep(PAUSE_S)
        out.append(normalize(r, docs))
    log(f"  Transnet eTenders: {len(out)} open tenders")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--no-documents", action="store_true")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    rels = fetch_releases(with_documents=not args.no_documents)
    for r in rels[:15]:
        print(f"  {r['contract_number']:>32}  closes {r['closing_date']}  {r['buyer']}  docs={len(r['documents'])}  {(r['title'] or '')[:50]}")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(rels, f, indent=2)
        print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
