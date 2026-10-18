"""
Discovery, national layer (portal): reads National Treasury's eTenders portal
lists directly - the same public JSON the portal's own "Advertised",
"Awarded", "Closed" and "Cancelled" tabs read - instead of only its OCDS
export (etenders_national.py).

Why this exists next to etenders_national.py (both checked live 2026-10-17):

  - The OCDS API has no status: tender.status is '' on every release. Tenders
    the portal lists as Cancelled on 16 Oct 2026 (portal ids 174383, 174403,
    174404, 174406 - "Error by publisher", "Duplicates") still came back from
    the OCDS API on 17 Oct with status '' and their original closing dates.
    The portal's status=4 list carries every cancellation with its reason
    and the time it was cancelled. That is the only automatable cancellation
    signal for eTenders buyers (tender_changes.py reads it).
  - The OCDS API breaks with HTTP 500 at about page 5-6 of any window (500-600
    releases). The portal's advertised list paged cleanly: 2,211 open tenders
    from 408 buyers in 5 requests of 500.
  - The portal row has what OCDS doesn't: province, the portal's own category,
    tender type (RFB/RFQ/RFP/EOI...), the briefing session (date, venue,
    compulsory or not), and a per-document dateModified (505 of 2,211 open
    tenders had a document modified after publication - e.g. WTE1062CE's
    "Wte1062-Addendum.pdf" added 17 Oct to a tender published 16 Oct).
  - OCDS tender.id is the portal id and tender.title is the bid number; the
    portal's tender_No / description are those same facts under the right
    names, so this reader's contract_number is the real bid number.

Join rule: the portal row's numeric id is the OCDS tender.id, and its ocid is
ocds-9t57fa-<id> (Award-Outcomes-Findings.md section 2: 205 of 275 checked
rows matched, every matched title equal). So a portal release and an OCDS
release of the same tender share an ocid, the seen store and
discovered_opportunities treat them as one, and either feed can be used.

Access (same checks as award_outcomes.py, which reads the Awarded tab): no
login, no CAPTCHA, robots.txt 404, no terms page; the endpoint is the one the
public page's DataTable calls. Politeness: pages of 500 (the portal's own
export reads larger), a pause between pages, retries with backoff. Personal
data minimisation: the contact person, phone, e-mail and the uploading
official's address are dropped at parse time.

Usage:
    python3 etenders_portal.py [--status advertised|cancelled|closed|awarded]
        [--limit N] [--since-days N] [--buyer TEXT] [--out FILE.json]
"""
import argparse
import datetime
import json
import os
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402

SOURCE = "etenders_portal"
LIST_URL = "https://www.etenders.gov.za/Home/PaginatedTenderOpportunities"
PUBLIC_URL = "https://www.etenders.gov.za/Home/opportunities?id={status}"
DOWNLOAD_URL = "https://www.etenders.gov.za/home/Download?blobName={blob}&downloadedFileName={name}"
OCID_PREFIX = "ocds-9t57fa-"
STATUS_CODES = {"advertised": 1, "awarded": 2, "closed": 3, "cancelled": 4}
STATUS_NAMES = {"Published": "advertised", "Awarded": "awarded", "Closed": "closed", "Cancelled": "cancelled"}
PAGE_SIZE = 500
MAX_PAGES = 60  # hard stop (30,000 rows) so a bug can't loop against a live government site
PAUSE_S = 0.5
RECOVER_CHUNK = 25


def fetch_page(status_code, start, length=PAGE_SIZE, retries=3):
    q = urllib.parse.urlencode({"status": status_code, "draw": 1, "start": start, "length": length})
    return sh.http_json(f"{LIST_URL}?{q}", timeout=180, retries=retries)


def fetch_rows(status="advertised", limit=None, since=None, page_size=PAGE_SIZE, log=print):
    """Raw portal rows for one tab, newest first (the portal's own order).
    limit: stop after this many distinct tenders. since: an aware datetime -
    for 'cancelled', stop once cancellations are older than this (the list is
    newest-cancelled first, and 22,528 rows go back years). Returns
    (rows, records_total). A page that fails after retries ends the read with
    what was already fetched (logged), like etenders_national.fetch_releases()."""
    code = STATUS_CODES[status]
    rows, seen_ids, total = [], set(), None
    for page in range(MAX_PAGES):
        try:
            data = fetch_page(code, page * page_size, page_size)
        except RuntimeError as e:
            # One broken record makes the server 500 the whole page
            # (Award-Outcomes-Findings.md 2: seen on Awarded; seen 2026-10-17
            # on Closed). Re-read the page in small chunks, skipping only
            # the chunks that still fail.
            data = {"data": [], "recordsTotal": total}
            broken = 0
            for off in range(0, page_size, RECOVER_CHUNK):
                try:
                    part = fetch_page(code, page * page_size + off, RECOVER_CHUNK, retries=1)
                    data["data"] += part.get("data") or []
                    data["recordsTotal"] = part.get("recordsTotal", total)
                except RuntimeError:
                    broken += 1
                time.sleep(PAUSE_S)
            log(f"  portal {status} page {page + 1} failed whole ({e}); re-read in chunks of {RECOVER_CHUNK}, "
                f"{broken} chunk(s) skipped")
            if not data["data"]:
                break
            data["_partial"] = broken > 0
        total = data.get("recordsTotal", total)
        batch = data.get("data") or []
        stop = False
        for r in batch:
            if since and status == "cancelled":
                when = sh.parse_utc((r.get("cancelled") or {}).get("dateModified"))
                if when and when < since:
                    stop = True
                    break
            rows.append(r)
            seen_ids.add(r.get("id"))
            if limit and len(seen_ids) >= limit:
                stop = True
                break
        if stop or (len(batch) < page_size and not data.get("_partial")):
            break
        time.sleep(PAUSE_S)
    return rows, total


def dedupe_rows(rows):
    """The portal returns one row per joined child record: a tender cancelled
    twice (174406 above) or with several awards comes back as several rows
    with the same id. Keeps one row per id, merging the cancellation records
    into a list under `_cancellations` (latest first)."""
    out = {}
    for r in rows:
        i = r.get("id")
        if i is None:
            continue
        keep = out.setdefault(i, dict(r, _cancellations=[]))
        c = r.get("cancelled")
        if c and c not in keep["_cancellations"]:
            keep["_cancellations"].append(c)
    for r in out.values():
        r["_cancellations"].sort(key=lambda c: c.get("dateModified") or "", reverse=True)
    return list(out.values())


def documents(row):
    docs = []
    for d in row.get("supportDocument") or []:
        if d.get("active") is False:
            continue
        blob = f"{d.get('supportDocumentID')}{d.get('extension') or ''}"
        name = d.get("fileName") or blob
        docs.append({
            "title": name,
            "url": DOWNLOAD_URL.format(blob=urllib.parse.quote(blob), name=urllib.parse.quote(name)),
            "date_modified": sh.iso_utc(d.get("dateModified")),
        })
    return docs


def briefing(row):
    if not row.get("briefingSession"):
        return None
    return {"date": sh.iso_sast(row.get("compulsory_briefing_session")),
            "compulsory": bool(row.get("briefingCompulsory")),
            "venue": sh.clean(row.get("briefingVenue"))}


def normalize(row, status_hint=None):
    """One portal row -> the common release shape (source_http.release)."""
    status = STATUS_NAMES.get(row.get("status"), status_hint)
    cancellations = row.get("_cancellations") or ([row["cancelled"]] if row.get("cancelled") else [])
    rel = sh.release(
        ocid=f"{OCID_PREFIX}{row['id']}",
        contract_number=sh.clean(row.get("tender_No")),
        title=sh.clean(row.get("description")) or sh.clean(row.get("tender_No")),
        description=sh.clean(row.get("description")),
        buyer=sh.clean(row.get("organ_of_State") or row.get("department")),
        procurement_category=sh.clean(row.get("category")),
        # the same value under the name Discovery's cross-check reads (audit
        # O1, taxonomy.Taxonomy.etenders_crosscheck): the buyer's own pick
        # from the portal's Category dropdown
        etenders_category=sh.clean(row.get("category")),
        closing_date=sh.iso_sast(row.get("closing_Date")),
        opening_date=sh.iso_sast(row.get("date_Published")),
        documents=documents(row),
        source=SOURCE, source_id=str(row["id"]),
        source_url=PUBLIC_URL.format(status=STATUS_CODES.get(status, 1)),
        status=status,
        province=sh.clean(row.get("province")),
        tender_type=sh.clean(row.get("type")),
        briefing=briefing(row),
        published_date=sh.iso_sast(row.get("date_Published")),
        modified_date=max((d["date_modified"] for d in documents(row) if d.get("date_modified")), default=None),
    )
    # Some buyers type the bidders (and sometimes each bid amount) into the
    # closed tab: 20 of the newest 201 closed rows on 18 Oct 2026; ~10% / ~3%
    # with amounts per Strategy section 11.6. Names and amounts only - the
    # official who typed them (updatedBy) is dropped.
    bidders = [{"name": sh.clean(b.get("biddersName")), "amount": b.get("amount")}
               for b in row.get("bidders") or [] if not b.get("isDeleted") and sh.clean(b.get("biddersName"))]
    if bidders:
        rel["bidders"] = bidders
    if cancellations:
        rel["cancellation"] = {"reason": sh.clean(cancellations[0].get("reason")),
                               "cancelled_at": sh.iso_utc(cancellations[0].get("dateModified")),
                               "times_recorded": len(cancellations)}
    return rel


def fetch_releases(status="advertised", limit=None, since=None, log=print):
    rows, total = fetch_rows(status, limit=limit, since=since, log=log)
    rels = [normalize(r, status) for r in dedupe_rows(rows)]
    log(f"  eTenders portal ({status}): {len(rels)} tenders read (portal total {total})")
    return rels


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--status", default="advertised", choices=sorted(STATUS_CODES))
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--since-days", type=int, default=None, help="cancelled: only cancellations in the last N days")
    ap.add_argument("--buyer", default=None)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    since = (datetime.datetime.now(sh.SAST) - datetime.timedelta(days=args.since_days)) if args.since_days else None
    rels = fetch_releases(args.status, limit=args.limit, since=since)
    if args.buyer:
        rels = [r for r in rels if r["buyer"] and args.buyer.lower() in r["buyer"].lower()]
    for r in rels[:25]:
        extra = f"  CANCELLED: {r['cancellation']['reason']}" if r.get("cancellation") else ""
        print(f"  {r['contract_number'] or '-':>24}  closes {r['closing_date'] or '-':<25}  {r['buyer']}  -  {(r['title'] or '')[:60]}{extra}")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(rels, f, indent=2)
        print(f"Wrote {args.out} ({len(rels)} tenders)")


if __name__ == "__main__":
    main()
