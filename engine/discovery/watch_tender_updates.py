"""
Tender-update watch: new documents added to a tender after it was discovered
(addenda, clarifications, changed closing/briefing dates, cancellations), read
and classified, and reported ONLY to the companies actively pursuing that
tender. The 4th watch of the same shape as watch_new_tenders.py,
watch_deadlines.py and the daily digest: find what's worth telling someone,
report it, never report it twice.

Sarel, 2026-10-17: "we need to monitor any new documents that gets added to
eTenders to see what they contain, if it's potentially addendums ... any
customer that is actively busy on a tender, any new information about that
tender, we need to warn them or inform them about it ... changes of closing
dates ... might also allow someone to tender for something if they have more
time."

Which tenders are watched: every tender with at least one tender_packs row at
pipeline_stage found / bidding / submitted ("actively pursuing"), still open
(closing date on file not more than WATCH_DAYS_AFTER_CLOSING days ago - an
extension can arrive after the original date). A tender_packs row only exists
once a company has acted on the tender - "Prepare this tender" on Discovery
(pursue_discovered_opportunity, 0018), a first move on the Pipeline board
(0021), a manual load (0024) - so a tender merely showing in a company's
Discovery feed is NOT watched for it and never alerts it. won/lost are done;
submitted stays in, because an addendum issued before closing can still
require a resubmission or an acknowledgement.

Where each tender is re-read:
  - eTenders (tenders.ocid): the tender's own OCDS release. Every document in
    a release has a stable id plus datePublished/dateModified (confirmed live
    2026-10-17: ocds-9t57fa-174359's release is dated 2026-10-16, and
    "Wte1062-Addendum.pdf" was added to it on 2026-10-17 14:55 without the
    release date changing). The API's single-release endpoint
    (/api/OCDSReleases/release/{ocid}) answers HTTP 500, so the watch reads the
    one-day window of the release date (tender_watch_state.release_date),
    then the last RECENT_DAYS days (a release that was re-dated), then walks
    back from the discovery date. A day fetched once is reused for every
    tender in the run. Reuses etenders_national.fetch_releases().
  - SANRAL (source 'sanral', tenders.slug): SANRAL's own tender page through
    detail.fetch_detail() - its "Attached Files" list (names only: the files
    are behind the reCAPTCHA form, so a new SANRAL file is classified from its
    name and the pursuer is told to download it) and its closing date.
  - A manual tender (0024) with no OCDS id has no public source to re-read.

Known documents (tender_watched_documents, 0039): the first look at a tender
records what is there as baseline - except that, for an eTenders tender,
anything NOT in tenders.document_urls (the links stored when it was
pursued from Discovery) was added after discovery and is reported. Every later
look reports what wasn't known before. A replaced file (same OCDS id, later
dateModified) is a new document.

Reading: a new eTenders document is downloaded and read with the general
engine's own pipeline (engine/general/requirements.py collect_documents +
read_document: PDF text, .docx, LibreOffice for .doc, zips unpacked, OCR for
scans) and classified by tender_updates.classify_document().

Closing date: written to tenders.closing_date (plus every company's "Tender
closes" milestone, and discovered_opportunities rows with the same ocid) ONLY
when the listing agrees with the document. See 0039's header.

Notifications (tender_update_notifications, 0039 - the seen store, in the
database): one row per (company, document) the first time the watch reports
it to that company. The run's alert report (--out) lists, per company, the
updates new to it, critical first (cancellation, closing date brought
forward), then high (addenda, a later closing date, a moved briefing), then
info (a plain supporting document). Like the other watches, nothing here
sends an e-mail; the scheduled check-in that sends the other watches' output
reads this one too. The daily digest picks up the same updates (digested_at)
for anyone who missed the alert - pending_digest_updates()/mark_digested().

Why its own run, not just a digest section: the digest is daily; a closing
date brought forward or a briefing moved three days out (WTE1063CE: 21 -> 23
October, published 17 October) can't wait for tomorrow's e-mail. The watch
only touches pursued tenders (a handful of one-day OCDS windows and SANRAL
pages per run), so it is cheap to run every couple of hours.

Usage:
    python3 watch_tender_updates.py [--out alerts.json] [--work-dir DIR]
        (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
"""
import argparse
import datetime
import json
import os
import re
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "general"))
import etenders_national  # noqa: E402
import tender_updates  # noqa: E402

ACTIVE_STAGES = ("found", "bidding", "submitted")
WATCH_DAYS_AFTER_CLOSING = 7
RECENT_DAYS = 3
WALK_BACK_DAYS = 21
URGENCY_ORDER = {"critical": 0, "high": 1, "info": 2}
SAST = datetime.timezone(datetime.timedelta(hours=2))


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

class OcdsDays:
    """One-day OCDS windows, each fetched at most once per run."""

    def __init__(self, fetch_day=None):
        self.fetch_day = fetch_day or (lambda d: etenders_national.fetch_releases(d.isoformat(), d.isoformat()))
        self.cache = {}

    def releases(self, day):
        if day not in self.cache:
            try:
                self.cache[day] = self.fetch_day(day)
            except Exception as e:  # one bad day must not end the run
                print(f"  OCDS {day}: fetch failed ({e})")
                self.cache[day] = []
        return self.cache[day]

    def find(self, ocid, known_day, discovered_day, today):
        tried = []
        candidates = ([known_day] if known_day else []) + [today - datetime.timedelta(days=i) for i in range(RECENT_DAYS)]
        start = discovered_day or today
        candidates += [start - datetime.timedelta(days=i) for i in range(WALK_BACK_DAYS + 1)]
        for day in candidates:
            if day in tried:
                continue
            tried.append(day)
            for r in self.releases(day):
                if r.get("ocid") == ocid:
                    return r, day
        return None, None


def ocds_documents(release):
    out = []
    for d in ((release.get("tender") or {}).get("documents") or []):
        ident = d.get("id") or d.get("url")
        if not ident:
            continue
        stamp = d.get("dateModified") or d.get("datePublished") or ""
        out.append({"doc_key": f"{ident}@{stamp}", "doc_id": ident, "title": d.get("title") or d.get("description"),
                    "url": d.get("url"), "date_published": d.get("datePublished"), "date_modified": d.get("dateModified"),
                    "format": d.get("format")})
    return out


def sanral_documents(page):
    return [{"doc_key": f"sanral:{name}", "doc_id": name, "title": name, "url": page.get("url"),
             "date_published": None, "date_modified": None, "format": None} for name in page.get("attached_files") or []]


def _sanral_closing(page):
    c = (page.get("closing_date") or "").strip()
    m = re.match(r"(\d{4})/(\d{2})/(\d{2})(?:\s+(\d{1,2}):(\d{2}))?", c)
    if not m:
        return None
    y, mo, d, h, mi = m.groups()
    return datetime.datetime(int(y), int(mo), int(d), int(h or 12), int(mi or 0), tzinfo=SAST).isoformat()


# ---------------------------------------------------------------------------
# Reading one new document
# ---------------------------------------------------------------------------

def _http_get(url):
    import urllib.request
    r = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (tender-tool update watch)"})
    with urllib.request.urlopen(r, timeout=90) as resp:
        return resp.read()


def read_new_document(doc, work_dir, fetch=None):
    """(text, read_basis, error). Downloads the document and reads it with the
    general engine's requirements.read_document (zips unpacked, OCR for scans).
    Never raises: a document that can't be read is classified from its name."""
    if not doc.get("url") or doc.get("doc_key", "").startswith("sanral:"):
        return "", "title_only", ("SANRAL's documents are behind its download form (reCAPTCHA) - download it from the tender page"
                                  if doc.get("doc_key", "").startswith("sanral:") else "no download link")
    import requirements  # engine/general - imported here: it pulls in the OCR module
    fetch = fetch or _http_get
    name = re.sub(r"[^A-Za-z0-9._ ()-]+", "_", doc.get("title") or "document")[:120] or "document"
    if "." not in name[-6:]:
        name += "." + (doc.get("format") or "pdf")
    d = tempfile.mkdtemp(dir=work_dir)
    path = os.path.join(d, name)
    try:
        with open(path, "wb") as f:
            f.write(fetch(doc["url"]))
    except Exception as e:
        return "", "title_only", f"download failed ({e})"
    try:
        texts, ocr, errors = [], False, []
        for item in requirements.collect_documents([path], d):
            if item.get("unreadable"):
                errors.append(f"{item['name']}: {item['unreadable']}")
                continue
            requirements.read_document(item, d)
            if item.get("unreadable"):
                errors.append(f"{item['name']}: {item['unreadable']}")
            if item.get("ocr"):
                ocr = True
            texts.append(item.get("text") or "")
        text = "\n\f".join(t for t in texts if t)
        if len(text.strip()) < 50:
            return "", "title_only", "; ".join(errors) or "no readable text in it"
        return text, ("ocr" if ocr else "text"), ("; ".join(errors) or None)
    except Exception as e:
        return "", "title_only", f"could not read it ({type(e).__name__}: {e})"
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ---------------------------------------------------------------------------
# One tender
# ---------------------------------------------------------------------------

def _one(rows):
    return rows[0] if rows else None


def _discovered_day(client, tender):
    days = []
    if tender.get("ocid"):
        for r in client.select("discovered_opportunities", {"ocid": tender["ocid"]}):
            if r.get("first_seen"):
                days.append(tender_updates.to_date(r["first_seen"]))
    if tender.get("created_at"):
        days.append(tender_updates.to_date(tender["created_at"]))
    days = [d for d in days if d]
    return min(days) if days else None


def apply_closing_date(client, tender, new_closing_iso):
    """The closing date on file, everywhere it is copied: tenders, every
    company's auto-seeded "Tender closes" milestone (0009 kind 'closing' - the
    page's ensureClosingMilestone() never overwrites an existing one), and the
    Discovery rows for the same OCDS release."""
    client.update("tenders", {"id": tender["id"]}, {"closing_date": new_closing_iso})
    day = tender_updates.to_date(new_closing_iso).isoformat()
    for t in client.select("tender_tasks", {"tender_id": tender["id"], "kind": "closing"}):
        client.update("tender_tasks", {"id": t["id"]}, {"due_date": day})
    if tender.get("ocid"):
        for r in client.select("discovered_opportunities", {"ocid": tender["ocid"]}):
            client.update("discovered_opportunities", {"id": r["id"]}, {"closing_date": new_closing_iso})


def check_tender(client, tender, today, ocds, fetch_sanral=None, fetch_doc=None, work_dir=None, log=print):
    """Re-reads one tender's source, records and classifies every document not
    known before. Returns the new tender_watched_documents rows."""
    state = _one(client.select("tender_watch_state", {"tender_id": tender["id"]})) or {}
    known = {r["doc_key"]: r for r in client.select("tender_watched_documents", {"tender_id": tender["id"]})}
    first_look = not known and not state.get("last_found_at")
    new_state = {"tender_id": tender["id"], "last_checked_at": _now()}

    if tender.get("ocid"):
        known_day = datetime.date.fromisoformat(state["release_date"]) if state.get("release_date") else None
        release, day = ocds.find(tender["ocid"], known_day, _discovered_day(client, tender), today)
        if not release:
            new_state["last_error"] = f"OCDS release {tender['ocid']} not found in the windows read"
            client.upsert("tender_watch_state", [{**state, **new_state}], "tender_id")
            log(f"  {tender.get('contract_no') or tender['id']}: {new_state['last_error']}")
            return []
        current = ocds_documents(release)
        listing_closing = ((release.get("tender") or {}).get("tenderPeriod") or {}).get("endDate")
        source = "etenders_ocds"
        new_state.update({"release_date": day.isoformat(), "last_found_at": _now(), "last_error": None})
    elif tender.get("source") == "sanral" and tender.get("slug"):
        try:
            if fetch_sanral is None:
                import detail
                fetch_sanral = detail.fetch_detail
            page = fetch_sanral(tender["slug"])
        except Exception as e:
            new_state["last_error"] = f"SANRAL page could not be read ({e})"
            client.upsert("tender_watch_state", [{**state, **new_state}], "tender_id")
            log(f"  {tender.get('contract_no')}: {new_state['last_error']}")
            return []
        current = sanral_documents(page)
        listing_closing = _sanral_closing(page)
        source = "sanral_page"
        new_state.update({"last_found_at": _now(), "last_error": None,
                          "sanral_signature": {k: page.get(k) for k in ("file_count", "file_size", "last_updated", "closing_date")}})
    else:
        return []  # a manual tender with no public source

    baseline_urls = {d.get("url") for d in (tender.get("document_urls") or []) if d.get("url")}
    closing_on_file = tender.get("closing_date")
    added = []
    for doc in current:
        if doc["doc_key"] in known:
            continue
        replaced = any(k.split("@", 1)[0] == doc["doc_id"] for k in known) if source == "etenders_ocds" else False
        is_baseline = first_look and (source == "sanral_page" or not baseline_urls or doc["url"] in baseline_urls)
        row = {"tender_id": tender["id"], "doc_key": doc["doc_key"], "source": source, "title": doc["title"],
               "url": doc["url"], "date_published": doc["date_published"], "date_modified": doc["date_modified"],
               "baseline": is_baseline}
        if not is_baseline:
            text, basis, err = read_new_document(doc, work_dir, fetch_doc)
            verdict = tender_updates.classify_document(doc["title"], text, basis, closing_on_file, listing_closing)
            if replaced:
                verdict["summary"] = "Replaced: " + verdict["summary"]
                verdict["changes"].setdefault("caveats", []).append("The buyer replaced an earlier file with this one (same document, newer upload).")
            cd = verdict["changes"].get("closing_date")
            if cd and cd["listing_agrees"] and cd["direction"] in ("later", "earlier") and listing_closing:
                apply_closing_date(client, tender, listing_closing)
                cd["applied"] = True
                closing_on_file = listing_closing
                tender["closing_date"] = listing_closing
            row.update({"kind": verdict["kind"], "read_basis": basis, "urgency": verdict["urgency"],
                        "summary": verdict["summary"], "changes": verdict["changes"], "read_error": err})
            log(f"  {tender.get('contract_no') or tender['id']}: NEW {verdict['kind']} [{verdict['urgency']}] "
                f"{doc['title']!r} ({basis}) - {verdict['summary']}")
        added.append(client.upsert("tender_watched_documents", [row], "tender_id,doc_key")[0])
    client.upsert("tender_watch_state", [{**state, **new_state}], "tender_id")
    return added


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------

def active_pursuits(client, today):
    """{tender_id: (tender, [pack rows at an active stage])} for tenders still
    worth watching."""
    by_tender = {}
    for p in client.select("tender_packs"):
        if p.get("pipeline_stage", "found") in ACTIVE_STAGES:
            by_tender.setdefault(p["tender_id"], []).append(p)
    out = {}
    for tid, packs in by_tender.items():
        tender = _one(client.select("tenders", {"id": tid}))
        if not tender or tender.get("status") in ("cancelled", "awarded"):
            continue
        closing = tender_updates.to_date(tender.get("closing_date"))
        if closing and (today - closing).days > WATCH_DAYS_AFTER_CLOSING:
            continue
        out[tid] = (tender, packs)
    return out


def notify(client, tender, packs, docs):
    """One tender_update_notifications row per (company, update) not reported
    to that company before. Returns {company_id: [doc rows]} newly reported."""
    out = {}
    for p in packs:
        already = {n["watched_document_id"] for n in client.select("tender_update_notifications",
                                                                   {"company_id": p["company_id"], "tender_id": tender["id"]})}
        fresh = [d for d in docs if not d.get("baseline") and d["id"] not in already]
        if not fresh:
            continue
        client.upsert("tender_update_notifications",
                      [{"company_id": p["company_id"], "watched_document_id": d["id"], "tender_id": tender["id"],
                        "pipeline_stage": p.get("pipeline_stage"), "alerted_at": _now()} for d in fresh],
                      "company_id,watched_document_id")
        out[p["company_id"]] = fresh
    return out


def run(client, today=None, fetch_ocds_day=None, fetch_sanral=None, fetch_doc=None, work_dir=None, log=print):
    """The whole watch. Returns the alert report: one entry per company with
    updates new to it, {company_id, legal_name, members, tenders: [{tender,
    pipeline_stage, updates: [...]}]}, most urgent first."""
    today = today or datetime.datetime.now(SAST).date()
    own_work = work_dir is None
    work_dir = work_dir or tempfile.mkdtemp(prefix="tender-updates-")
    ocds = OcdsDays(fetch_ocds_day)
    report = {}
    try:
        pursued = active_pursuits(client, today)
        log(f"{len(pursued)} tender(s) actively pursued by at least one company (stages {', '.join(ACTIVE_STAGES)})")
        for tid, (tender, packs) in pursued.items():
            check_tender(client, tender, today, ocds, fetch_sanral, fetch_doc, work_dir, log)
            docs = [d for d in client.select("tender_watched_documents", {"tender_id": tid}) if not d.get("baseline")]
            for company_id, fresh in notify(client, tender, packs, docs).items():
                entry = report.setdefault(company_id, {"company_id": company_id, "tenders": []})
                stage = next((p.get("pipeline_stage") for p in packs if p["company_id"] == company_id), None)
                entry["tenders"].append({
                    "tender_id": tid, "contract_no": tender.get("contract_no"), "title": tender.get("description") or tender.get("title"),
                    "buyer": tender.get("buyer"), "closing_date_on_file": tender.get("closing_date"), "pipeline_stage": stage,
                    "updates": sorted(({k: d.get(k) for k in ("id", "title", "url", "kind", "urgency", "summary", "changes",
                                                                 "read_basis", "read_error", "first_seen_at")} for d in fresh),
                                      key=lambda u: (URGENCY_ORDER.get(u["urgency"], 3), u.get("first_seen_at") or "")),
                })
    finally:
        if own_work:
            shutil.rmtree(work_dir, ignore_errors=True)
    for company_id, entry in report.items():
        company = _one(client.select("companies", {"id": company_id})) or {}
        entry["legal_name"] = company.get("legal_name")
        entry["members"] = [{"user_id": m["user_id"], "tender_role": m.get("tender_role")}
                            for m in client.select("company_members", {"company_id": company_id})]
        entry["tenders"].sort(key=lambda t: min(URGENCY_ORDER.get(u["urgency"], 3) for u in t["updates"]))
        entry["most_urgent"] = min((u["urgency"] for t in entry["tenders"] for u in t["updates"]),
                                   key=lambda u: URGENCY_ORDER.get(u, 3))
    return sorted(report.values(), key=lambda e: (URGENCY_ORDER.get(e["most_urgent"], 3), e.get("legal_name") or ""))


# ---------------------------------------------------------------------------
# Daily digest hook: the same updates, once more in the next digest, for a
# company that missed the alert. Items carry company_id like every other
# digest section, so the digest's per-company filter applies unchanged.
# ---------------------------------------------------------------------------

def pending_digest_updates(client):
    out = []
    for n in client.select("tender_update_notifications"):
        if n.get("digested_at"):
            continue
        doc = _one(client.select("tender_watched_documents", {"id": n["watched_document_id"]}))
        tender = _one(client.select("tenders", {"id": n["tender_id"]}))
        if not doc or not tender:
            continue
        out.append({"type": "tender_update", "company_id": n["company_id"], "tender_id": n["tender_id"],
                    "watched_document_id": doc["id"], "contract_no": tender.get("contract_no"),
                    "closing_date_on_file": tender.get("closing_date"), "title": doc.get("title"), "url": doc.get("url"),
                    "kind": doc.get("kind"), "urgency": doc.get("urgency"), "summary": doc.get("summary"),
                    "changes": doc.get("changes")})
    return sorted(out, key=lambda u: (URGENCY_ORDER.get(u["urgency"], 3), u.get("contract_no") or ""))


def mark_digested(client, items):
    now = _now()
    for i in items:
        client.update("tender_update_notifications",
                      {"company_id": i["company_id"], "watched_document_id": i["watched_document_id"]}, {"digested_at": now})


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=None, help="write the per-company alert report to this JSON file")
    ap.add_argument("--work-dir", default=None, help="where downloaded documents are read (default: a temp dir, removed after)")
    args = ap.parse_args()
    url, key = os.environ.get("NEXT_PUBLIC_SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("ERROR: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY - the watch reads which "
                         "companies pursue which tenders, and records what it has reported, in the database.")
    import process_general_jobs  # engine/general: the REST client with update()
    report = run(process_general_jobs.Supabase(url, key), work_dir=args.work_dir)
    n = sum(len(t["updates"]) for e in report for t in e["tenders"])
    print(f"\n{n} update(s) newly reported to {len(report)} compan{'y' if len(report) == 1 else 'ies'}:")
    for e in report:
        print(f"  [{e['most_urgent']}] {e.get('legal_name')}")
        for t in e["tenders"]:
            for u in t["updates"]:
                print(f"      {t.get('contract_no')}: [{u['urgency']}] {u['summary']}")
    if args.out:
        with open(args.out, "w") as f:
            json.dump(report, f, indent=2, default=str)
        print(f"\nWrote {args.out}")
    return report


if __name__ == "__main__":
    main()
