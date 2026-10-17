"""
Tender-update watch check (watch_tender_updates.py + tender_updates.py,
migration 0039). Sarel, 2026-10-17: monitor new documents added to a tender,
see if they are addenda, record closing-date changes, and tell the companies
actively pursuing it - once.

Part 1 (always): the classifier on the text of REAL addenda and late documents
from the live eTenders feed (fixtures/tender_updates/, contact details
removed): a closing-date extension (EC Transport SCMU10, 26 Oct -> 06 Nov),
two compulsory-briefing moves read by OCR from scans (DWS WTE1062CE/1063CE),
an amended RFQ re-issue, an addendum RFQ, and two plain late documents.

Part 2 (always): the whole watch, synthetic but realistic, against an
in-memory database. One eTenders tender, fetched twice: the second fetch of
its OCDS release has one more document - an addendum (.docx built from the
real SCMU10 text) - and the listing's closing date moved to match. Checks:
detection, classification, the closing date applied everywhere it is copied,
ONLY the active pursuers notified (bidding + found; not a company that only
has it in its Discovery feed, not one that lost it), a third run reports
nothing, a later plain document is reported once at "info", a document added
between discovery and the first watch is reported on the first look, a
SANRAL page's new "Addendum 1" file is reported from its name, the digest hook
carries each update once.

Part 3 (TU_PSQL set - a scratch Postgres with every migration replayed, same
method as engine/intake/test_manual_intake.py): Part 2's scenario on real
tables, plus 0039's RLS (a member sees only its own company's notifications;
a private manual tender's updates only by its owner; no client writes).

    python3 engine/discovery/test_tender_updates.py
    TU_PSQL="psql -h /tmp/sock -p 54411 -U postgres -d tutest" python3 engine/discovery/test_tender_updates.py
"""
import copy
import datetime
import io
import json
import os
import sys
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import tender_updates as tu  # noqa: E402
import watch_tender_updates as watch  # noqa: E402

FIX = os.path.join(HERE, "fixtures", "tender_updates")
FAILS = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def fixture(name):
    return "".join(ln for ln in open(os.path.join(FIX, name + ".txt"), encoding="utf-8") if not ln.startswith("# "))


# ---------------------------------------------------------------------------
# Part 1 - classifier on real documents
# ---------------------------------------------------------------------------

def part1():
    print("Part 1 - classifier on real eTenders addenda and late documents")
    r = tu.classify_document("SCHOLAR TRANSPORT ADDENDUM NO. 1.pdf", fixture("ec_transport_scmu10_addendum1"), "text",
                             "2026-10-26T09:00:00Z", "2026-11-06T11:00:00Z")
    cd = r["changes"].get("closing_date") or {}
    check(r["kind"] == "addendum", f"SCMU10: addendum ({r['kind']})")
    check(cd.get("date") == "2026-11-06" and cd.get("time") == "11:00", f"SCMU10: new closing 2026-11-06 11:00 ({cd.get('date')} {cd.get('time')})")
    check(cd.get("direction") == "later" and "LATER" in r["summary"] and "more time" in r["summary"],
          f"SCMU10: flagged as moved LATER - more time ({r['summary']})")
    check("EXTENDED TO FRIDAY 06 NOVEMBER 2026" in (cd.get("quote") or ""), "SCMU10: the change carries its own line as the quote")
    check(cd.get("listing_agrees") is True, "SCMU10: the OCDS listing's endDate agrees")
    check(r["urgency"] == "high", f"SCMU10: urgency high ({r['urgency']})")
    # The same addendum when the date on file was already updated elsewhere: the
    # document's own "from" date isn't stated, so direction falls back to 'same'.
    r2 = tu.classify_document("SCHOLAR TRANSPORT ADDENDUM NO. 1.pdf", fixture("ec_transport_scmu10_addendum1"), "text",
                              "2026-11-06T09:00:00Z", "2026-11-06T09:00:00Z")
    check(r2["changes"]["closing_date"]["direction"] == "same", "SCMU10 with the date on file already moved: 'same', not 'later'")
    # Brought forward: the same wording against a later date on file is critical.
    r3 = tu.classify_document("Addendum 2.pdf", "ADDENDUM NO. 2\nThe closing date has been changed to 30 October 2026 at 11h00.", "text",
                              "2026-11-06T09:00:00Z", None)
    check(r3["changes"]["closing_date"]["direction"] == "earlier" and r3["urgency"] == "critical" and "FORWARD" in r3["summary"],
          f"closing date brought forward -> critical ({r3['summary']})")
    check(any("listing" in c for c in r3["changes"].get("caveats", [])) is False, "no listing date -> no listing caveat")

    for name, prev, new in (("dws_wte1062ce_addendum1_ocr", "2026-10-22", "2026-10-27"), ("dws_wte1063ce_addendum1_ocr", "2026-10-21", "2026-10-23")):
        r = tu.classify_document(name + ".pdf", fixture(name), "ocr", "2026-11-04T09:00:00Z", "2026-11-04T09:00:00Z")
        b = r["changes"].get("briefing") or {}
        check(r["kind"] == "addendum" and b.get("previous_date") == prev and b.get("date") == new,
              f"{name}: compulsory briefing moved {prev} -> {new} ({b.get('previous_date')} -> {b.get('date')})")
        check("closing_date" not in r["changes"], f"{name}: 'closing on the 04 November 2026' is not read as a closing-date change")

    r = tu.classify_document("AMENDED RFQ-MICT-75-2026- WATER DISPENSER_.pdf", fixture("mict_rfq75_amended_reissue"), "text",
                             "2026-10-23T09:00:00Z", "2026-10-23T09:00:00Z")
    check(r["kind"] == "addendum" and r["urgency"] == "high", f"MICT amended re-issue: addendum, high ({r['kind']}, {r['urgency']})")
    check(any("compare it" in c for c in r["changes"].get("caveats", [])), "MICT: says the text doesn't state what changed")
    r = tu.classify_document("JTC0014-2026-27 ADDENDUMf.pdf", fixture("jtc0014_addendum_rfq"), "text", "2026-10-20T08:00:00Z", None)
    check(r["kind"] == "addendum" and "closing_date" not in r["changes"], "JTC0014: addendum, its own closing date line not taken as a change")
    for name, title in (("dpwi_functionality_criteria_late_doc", "Functionality Criteria Cleaning Hygiene And Horticulture Services.pdf"),
                        ("dws_wte1062ce_annexure_c_late_doc", "Annexure  C.pdf")):
        r = tu.classify_document(title, fixture(name), "text", "2026-10-23T09:00:00Z", None)
        check(r["kind"] == "supporting_document" and r["urgency"] == "info" and not r["changes"],
              f"{name}: plain supporting document, info, no changes ({r['kind']}, {r['urgency']})")
    r = tu.classify_document("Addendum 1 - NW Batch 3 RRM Contractors Signed.pdf", "", "title_only", None, None)
    check(r["kind"] == "addendum" and any("file name only" in c for c in r["changes"]["caveats"]),
          "SANRAL file name only: addendum, flagged as name-only")
    r = tu.classify_document("Notice of cancellation.pdf", "NOTICE OF CANCELLATION\nThe above tender has been cancelled.", "text", None, None)
    check(r["kind"] == "cancellation" and r["urgency"] == "critical", "cancellation notice -> critical")
    r = tu.classify_document("Minutes of compulsory briefing.pdf", "MINUTES OF THE COMPULSORY BRIEFING SESSION\nQuestions and answers", "text", None, None)
    check(r["kind"] == "clarification" and r["urgency"] == "info", f"briefing minutes: clarification ({r['kind']}, {r['urgency']})")
    for s, d in (("6th of November 2026", "2026-11-06"), ("2026-11-06", "2026-11-06"), ("06/11/2026", "2026-11-06"), ("Fri 6 Nov. 2026", "2026-11-06")):
        got = tu.find_closing_change(f"The closing date is extended to {s}.")
        check(got and got[0].isoformat() == d, f"date form {s!r} -> {d}")


# ---------------------------------------------------------------------------
# Part 2 - the watch end to end, in memory
# ---------------------------------------------------------------------------

DEFAULTS = {
    "tender_watched_documents": lambda: {"id": str(uuid.uuid4()), "baseline": False, "changes": {},
                                         "first_seen_at": datetime.datetime.now(datetime.timezone.utc).isoformat()},
    "tender_update_notifications": lambda: {"created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "digested_at": None},
}


class MemClient:
    """select (eq), insert, update, upsert - the PostgREST slice the watch uses."""

    def __init__(self):
        self.t = {}

    def rows(self, table):
        return self.t.setdefault(table, [])

    @staticmethod
    def _match(row, filters):
        return all(str(row.get(k)) == str(v) for k, v in (filters or {}).items())

    def select(self, table, filters=None, order=None):
        return [copy.deepcopy(r) for r in self.rows(table) if self._match(r, filters)]

    def insert(self, table, row):
        full = {**(DEFAULTS.get(table, lambda: {"id": str(uuid.uuid4())})()), **copy.deepcopy(row)}
        self.rows(table).append(full)
        return copy.deepcopy(full)

    def update(self, table, filters, body):
        out = []
        for r in self.rows(table):
            if self._match(r, filters):
                r.update(copy.deepcopy(body))
                out.append(copy.deepcopy(r))
        return out

    def upsert(self, table, rows, on_conflict):
        keys = on_conflict.split(",")
        out = []
        for row in rows:
            hit = next((r for r in self.rows(table) if all(str(r.get(k)) == str(row.get(k)) for k in keys)), None)
            if hit:
                hit.update(copy.deepcopy(row))
                out.append(copy.deepcopy(hit))
            else:
                out.append(self.insert(table, row))
        return out


def addendum_docx(text):
    import docx
    d = docx.Document()
    for line in text.splitlines():
        d.add_paragraph(line)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


OCID = "ocds-9t57fa-990001"
OCID_LATE = "ocds-9t57fa-990002"
DAY = datetime.date(2026, 10, 16)
TODAY = datetime.date(2026, 10, 17)


def ocds_doc(ident, title, published, fmt="pdf"):
    return {"id": ident, "title": title, "url": f"https://www.etenders.gov.za/home/Download?blobName={ident}.{fmt}",
            "datePublished": published, "dateModified": published, "format": fmt}


def release(ocid, docs, end):
    return {"ocid": ocid, "id": f"{ocid}-2026/10/16 00:00:00", "date": "2026-10-16T00:00:00Z",
            "tender": {"id": "SCMU10-26/27-0017", "title": "Scholar transport", "documents": docs,
                       "tenderPeriod": {"startDate": "2026-10-16T00:00:00Z", "endDate": end}}}


class Feed:
    """The OCDS API, one-day windows, scripted per run."""

    def __init__(self):
        self.releases = {}
        self.calls = []

    def __call__(self, day):
        self.calls.append(day)
        return [copy.deepcopy(r) for r in self.releases.get(day, [])]


def scenario(c, label, seed):
    """seed(c) -> ids. Runs the watch 4 times against the scripted feed."""
    print(f"Part {label}")
    ids = seed(c)
    doc1 = ocds_doc("aaaaaaaa-0000-0000-0000-000000000001", "SCMU10 Bid document.pdf", "2026-10-16T08:00:00Z")
    doc2 = ocds_doc("aaaaaaaa-0000-0000-0000-000000000002", "SCHOLAR TRANSPORT ADDENDUM NO. 1.docx", "2026-10-17T11:13:22Z", "docx")
    doc3 = ocds_doc("aaaaaaaa-0000-0000-0000-000000000003", "Functionality Criteria.docx", "2026-10-18T09:00:00Z", "docx")
    late1 = ocds_doc("bbbbbbbb-0000-0000-0000-000000000001", "Specification, roof trusses.pdf", "2026-10-16T08:05:36Z")
    late2 = ocds_doc("bbbbbbbb-0000-0000-0000-000000000002", "Wte1062-Addendum.docx", "2026-10-17T14:55:46Z", "docx")
    files = {doc2["url"]: addendum_docx(fixture("ec_transport_scmu10_addendum1")),
             doc3["url"]: addendum_docx(fixture("dpwi_functionality_criteria_late_doc")),
             late2["url"]: addendum_docx(fixture("dws_wte1062ce_addendum1_ocr"))}
    fetched = []

    def fetch_doc(url):
        fetched.append(url)
        return files[url]

    sanral_pages = [{"url": "https://www.nra.co.za/open-tenders/nra-2026-0756-c", "closing_date": "2026/11/16 12:00",
                     "attached_files": ["NORTH-WEST BATCH 3 CONTRACTORS (3).zip"], "file_count": "1"}]
    feed = Feed()
    feed.releases[DAY] = [release(OCID, [doc1], "2026-10-26T09:00:00Z"),
                          release(OCID_LATE, [late1, late2], "2026-11-04T09:00:00Z")]
    logs = []

    def go(today=TODAY):
        return watch.run(c, today=today, fetch_ocds_day=feed, fetch_sanral=lambda slug: sanral_pages[-1],
                         fetch_doc=fetch_doc, log=logs.append)

    # Run 1: first look.
    rep = go()
    docs = c.select("tender_watched_documents", {"tender_id": ids["t1"]})
    check(len(docs) == 1 and docs[0]["baseline"], "run 1: the document known at discovery is recorded as baseline")
    check(rep and [e["company_id"] for e in rep] in ([ids["a"], ids["b"]], [ids["b"], ids["a"]]) and
          all(t["tender_id"] == ids["t_late"] for e in rep for t in e["tenders"]),
          "run 1: only the tender whose addendum was added between discovery and the first look is reported")
    late_upd = [u for e in rep for t in e["tenders"] for u in t["updates"]]
    check(late_upd and all(u["kind"] == "addendum" and u["changes"].get("briefing", {}).get("date") == "2026-10-27" for u in late_upd),
          "run 1: that addendum (added after discovery) is read: briefing moved to 27 Oct")
    check(late1["url"] not in fetched, "run 1: the document already known at discovery is not downloaded")
    check(DAY in feed.calls and all(d in (DAY, TODAY, TODAY - datetime.timedelta(days=1), TODAY - datetime.timedelta(days=2))
                                    or d <= DAY for d in feed.calls), "run 1: OCDS read by one-day windows")
    check(not any(t == ids["t_unpursued"] for t in [d["tender_id"] for d in c.select("tender_watched_documents")]),
          "a tender nobody pursues (only in a Discovery feed) is not watched at all")
    sanral = c.select("tender_watched_documents", {"tender_id": ids["t_sanral"]})
    check(len(sanral) == 1 and sanral[0]["baseline"], "run 1: SANRAL page's attached file recorded as baseline")
    state = c.select("tender_watch_state", {"tender_id": ids["t1"]})[0]
    check(state["release_date"] == DAY.isoformat(), "run 1: the release date is remembered for the next check")

    # Run 2: the buyer adds the addendum and moves the closing date on the listing.
    feed.releases[DAY] = [release(OCID, [doc1, doc2], "2026-11-06T11:00:00Z"), release(OCID_LATE, [late1, late2], "2026-11-04T09:00:00Z")]
    sanral_pages.append({**sanral_pages[0], "attached_files": sanral_pages[0]["attached_files"] + ["Addendum 1 - NW Batch 3 RRM Contractors Signed.pdf"], "file_count": "2"})
    feed.calls.clear()
    rep = go()
    check(feed.calls == [DAY], f"run 2: straight to the remembered release date, one request ({feed.calls})")
    by_co = {e["company_id"]: e for e in rep}
    check(set(by_co) == {ids["a"], ids["b"]}, "run 2: notified = the bidding company + the found company only "
          "(not the Discovery-feed-only company, not the one that lost it)")
    upd = [u for t in by_co[ids["a"]]["tenders"] if t["tender_id"] == ids["t1"] for u in t["updates"]]
    check(len(upd) == 1 and upd[0]["kind"] == "addendum" and upd[0]["urgency"] == "high", "run 2: the new document is an addendum, high")
    cd = upd[0]["changes"]["closing_date"]
    check(cd["date"] == "2026-11-06" and cd["direction"] == "later" and cd["applied"] is True,
          f"run 2: closing date moved later to 6 Nov and applied ({cd['direction']}, applied={cd['applied']})")
    check("was Mon 26 Oct 2026" in upd[0]["summary"] and "more time" in upd[0]["summary"], f"run 2: summary says more time ({upd[0]['summary']})")
    t1 = c.select("tenders", {"id": ids["t1"]})[0]
    check(t1["closing_date"].startswith("2026-11-06"), f"run 2: tenders.closing_date updated ({t1['closing_date']})")
    tasks = c.select("tender_tasks", {"tender_id": ids["t1"], "kind": "closing"})
    check(tasks and all(str(t["due_date"]) == "2026-11-06" for t in tasks), "run 2: every company's 'Tender closes' milestone moved")
    opps = c.select("discovered_opportunities", {"ocid": OCID})
    check(opps and all(str(o["closing_date"]).startswith("2026-11-06") for o in opps), "run 2: Discovery rows for the release updated")
    s_upd = [u for t in by_co[ids["a"]]["tenders"] if t["tender_id"] == ids["t_sanral"] for u in t["updates"]]
    check(len(s_upd) == 1 and s_upd[0]["kind"] == "addendum" and s_upd[0]["read_basis"] == "title_only",
          "run 2: SANRAL's new 'Addendum 1' file reported from its name (the file is behind SANRAL's form)")
    check(ids["b"] in by_co and not any(t["tender_id"] == ids["t_sanral"] for t in by_co[ids["b"]]["tenders"]),
          "run 2: the SANRAL addendum goes only to the company pursuing the SANRAL tender")
    check(by_co[ids["a"]]["members"] and by_co[ids["a"]]["legal_name"] == "Pursuer Bidding (Pty) Ltd", "run 2: report names the company and its members")

    # Run 3: nothing new.
    n_before = len(c.select("tender_update_notifications"))
    rep = go()
    check(rep == [], "run 3: same feed again -> nothing reported")
    check(len(c.select("tender_update_notifications")) == n_before, "run 3: no new notification rows")
    check(fetched.count(doc2["url"]) == 1, "run 3: the addendum is not downloaded again")

    # Digest hook: each update once.
    items = watch.pending_digest_updates(c)
    check({i["company_id"] for i in items} == {ids["a"], ids["b"]} and all(i["company_id"] != ids["c"] for i in items),
          f"digest: {len(items)} pending update(s), pursuers only")
    sys.path.insert(0, os.path.join(ROOT, "engine", "notify"))
    sys.path.insert(0, os.path.join(ROOT, "engine", "compliance"))
    import daily_digest

    def digest_for(company_id, role):
        sig = daily_digest.company_signals(company_id, {}, [], [], [], 14, company_id=company_id, tender_updates=items)
        return daily_digest.build_digest_for_person({"tender_role": role, "company_id": company_id}, sig)
    full = digest_for(ids["a"], "full_cycle")["tender_updates"]
    check(full and all(i["company_id"] == ids["a"] for i in full) and full[0]["urgency"] in ("critical", "high"),
          f"digest: a full-cycle member gets its own company's {len(full)} update(s), most urgent first")
    check(digest_for(ids["a"], "viewer")["tender_updates"]["count"] == len(full), "digest: a viewer gets the count")
    check(digest_for(ids["c"], "full_cycle")["tender_updates"] == [], "digest: the feed-only company's digest has none")
    watch.mark_digested(c, items)
    check(watch.pending_digest_updates(c) == [], "digest: carried once, then nothing pending")

    # Run 4: a plain late document - info, reported once.
    feed.releases[DAY] = [release(OCID, [doc1, doc2, doc3], "2026-11-06T11:00:00Z"), release(OCID_LATE, [late1, late2], "2026-11-04T09:00:00Z")]
    rep = go(TODAY + datetime.timedelta(days=1))
    u4 = [u for e in rep for t in e["tenders"] for u in t["updates"]]
    check(len(u4) == 2 and all(u["kind"] == "supporting_document" and u["urgency"] == "info" for u in u4),
          "run 4: a late plain document -> one 'info' update per pursuing company")
    check(go(TODAY + datetime.timedelta(days=1)) == [], "run 5: and not again")
    return ids


def seed_mem(c):
    ids = {k: str(uuid.uuid4()) for k in ("a", "b", "c", "d")}
    for k, name in (("a", "Pursuer Bidding (Pty) Ltd"), ("b", "Pursuer Found CC"), ("c", "Feed Only Ltd"), ("d", "Lost It Ltd")):
        c.rows("companies").append({"id": ids[k], "legal_name": name})
        c.rows("company_members").append({"company_id": ids[k], "user_id": str(uuid.uuid4()), "tender_role": "full_cycle"})
    t = lambda **kw: {"id": str(uuid.uuid4()), "status": "open", "created_at": "2026-10-16T12:00:00Z", **kw}  # noqa: E731
    t1 = t(slug="etenders-990001", contract_no="SCMU10-26/27-0017", ocid=OCID, source="etenders_ocds",
           closing_date="2026-10-26T09:00:00Z", description="Scholar transport",
           document_urls=[{"url": ocds_doc("aaaaaaaa-0000-0000-0000-000000000001", "", "")["url"], "title": "SCMU10 Bid document.pdf"}])
    tl = t(slug="etenders-990002", contract_no="WTE1062CE", ocid=OCID_LATE, source="etenders_ocds", closing_date="2026-11-04T09:00:00Z",
           document_urls=[{"url": ocds_doc("bbbbbbbb-0000-0000-0000-000000000001", "", "")["url"], "title": "Specification"}])
    tu_ = t(slug="etenders-990003", contract_no="NOBODY", ocid="ocds-9t57fa-990003", source="etenders_ocds", closing_date="2026-11-04T09:00:00Z")
    ts = t(slug="nra-2026-0756-c", contract_no="NRA 2026/0756 (C)", source="sanral", closing_date="2026-11-16T10:00:00Z")
    c.rows("tenders").extend([t1, tl, tu_, ts])
    ids.update({"t1": t1["id"], "t_late": tl["id"], "t_unpursued": tu_["id"], "t_sanral": ts["id"]})
    for co, tender, stage in (("a", t1, "bidding"), ("b", t1, "found"), ("d", t1, "lost"), ("a", tl, "bidding"), ("b", tl, "found"), ("a", ts, "bidding")):
        c.rows("tender_packs").append({"id": str(uuid.uuid4()), "company_id": ids[co], "tender_id": tender["id"], "pipeline_stage": stage})
    for co in ("a", "b", "d"):
        c.rows("tender_tasks").append({"id": str(uuid.uuid4()), "company_id": ids[co], "tender_id": t1["id"], "kind": "closing", "due_date": "2026-10-26"})
    for co in ("a", "b", "c"):
        c.rows("discovered_opportunities").append({"id": str(uuid.uuid4()), "company_id": ids[co], "ocid": OCID,
                                                   "closing_date": "2026-10-26T09:00:00Z", "first_seen": "2026-10-16T12:00:00Z"})
    c.rows("discovered_opportunities").append({"id": str(uuid.uuid4()), "company_id": ids["c"], "ocid": "ocds-9t57fa-990003",
                                               "closing_date": "2026-11-04T09:00:00Z", "first_seen": "2026-10-16T12:00:00Z"})
    return ids


# ---------------------------------------------------------------------------
# Part 3 - the same on a replayed database, plus RLS
# ---------------------------------------------------------------------------

def seed_db(c):
    from test_manual_intake import lit  # noqa: F401
    c.sql("delete from tender_update_notifications; delete from tender_watched_documents; delete from tender_watch_state; "
          "delete from discovered_opportunities where ocid like 'ocds-9t57fa-99000%'; "
          "delete from tenders where slug in ('etenders-990001','etenders-990002','etenders-990003','nra-2026-0756-c'); "
          "delete from companies where legal_name in ('Pursuer Bidding (Pty) Ltd','Pursuer Found CC','Feed Only Ltd','Lost It Ltd')")
    ids = {}
    for k, name in (("a", "Pursuer Bidding (Pty) Ltd"), ("b", "Pursuer Found CC"), ("c", "Feed Only Ltd"), ("d", "Lost It Ltd")):
        ids[k] = c.insert("companies", {"legal_name": name})["id"]
        uid = c.sql("insert into auth.users default values returning id").splitlines()[0]
        ids["u" + k] = uid
        c.insert("company_members", {"company_id": ids[k], "user_id": uid, "role": "owner"})

    def tender(**kw):
        return c.insert("tenders", {"status": "open", **kw})
    t1 = tender(slug="etenders-990001", contract_no="SCMU10-26/27-0017", ocid=OCID, source="etenders_ocds",
                closing_date="2026-10-26T09:00:00Z", description="Scholar transport",
                document_urls=[{"url": ocds_doc("aaaaaaaa-0000-0000-0000-000000000001", "", "")["url"], "title": "SCMU10 Bid document.pdf"}])
    tl = tender(slug="etenders-990002", contract_no="WTE1062CE", ocid=OCID_LATE, source="etenders_ocds", closing_date="2026-11-04T09:00:00Z",
                document_urls=[{"url": ocds_doc("bbbbbbbb-0000-0000-0000-000000000001", "", "")["url"], "title": "Specification"}])
    tu_ = tender(slug="etenders-990003", contract_no="NOBODY", ocid="ocds-9t57fa-990003", source="etenders_ocds", closing_date="2026-11-04T09:00:00Z")
    ts = tender(slug="nra-2026-0756-c", contract_no="NRA 2026/0756 (C)", source="sanral", closing_date="2026-11-16T10:00:00Z")
    ids.update({"t1": t1["id"], "t_late": tl["id"], "t_unpursued": tu_["id"], "t_sanral": ts["id"]})
    for co, t, stage in (("a", t1, "bidding"), ("b", t1, "found"), ("d", t1, "lost"), ("a", tl, "bidding"), ("b", tl, "found"), ("a", ts, "bidding")):
        c.insert("tender_packs", {"company_id": ids[co], "tender_id": t["id"], "pipeline_stage": stage})
    for co in ("a", "b", "d"):
        c.insert("tender_tasks", {"company_id": ids[co], "tender_id": t1["id"], "kind": "closing", "is_standard": True,
                                  "description": "Tender closes", "due_date": "2026-10-26"})
    for co in ("a", "b", "c"):
        c.insert("discovered_opportunities", {"company_id": ids[co], "ocid": OCID, "verdict": "possible",
                                              "closing_date": "2026-10-26T09:00:00Z", "first_seen": "2026-10-16T12:00:00Z"})
    c.insert("discovered_opportunities", {"company_id": ids["c"], "ocid": "ocds-9t57fa-990003", "verdict": "possible",
                                          "closing_date": "2026-11-04T09:00:00Z", "first_seen": "2026-10-16T12:00:00Z"})
    return ids


def part3(psql):
    sys.path.insert(0, os.path.join(ROOT, "engine", "intake"))
    sys.path.insert(0, os.path.join(ROOT, "engine", "pack"))
    from test_manual_intake import Client
    c = Client(psql, "/nonexistent")
    c.sql("grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated; "
          "grant execute on all functions in schema public to authenticated")
    ids = scenario(c, "3 - the watch on a scratch Postgres (every migration replayed)", seed_db)
    ok, n = c.as_user(ids["ua"], "select count(*) from tender_update_notifications")
    own = c.sql(f"select count(*) from tender_update_notifications where company_id = '{ids['a']}'")
    check(ok and n == own and int(n) > 0, f"RLS: a pursuer's member sees its own {own} notification(s) only ({n})")
    ok, n = c.as_user(ids["uc"], "select count(*) from tender_update_notifications")
    check(ok and n == "0", "RLS: the Discovery-feed-only company's member sees no notifications")
    ok, n = c.as_user(ids["uc"], f"select count(*) from tender_watched_documents where tender_id = '{ids['t1']}' and not baseline")
    check(ok and int(n) >= 1, "RLS: a shared tender's updates are readable by any member (like its documents)")
    ok, n = c.as_user(ids["ua"], "select count(*) from tender_watch_state")
    check(ok and n == "0", "RLS: tender_watch_state is service-role only")
    ok, err = c.as_user(ids["ua"], f"insert into tender_update_notifications (company_id, watched_document_id, tender_id) "
                                   f"select '{ids['a']}', id, tender_id from tender_watched_documents limit 1")
    check(not ok, "RLS: a client can't write a notification row")
    ok, err = c.as_user(ids["ua"], f"update tender_watched_documents set summary = 'x' where tender_id = '{ids['t1']}'")
    check(ok and c.sql(f"select count(*) from tender_watched_documents where summary = 'x'") == "0", "RLS: a client can't edit a watched document")
    # Private (manual) tender: its updates only for its owner.
    priv = c.insert("tenders", {"slug": f"manual-{uuid.uuid4().hex[:8]}", "source": "manual", "owner_company_id": ids["a"], "status": "open"})
    c.insert("tender_watched_documents", {"tender_id": priv["id"], "doc_key": "x@1", "source": "etenders_ocds", "title": "Addendum", "kind": "addendum"})
    ok, n = c.as_user(ids["ua"], f"select count(*) from tender_watched_documents where tender_id = '{priv['id']}'")
    ok2, n2 = c.as_user(ids["ub"], f"select count(*) from tender_watched_documents where tender_id = '{priv['id']}'")
    check(ok and n == "1" and ok2 and n2 == "0", "RLS: a private manual tender's updates: owner 1, other company 0")
    c.sql(f"delete from tenders where id = '{priv['id']}'")


if __name__ == "__main__":
    part1()
    scenario(MemClient(), "2 - the watch end to end (in-memory rows)", seed_mem)
    psql = os.environ.get("TU_PSQL")
    if psql:
        part3(psql)
    else:
        print("(Part 3 skipped - set TU_PSQL to a scratch Postgres with the migrations replayed)")
    print(f"\n{'ALL PASSED' if not FAILS else f'{len(FAILS)} FAILURE(S)'}")
    sys.exit(1 if FAILS else 0)
