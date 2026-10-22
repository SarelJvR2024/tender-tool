"""
Stream 5 (discovery), outcome layer: who won a tender, at what price, and who
else bid - Deep-Dive items 17 and 28.

Why this is not etenders_national.py: the OCDS API's `awards`/`contracts` are
empty. Re-checked 2026-10-17 on 800 releases across five windows (Oct 2026
back to Nov 2025): 0 awards, 0 contracts, 0 tenderers, 0 tender values, no
`parties` roles, every release tagged only "compiled". The award data exists,
just not in the OCDS feed. Two public sources carry it (all checks on the
record in docs/specs/Award-Outcomes-Findings.md):

1. The eTenders portal's own "Awarded" tab (www.etenders.gov.za, National
   Treasury). The public page's DataTable reads
       GET /Home/TenderFilter/?draw=1&start=N&length=N&status=2[&department=ID]
   (status 2 = awarded; department = the portal's organ-of-state id, e.g. 618
   = SANRAL). No login, no CAPTCHA, no robots.txt, no terms page; the only
   policy document is a POPIA privacy statement. 35,316 awarded tenders on
   2026-10-17. Each row carries the winning supplier(s), award amount, award
   date and enterprise type, and some carry the bidders list with amounts.
   The row's numeric `id` is the OCDS `tender.id`, so its OCDS ocid is
   "ocds-9t57fa-<id>" (205 of 275 active portal rows matched the OCDS sample
   by that rule; the OCDS release's `tender.title` holds the bid number).
   Two real upstream faults, handled here: some single records make the
   server return HTTP 500 for the whole page (we re-read that page one record
   at a time and skip only the broken record), and the same award is often
   entered twice (once as "678228,5", once as "R678 228,50") - deduplicated
   by supplier + parsed amount.

2. SANRAL's own "Awarded tenders" and "Closed tenders" lists (nra.co.za, the
   same AJAX list endpoint list_tenders.py reads, list_slug changed). Each
   detail page shows Awarded To, B-BBEE points, total points, approved
   contract amount, award date and - on most awarded and many closed pages -
   the tender opening register: every tenderer and the amount tendered,
   published before the award. robots.txt allows everything. SANRAL's Terms
   & Conditions permit reproduction "provided that SANRAL is acknowledged as
   the copyright owner", the material is not modified or used prejudicially,
   and "no charge ... is made upon any recipient of the material" - see the
   findings doc: internal bid intelligence is fine; selling this data on is
   a decision for Sarel. Every SANRAL record carries the attribution.
   The reCAPTCHA on these pages guards only the document download form
   (detail.py, download_documents.py) - nothing here touches it. A register
   that says "REFER TO ATTACHED OPENING REGISTER" points at a file inside the
   gated download; it is reported as such and not fetched.

Data minimisation (POPIA): kept - company names, amounts, dates, points,
enterprise type, B-BBEE level. Dropped at parse time - the portal's contact
person, contact number, buyer official's email/telephone and createdBy/
updatedBy, and SANRAL's "Tenders Opened by" / "Tender Recorded by" /
"In Attendance" (names of individual officials). None of those are needed to
answer "who won, at what price, who else bid".

Report-only, like etenders_national.py: writes a JSON report. Storing it is
store_award_outcomes.py's job (public_tender_outcomes, migration 0053 - see
docs/specs/Award-Price-Analysis-Findings.md).

Usage:
    python3 award_outcomes.py [--source portal|sanral|both] [--limit 200]
        [--department 618] [--buyer TEXT] [--sanral-lists awarded,closed]
        [--sanral-limit 40] [--out report.json]
"""
import argparse
import datetime
import html
import http.client
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from list_tenders import USER_AGENT, fetch_tenders  # noqa: E402

PORTAL_FILTER_URL = "https://www.etenders.gov.za/Home/TenderFilter/"
PORTAL_AWARDED_PAGE = "https://www.etenders.gov.za/Home/opportunities?id=2"
PORTAL_AWARDED_STATUS = 2
OCID_PREFIX = "ocds-9t57fa-"
SANRAL_BASE = "https://www.nra.co.za"
SANRAL_DEPARTMENT_ID = 618  # "South African National Roads Agency Soc Limited (SANRAL)" in the portal's list
SANRAL_ATTRIBUTION = ("Source: SANRAL (nra.co.za), copyright SANRAL; reproduced unmodified "
                      "with acknowledgement under SANRAL's website Terms & Conditions.")
SANRAL_LISTS = {"awarded": "awarded-tenders", "closed": "closed-tenders"}
MAX_PORTAL_PAGES = 400       # hard stop against a live government site
MAX_FAILED_PAGES_IN_A_ROW = 3


# ---------------------------------------------------------------- parsing

def parse_rand(raw):
    """Rand text as published -> float, or None. Seen on 2026-10-17:
    "R551 189,00" (NBSP thousands), "678228,5", "R 274 589 809.84",
    "R274,389,252.50", "R 75 720 000.00 (Including VAT.)", "-", "0.00".
    The last "," or "." followed by 1-2 digits at the end is the decimal
    separator; every other separator is a thousands separator."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    s = str(raw).replace("\xa0", " ")
    s = re.sub(r"\(.*?\)", " ", s)  # "(Including VAT.)"
    s = re.sub(r"[^0-9,.]", "", s)
    if not re.search(r"\d", s):
        return None
    m = re.search(r"[,.](\d{1,2})$", s)
    if m:
        whole, frac = s[:m.start()], m.group(1)
    else:
        whole, frac = s, "0"
    whole = re.sub(r"[,.]", "", whole) or "0"
    try:
        return float(f"{int(whole)}.{frac}")
    except ValueError:
        return None


def parse_portal_date(raw):
    """"2026-10-14T00:00:00" -> "2026-10-14"; the portal's "no date"
    placeholders 0001-01-01 / 1900-01-01 -> None."""
    if not raw or raw.startswith(("0001-01-01", "1900-01-01")):
        return None
    return raw[:10]


def parse_sanral_date(raw):
    """"21 April 2022" -> "2022-04-21". Also seen: "08.12.2021", "19-June-2026",
    "03/08/2021" (day first, South African order). Typos ("24 JANAUARY 2023")
    and multi-package text -> None; the raw text is always kept."""
    for fmt in ("%d %B %Y", "%d %b %Y", "%Y/%m/%d", "%Y-%m-%d",
                "%d.%m.%Y", "%d-%B-%Y", "%d/%m/%Y"):
        try:
            return datetime.datetime.strptime((raw or "").strip(), fmt).date().isoformat()
        except ValueError:
            continue
    return None


def clean_name(raw):
    """Supplier names as typed by buyers: stray spaces, wrapped in
    parentheses ("(MINATLOU TRADING 124)"), numbered ("5. Klipcorp")."""
    s = re.sub(r"\s+", " ", html.unescape(raw or "")).strip()
    if s.startswith("(") and s.endswith(")"):
        s = s[1:-1].strip()
    s = re.sub(r"^\d{1,3}\s*[.)]\s*", "", s)
    return s


def _cell_text(fragment):
    t = re.sub(r"<[^>]+>", " ", fragment)
    t = html.unescape(t).replace("\xa0", " ")
    return re.sub(r"\s+", " ", t).strip()


def normalize_portal_award(row):
    """One eTenders portal awarded row -> the fields this feature needs.
    Contact people, phone numbers and officials' emails are dropped here."""
    awards, seen = [], set()
    for a in row.get("awards") or []:
        if a.get("isDeleted"):
            continue
        name = clean_name(a.get("company"))
        amount = parse_rand(a.get("tenderAmount"))
        key = (name.upper(), amount)
        if not name or key in seen:
            continue
        seen.add(key)
        awards.append({
            "supplier": name,
            "amount_zar": amount,
            "amount_raw": a.get("tenderAmount"),
            "enterprise_type": a.get("enterpriseType") or None,
            "award_date": parse_portal_date(a.get("awardDate")),
        })
    bidders, seen = [], set()
    for b in row.get("bidders") or []:
        if b.get("isDeleted"):
            continue
        name = clean_name(b.get("biddersName"))
        amount = parse_rand(b.get("amount"))
        key = (name.upper(), amount)
        if not name or key in seen:
            continue
        seen.add(key)
        bidders.append({"bidder": name, "amount_zar": amount})
    portal_id = row.get("id")
    return {
        "source": "etenders_portal_awarded",
        "source_url": PORTAL_AWARDED_PAGE,
        "portal_id": portal_id,
        "ocid": f"{OCID_PREFIX}{portal_id}" if portal_id is not None else None,
        "bid_number": (row.get("tender_No") or "").strip() or None,
        "buyer": row.get("organ_of_State"),
        "title": row.get("description"),
        "category": row.get("category"),
        "procurement_type": row.get("type"),
        "province": row.get("province"),
        "published": parse_portal_date(row.get("date_Published")),
        "closing_date": parse_portal_date(row.get("closing_Date")),
        "award_date": parse_portal_date(row.get("awardDate")),
        "awards": awards,
        "bidders": bidders,
    }


LABEL_ROW_RE = re.compile(
    r"<td[^>]*>\s*<strong>\s*([^<:]+?)\s*:?\s*</strong>(?:\s|&nbsp;)*</td>\s*<td[^>]*>(.*?)</td>", re.S)
TABLE_RE = re.compile(r"<table\b.*?</table>", re.S)
ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
CELL_RE = re.compile(r"<t[dh][^>]*>(.*?)</t[dh]>", re.S)
TENDERER_HEADER_RE = re.compile(r"Tenderer(?:'|&#39;|&rsquo;|’)?s\s+Name", re.I)
REFER_RE = re.compile(r"REFER\s+TO\s+(?:THE\s+)?ATTACHED", re.I)

# Kept from SANRAL's result table. "Tenders Opened by", "Tender Recorded by"
# and "In Attendance" (individual officials) are deliberately not read.
SANRAL_FIELDS = {
    "Awarded To": "awarded_to",
    "BBBEE Points": "bbbee_points",
    "Full Points Awarded": "full_points",
    "Approved Contract Amount": "approved_contract_amount_raw",
    "Awarded On": "awarded_on_raw",
    "Contract Start Date": "contract_start_date_raw",
    "Contract Duration": "contract_duration",
    "Consultant": "consultant",
    "Estimate": "estimate_raw",
}


def parse_opening_register(table_html):
    """SANRAL's opening register: the header row decides the columns, because
    they vary per tender ("Amount Tendered", or one "Amount Tendered For
    <contract>" column per contract in a batch, plus BBBEE / Alt Tender /
    Notes). Returns (rows, note)."""
    rows = [[_cell_text(c) for c in CELL_RE.findall(r)] for r in ROW_RE.findall(table_html)]
    rows = [r for r in rows if any(r)]
    if not rows:
        return [], None
    header, body = rows[0], rows[1:]
    if any(REFER_RE.search(c) for r in body for c in r):
        return [], "Register published only as an attachment inside the tender download (not fetched)."
    out = []
    for r in body:
        r = r + [""] * (len(header) - len(r))
        name = clean_name(r[0])
        if not name or REFER_RE.search(name):
            continue
        entry = {"tenderer": name, "amounts": []}
        for col, val in zip(header[1:], r[1:]):
            low = col.lower()
            if low.startswith("amount"):
                entry["amounts"].append({
                    "column": col,
                    "amount_raw": val or None,
                    "amount_zar": parse_rand(val),
                })
            elif "bbbee" in low or "b-bbee" in low:
                entry["bbbee"] = val or None
            elif low.startswith("alt"):
                entry["alt_tender"] = val or None
            elif low.startswith("note"):
                entry["notes"] = val or None
        out.append(entry)
    return out, None


def parse_sanral_result_page(body):
    """A SANRAL awarded/closed detail page -> award fields + opening register."""
    fields = {}
    for label, value in LABEL_ROW_RE.findall(body):
        key = SANRAL_FIELDS.get(html.unescape(label).strip())
        if key and key not in fields:
            fields[key] = _cell_text(value) or None
    title_m = re.search(r"<h3>(.*?)</h3>", body, re.S)
    register, note = [], None
    for t in TABLE_RE.findall(body):
        if TENDERER_HEADER_RE.search(t):
            register, note = parse_opening_register(t)
            break
    return {
        "title": _cell_text(title_m.group(1)) if title_m else None,
        "awarded_to": fields.get("awarded_to"),
        "bbbee_points": fields.get("bbbee_points"),
        "full_points": fields.get("full_points"),
        "approved_contract_amount_raw": fields.get("approved_contract_amount_raw"),
        "approved_contract_amount_zar": parse_rand(fields.get("approved_contract_amount_raw")),
        "awarded_on_raw": fields.get("awarded_on_raw"),
        "awarded_on": parse_sanral_date(fields.get("awarded_on_raw")),
        "contract_start_date_raw": fields.get("contract_start_date_raw"),
        "contract_duration": fields.get("contract_duration"),
        "consultant": fields.get("consultant"),
        "estimate_raw": fields.get("estimate_raw"),
        "estimate_zar": parse_rand(fields.get("estimate_raw")),
        "opening_register": register,
        "opening_register_note": note,
    }


# ---------------------------------------------------------------- fetching

def _get(url, headers, retries=3, backoff=2.0, timeout=60):
    """A full backfill run against SANRAL's site crashed on an uncaught
    http.client.IncompleteRead (2026-10-22 - the live site cut a response
    short mid-chunk) - that exception type isn't a URLError/HTTPError/
    TimeoutError/ConnectionError, so it wasn't retried, it killed the whole
    multi-hour process. http.client.HTTPException covers IncompleteRead and
    its siblings (BadStatusLine, RemoteDisconnected, etc.) the same way."""
    last_err = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers),
                                        timeout=timeout) as r:
                return r.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ConnectionError,
                http.client.HTTPException) as e:
            last_err = e
            time.sleep(backoff * (attempt + 1))
    raise RuntimeError(f"{url}: failed after {retries} attempts: {last_err}")


def portal_page(start, length, department=None, retries=3):
    params = {"draw": 1, "start": start, "length": length, "status": PORTAL_AWARDED_STATUS}
    if department:
        params["department"] = department
    body = _get(PORTAL_FILTER_URL + "?" + urllib.parse.urlencode(params),
                {"User-Agent": USER_AGENT, "X-Requested-With": "XMLHttpRequest"},
                retries=retries)
    return json.loads(body)


def fetch_portal_awarded(limit=200, department=None, page_size=25, pause=0.5, start=0):
    """Newest-first pages of the portal's Awarded tab, up to `limit` rows,
    starting at result offset `start` (for a chunked, resumable backfill -
    see run_sanral_backfill.py's docstring on why a one-shot fetch of the
    whole tab is unsafe: it can run far longer than this environment stays
    up, and nothing was ever resumable from mid-fetch before this).
    Returns (rows, records_filtered, skipped_broken_records, next_start) -
    next_start is None once the tab is exhausted."""
    rows, total, skipped, failed_in_a_row = [], None, 0, 0
    exhausted = False
    for _ in range(MAX_PORTAL_PAGES):
        if len(rows) >= limit or (total is not None and start >= total):
            exhausted = total is not None and start >= total
            break
        try:
            data = portal_page(start, page_size, department)
            batch, total = data.get("data") or [], data.get("recordsFiltered", total)
            failed_in_a_row = 0
        except RuntimeError:
            # One broken record 500s the whole page: read it one at a time.
            batch = []
            for i in range(start, start + page_size):
                try:
                    data = portal_page(i, 1, department, retries=2)
                    batch += data.get("data") or []
                    total = data.get("recordsFiltered", total)
                except RuntimeError:
                    skipped += 1
            failed_in_a_row = failed_in_a_row + 1 if not batch else 0
            if failed_in_a_row >= MAX_FAILED_PAGES_IN_A_ROW:
                print(f"  WARNING: portal kept failing from record {start}; stopping with "
                      f"{len(rows)} rows.", file=sys.stderr)
                break
        if not batch and total is None:
            exhausted = True
            break
        rows += batch
        start += page_size
        time.sleep(pause)
    # Don't truncate to `limit` here - page_size may not divide limit evenly,
    # so rows[:limit] could silently drop already-fetched rows that `start`
    # (the next chunk's resume point) has already moved past, the same
    # gap/overshoot bug fixed for fetch_sanral_list/fetch_sanral_outcomes.
    return rows, total, skipped, (None if exhausted else start)


def fetch_sanral_list(list_slug, want=None, page_size=50, max_pages=40, retries=3, start_page=1):
    """Rows of one SANRAL public list, newest first, until `want` rows (or the
    end). Pages come back shorter than page_size (observed: 25/36/10 rows for
    pageSize=40, total_filtered 90), so keep paging until a page brings
    nothing new. A dropped connection is retried, then ends the list early
    with what was read (seen 2026-10-17: one reset killed a whole run).

    `start_page` resumes a backfill from a later page instead of always
    re-reading from the newest tender: a full backfill of a large list
    (the SANRAL closed list alone holds 5,546 tenders) can't safely fetch
    every detail page (fetch_sanral_outcomes's own 1s/page pause) in one run,
    so a caller runs this in bounded chunks, each one storing its own rows
    before the next chunk starts - never fetching one giant batch and only
    writing at the very end, which would lose everything if the process
    were stopped partway through."""
    seen, out, total_filtered = set(), [], None
    next_page = start_page
    for page in range(start_page, start_page + max_pages):
        if want is not None and len(out) >= want:
            next_page = page
            break
        rows = None
        for attempt in range(retries):
            try:
                rows, _, total_filtered = fetch_tenders(page_size=page_size, page_index=page,
                                                        list_slug=list_slug)
                break
            except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError,
                    http.client.HTTPException) as e:
                err = e
                time.sleep(2.0 * (attempt + 1))
        if rows is None:
            print(f"  WARNING: {list_slug} page {page} failed ({err}); keeping {len(out)} rows.",
                  file=sys.stderr)
            next_page = page  # failed page: a resumed run retries it, not skips it
            break
        new = [r for r in rows if r.get("detail_url") and r["detail_url"] not in seen]
        if not new:
            next_page = None  # list genuinely exhausted - nothing left to resume
            break
        for r in new:
            seen.add(r["detail_url"])
        out += new
        next_page = page + 1
    return out, total_filtered, next_page


def fetch_sanral_outcomes(list_key, limit=40, pause=1.0, start_page=1):
    slug = SANRAL_LISTS[list_key]
    # fetch_sanral_list's own max_pages defaults to 40 (* page_size 50 = 2000
    # rows), silently truncating a full backfill asking for more than that
    # (the SANRAL closed list alone holds 5,546). Pages also come back
    # shorter than page_size sometimes (fetch_sanral_list's own docstring),
    # so size generously rather than exactly. `start_page` resumes a chunked
    # backfill (see fetch_sanral_list's own docstring) - `limit` is this
    # chunk's own size, not the grand total.
    max_pages = max(40, -(-limit // 50) + 20)
    rows, total_filtered, next_page = fetch_sanral_list(slug, want=limit, max_pages=max_pages, start_page=start_page)
    records, failed = [], []
    # Not rows[:limit]: fetch_sanral_list's own `want` check can overshoot by
    # up to a page's worth of rows (it checks before reading the next page,
    # not mid-page), and next_page already reflects every row in `rows` as
    # "listed, resume after here" - truncating here would detail-fetch fewer
    # rows than that, leaving a silent gap no resumed chunk would ever cover.
    for row in rows:
        try:
            body = _get(row["detail_url"], {"User-Agent": USER_AGENT}).decode("utf-8", "replace")
        except RuntimeError as e:
            failed.append({"detail_url": row["detail_url"], "error": str(e)})
            continue
        parsed = parse_sanral_result_page(body)
        records.append({
            "source": f"sanral_{list_key}",
            "source_url": row["detail_url"],
            "attribution": SANRAL_ATTRIBUTION,
            "reference": row.get("reference"),
            "project_type": row.get("project_type"),
            "province": row.get("province"),
            "closing_date_raw": row.get("closing_date"),
            **parsed,
        })
        time.sleep(pause)
    return {"list": slug, "total_filtered": total_filtered, "rows_listed": len(rows),
            "fetched": len(records), "failed": failed, "records": records, "next_page": next_page}


# ---------------------------------------------------------------- report

def summarize_portal(records):
    return {
        "fetched": len(records),
        "with_winner": sum(1 for r in records if r["awards"]),
        # `is not None`, not a truthiness check: a genuine R0,00 award (seen
        # live, 2026-10-18 - a disciplinary-matter bid number) is a real
        # amount on file, not a missing one, and the per-award print line a
        # few lines down already gets this right ("R{amount:,.2f}" guarded by
        # `is not None`) - this summary count was the one place that didn't.
        "with_award_amount": sum(1 for r in records if any(a["amount_zar"] is not None for a in r["awards"])),
        "with_bidders_list": sum(1 for r in records if r["bidders"]),
        "with_award_date": sum(1 for r in records if r["award_date"]),
    }


def summarize_sanral(block):
    recs = block["records"]
    return {
        "fetched": len(recs),
        "with_winner": sum(1 for r in recs if r["awarded_to"]),
        # Same `is not None` fix as summarize_portal()'s with_award_amount,
        # for the same reason: a genuine R0,00 contract amount must still
        # count as "on file", not get mistaken for a missing one.
        "with_contract_amount": sum(1 for r in recs if r["approved_contract_amount_zar"] is not None),
        "with_opening_register": sum(1 for r in recs if r["opening_register"]),
        "register_only_as_attachment": sum(1 for r in recs if r["opening_register_note"]),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", choices=["portal", "sanral", "both", "capetown", "eskom", "all"], default="both",
                    help="both = portal + sanral (unchanged default); capetown = City of Cape Town RFQ "
                         "awards (capetown_procurement.py: supplier per RFQ, no amount published); "
                         "eskom = Eskom Tender Bulletin award / bidders-list / regret notices "
                         "(eskom_bulletin.py: the notice and its document links); all = every source")
    ap.add_argument("--capetown-limit", type=int, default=50, help="Cape Town award notices to read (default 50)")
    ap.add_argument("--limit", type=int, default=200,
                    help="eTenders portal awarded rows to read, newest first (default 200)")
    ap.add_argument("--department", type=int, default=None,
                    help=f"eTenders portal organ-of-state id (e.g. {SANRAL_DEPARTMENT_ID} = SANRAL)")
    ap.add_argument("--buyer", default=None,
                    help="case-insensitive substring filter on the portal buyer name (after fetching)")
    ap.add_argument("--sanral-lists", default="awarded,closed",
                    help="which SANRAL lists to read: awarded, closed or both (default both)")
    ap.add_argument("--sanral-limit", type=int, default=40,
                    help="SANRAL detail pages to read per list (default 40, 1 s apart)")
    ap.add_argument("--out", default=None, help="write the full report to this JSON file")
    args = ap.parse_args()

    report = {"generated_at": datetime.datetime.now().isoformat()}

    if args.source in ("portal", "both", "all"):
        print("Reading the eTenders portal's Awarded tab...", file=sys.stderr)
        raw, total, skipped, _ = fetch_portal_awarded(args.limit, args.department)
        recs = [normalize_portal_award(r) for r in raw]
        if args.buyer:
            needle = args.buyer.lower()
            recs = [r for r in recs if r["buyer"] and needle in r["buyer"].lower()]
        summary = summarize_portal(recs)
        print(f"  {total} awarded on the portal (this filter); read {len(raw)}, "
              f"skipped {skipped} broken record(s). {summary}", file=sys.stderr)
        for r in recs[:10]:
            win = "; ".join(f"{a['supplier']} R{a['amount_zar']:,.2f}" if a["amount_zar"] is not None
                            else a["supplier"] for a in r["awards"]) or "-"
            print(f"  {r['award_date'] or '?':>10}  {r['buyer']}  {r['bid_number']}  ->  {win}",
                  file=sys.stderr)
        report["portal"] = {"department": args.department, "buyer_filter": args.buyer,
                            "records_filtered": total, "skipped_broken_records": skipped,
                            "summary": summary, "records": recs}

    if args.source in ("capetown", "all"):
        import capetown_procurement
        recs = capetown_procurement.fetch_awards(limit=args.capetown_limit,
                                                 log=lambda m: print(m, file=sys.stderr))
        report["capetown"] = {"records": recs, "with_supplier": sum(1 for r in recs if r.get("supplier"))}

    if args.source in ("eskom", "all"):
        import eskom_bulletin
        rels = eskom_bulletin.fetch_releases(with_documents=False, log=lambda m: print(m, file=sys.stderr))
        keep = ("award", "bidders_list", "regret")
        notices = [{"kind": r["notice_kind"], "reference": r["contract_number"],
                    "refers_to_reference": r["refers_to_reference"], "title": r["title"], "buyer": r["buyer"],
                    "published_date": r["published_date"], "url": r["source_url"],
                    "documents_api": f"{eskom_bulletin.API}/Files/GetDocs?TENDER_ID={r['source_id']}"}
                   for r in rels if r.get("notice_kind") in keep]
        report["eskom"] = {"notices": notices,
                           "counts": {k: sum(1 for n in notices if n["kind"] == k) for k in keep}}
        print(f"  Eskom award/bidders-list/regret notices: {report['eskom']['counts']}", file=sys.stderr)

    if args.source in ("sanral", "both", "all"):
        report["sanral"] = {}
        for key in [k.strip() for k in args.sanral_lists.split(",") if k.strip()]:
            print(f"Reading SANRAL's {SANRAL_LISTS[key]} list...", file=sys.stderr)
            block = fetch_sanral_outcomes(key, args.sanral_limit)
            block["summary"] = summarize_sanral(block)
            print(f"  {block['total_filtered']} on the list, {block['rows_listed']} listed, "
                  f"read {block['fetched']}. {block['summary']}", file=sys.stderr)
            report["sanral"][key] = block

    if args.out:
        with open(args.out, "w") as f:
            json.dump(report, f, indent=2)
        print(f"Wrote {args.out}", file=sys.stderr)
    else:
        json.dump(report, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
