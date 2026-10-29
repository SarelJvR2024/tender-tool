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

Part 2b (always): per-tender isolation. Four pursued tenders, two failing - a
malformed OCDS document entry (first in the loop) and a database write that
times out. The run completes, the other two are checked and reported, one
system alert names each failed tender, and once the DB write works again the
next run reports the skipped tender's addendum.

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
# Part 0 - a seeded demo/fixture tender's SANRAL page is never live-fetched
# (2026-10-27 fix: the recurring "SANRAL page could not be read (404)"
# system_alerts error on contract_no N.007-030-2026/1F, slug
# 'demo-n7-section-3-2026-1f' - a sales-demo fixture from
# engine/seed_demo_company.py, not a dead real tender or a URL bug).
# ---------------------------------------------------------------------------

def part0_demo_slug_skip():
    print("Part 0 - a demo/fixture tender's SANRAL page is skipped, never fetched")
    sys.path.insert(0, os.path.join(ROOT, "engine", "alerts"))
    import system_alerts
    alerts = []
    system_alerts.set_sink(lambda p: alerts.append(p) or "alert-id")
    try:
        c = MemClient()
        demo = {"id": str(uuid.uuid4()), "status": "open", "created_at": "2026-10-16T12:00:00Z",
                "slug": "demo-n7-section-3-2026-1f", "contract_no": "N.007-030-2026/1F", "source": "sanral",
                "closing_date": "2026-11-27T10:00:00Z"}
        c.rows("tenders").append(demo)

        def boom(slug):
            raise AssertionError(f"fetch_sanral must never be called for a demo slug ({slug})")

        result = watch.check_tender(c, demo, TODAY, ocds=None, fetch_sanral=boom, log=lambda *a: None)
        check(result == [], "a demo-slug tender returns no updates, never attempts a live fetch")
        check(alerts == [], f"no system_alerts error is raised for a demo-slug tender ({alerts})")
        state = c.select("tender_watch_state", {"tender_id": demo["id"]})
        check(len(state) == 1 and state[0]["last_error"] is None,
              f"its own watch state records a clean check, not an error ({state})")

        real = {**demo, "id": str(uuid.uuid4()), "slug": "nra-2026-9999-c", "contract_no": "NRA 2026/9999 (C)"}
        c.rows("tenders").append(real)
        called = []
        watch.check_tender(c, real, TODAY, ocds=None, fetch_sanral=lambda slug: called.append(slug) or {"attached_files": []},
                           log=lambda *a: None)
        check(called == ["nra-2026-9999-c"], f"a real (non-demo) SANRAL slug is still fetched as normal ({called})")
    finally:
        system_alerts.set_sink(None)


# ---------------------------------------------------------------------------
# Part 0b - a SANRAL closing date with no time given defaults to 11:00 SAST,
# the same standard-closing-time convention source_http.iso_sast_closing()
# uses for every other date-only closing source, not noon (found 2026-10-29:
# _sanral_closing() previously disagreed with that convention).
# ---------------------------------------------------------------------------

def part0b_sanral_closing_date_only_default():
    print("Part 0b - a SANRAL closing date with no time defaults to 11:00 SAST, not noon")
    check(watch._sanral_closing({"closing_date": "2026/11/19"}) == "2026-11-19T11:00:00+02:00",
          "date-only SANRAL closing date defaults to 11:00 SAST")
    check(watch._sanral_closing({"closing_date": "2026/11/19 14:30"}) == "2026-11-19T14:30:00+02:00",
          "a SANRAL closing date WITH a real stated time is unaffected")
    check(watch._sanral_closing({"closing_date": "2026/11/19 00:00"}) == "2026-11-19T00:00:00+02:00",
          "a real stated midnight (not a default) is unaffected")
    sys.path.insert(0, os.path.join(ROOT, "engine", "alerts"))
    import system_alerts
    alerts = []
    system_alerts.set_sink(lambda p: alerts.append(p) or "alert-id")
    try:
        check(watch._sanral_closing({"closing_date": "2026/13/19"}) is None,
              "an unreal date (month 13) still returns None, not a crash")
        check(len(alerts) == 1, f"the unreal-date case still raises exactly one system alert ({alerts})")
    finally:
        system_alerts.set_sink(None)
    check(watch._sanral_closing({"closing_date": ""}) is None, "no closing date on the page returns None")


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
        check(b.get("on_file_agrees") is True and b.get("previous_on_file") is None and b.get("applied") is False,
              f"{name}: nothing on file -> the briefing date may be applied (on_file_agrees)")
        check(any("briefing date was read by OCR" in c for c in r["changes"].get("caveats", [])), f"{name}: OCR caveat on the briefing date")
        r_same = tu.classify_document(name + ".pdf", fixture(name), "ocr", "2026-11-04T09:00:00Z", "2026-11-04T09:00:00Z", prev)
        check(r_same["changes"]["briefing"]["on_file_agrees"] is True, f"{name}: on file = the document's original ({prev}) -> agrees")
        r_dis = tu.classify_document(name + ".pdf", fixture(name), "ocr", "2026-11-04T09:00:00Z", "2026-11-04T09:00:00Z", "2026-10-25")
        check(r_dis["changes"]["briefing"]["on_file_agrees"] is False and r_dis["changes"]["briefing"]["previous_on_file"] == "2026-10-25"
              and any("briefing date on file is" in c for c in r_dis["changes"]["caveats"]),
              f"{name}: on file 25 Oct but the document's original is {prev} -> not applied, flagged")

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

    def rpc(self, fn, args=None):
        """company_member_labels() as the service role sees it (0048)."""
        assert fn == "company_member_labels", fn
        return [{"user_id": u, "label": e or "a team member"} for u, e in self.rows("_auth_users")]

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
OCID_DIS = "ocds-9t57fa-990004"  # addendum moves the closing date, the listing doesn't
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
    dis1 = ocds_doc("dddddddd-0000-0000-0000-000000000001", "Bid document.pdf", "2026-10-16T08:00:00Z")
    dis2 = ocds_doc("dddddddd-0000-0000-0000-000000000002", "ADDENDUM NO. 1.docx", "2026-10-17T11:00:00Z", "docx")
    files[dis2["url"]] = addendum_docx(fixture("ec_transport_scmu10_addendum1"))
    feed.releases[DAY] = [release(OCID, [doc1], "2026-10-26T09:00:00Z"),
                          release(OCID_LATE, [late1, late2], "2026-11-04T09:00:00Z"),
                          release(OCID_DIS, [dis1], "2026-10-26T09:00:00Z")]
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
    # Briefing moved 22 -> 27 Oct (0048): written to the tender and to each
    # active pursuer's own "Briefing session" milestone.
    tl = c.select("tenders", {"id": ids["t_late"]})[0]
    late_doc = [d for d in c.select("tender_watched_documents", {"tender_id": ids["t_late"]}) if not d["baseline"]][0]
    check(str(tl.get("briefing_date"))[:10] == "2026-10-27" and tl.get("briefing_source_document_id") == late_doc["id"],
          f"run 1: tenders.briefing_date = 27 Oct, from that addendum ({tl.get('briefing_date')})")
    check(late_doc["changes"]["briefing"].get("applied") is True, "run 1: the update records the briefing date as applied")
    btasks = c.select("tender_tasks", {"tender_id": ids["t_late"], "kind": "briefing"})
    check(sorted(t["company_id"] for t in btasks) == sorted([ids["a"], ids["b"]])
          and all(str(t["due_date"])[:10] == "2026-10-27" and t["description"].startswith("Briefing session") and t["is_standard"]
                  for t in btasks),
          f"run 1: a 'Briefing session' milestone (kind briefing) due 27 Oct for each active pursuer ({len(btasks)})")

    # Run 2: the buyer adds the addendum and moves the closing date on the listing.
    feed.releases[DAY] = [release(OCID, [doc1, doc2], "2026-11-06T11:00:00Z"), release(OCID_LATE, [late1, late2], "2026-11-04T09:00:00Z"),
                          release(OCID_DIS, [dis1, dis2], "2026-10-26T09:00:00Z")]
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
    labels = sorted(m["label"] for m in by_co[ids["a"]]["members"])
    check(labels == ["estimator@pursuer-bidding.example", "owner@pursuer-bidding.example"]
          and all(m["email"] == m["label"] for m in by_co[ids["a"]]["members"]),
          f"run 2: the two members of the bidding company are named by e-mail, not user id ({labels})")
    check([m["label"] for m in by_co[ids["b"]]["members"]] == ["a team member (no e-mail found)"]
          and by_co[ids["b"]]["members"][0]["email"] is None,
          "run 2: a member with no e-mail is 'a team member (no e-mail found)', never the raw id")
    # The listing does NOT agree: recorded, not applied (0039's rule, kept).
    dis = c.select("tenders", {"id": ids["t_dis"]})[0]
    dis_upd = [u for t in by_co[ids["a"]]["tenders"] if t["tender_id"] == ids["t_dis"] for u in t["updates"]]
    dcd = dis_upd[0]["changes"]["closing_date"] if dis_upd else {}
    check(dcd.get("date") == "2026-11-06" and dcd.get("listing_date") == "2026-10-26" and dcd.get("listing_agrees") is False
          and dcd.get("applied") is False and str(dis["closing_date"]).startswith("2026-10-26"),
          f"run 2: addendum says 6 Nov, listing still 26 Oct -> recorded, NOT applied ({dcd.get('applied')}, {dis['closing_date']})")
    ids["dis_doc"] = dis_upd[0]["id"] if dis_upd else None

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

    # Run 6: a company starts pursuing the briefing-moved tender after the
    # addendum: exactly one alert (Sarel: confirmed correct) and its own
    # briefing milestone from tenders.briefing_date.
    c.insert("tender_packs", {"company_id": ids["c"], "tender_id": ids["t_late"], "pipeline_stage": "found"})
    rep = go(TODAY + datetime.timedelta(days=2))
    late_join = [(e["company_id"], u["kind"]) for e in rep for t in e["tenders"] for u in t["updates"]]
    check(late_join == [(ids["c"], "addendum")], f"run 6: the late joiner gets exactly one alert, the addendum ({late_join})")
    cb = c.select("tender_tasks", {"tender_id": ids["t_late"], "kind": "briefing", "company_id": ids["c"]})
    check(len(cb) == 1 and str(cb[0]["due_date"])[:10] == "2026-10-27", "run 6: and its own briefing milestone, 27 Oct")
    check(go(TODAY + datetime.timedelta(days=2)) == [] and
          len(c.select("tender_tasks", {"tender_id": ids["t_late"], "kind": "briefing"})) == 3, "run 7: nothing new, no duplicate milestone")
    return ids


# Company a has two members (both with e-mail), b one with no e-mail on its
# auth.users row - the reports must name each, never by user id.
MEMBER_EMAILS = {"a": ["owner@pursuer-bidding.example", "estimator@pursuer-bidding.example"], "b": [None],
                 "c": ["owner@feed-only.example"], "d": ["owner@lost-it.example"]}


def seed_mem(c):
    ids = {k: str(uuid.uuid4()) for k in ("a", "b", "c", "d")}
    for k, name in (("a", "Pursuer Bidding (Pty) Ltd"), ("b", "Pursuer Found CC"), ("c", "Feed Only Ltd"), ("d", "Lost It Ltd")):
        c.rows("companies").append({"id": ids[k], "legal_name": name})
        for email in MEMBER_EMAILS[k]:
            uid = str(uuid.uuid4())
            c.rows("_auth_users").append((uid, email))
            c.rows("company_members").append({"company_id": ids[k], "user_id": uid, "tender_role": "full_cycle"})
    t = lambda **kw: {"id": str(uuid.uuid4()), "status": "open", "created_at": "2026-10-16T12:00:00Z", **kw}  # noqa: E731
    t1 = t(slug="etenders-990001", contract_no="SCMU10-26/27-0017", ocid=OCID, source="etenders_ocds",
           closing_date="2026-10-26T09:00:00Z", description="Scholar transport",
           document_urls=[{"url": ocds_doc("aaaaaaaa-0000-0000-0000-000000000001", "", "")["url"], "title": "SCMU10 Bid document.pdf"}])
    tl = t(slug="etenders-990002", contract_no="WTE1062CE", ocid=OCID_LATE, source="etenders_ocds", closing_date="2026-11-04T09:00:00Z",
           document_urls=[{"url": ocds_doc("bbbbbbbb-0000-0000-0000-000000000001", "", "")["url"], "title": "Specification"}])
    tu_ = t(slug="etenders-990003", contract_no="NOBODY", ocid="ocds-9t57fa-990003", source="etenders_ocds", closing_date="2026-11-04T09:00:00Z")
    ts = t(slug="nra-2026-0756-c", contract_no="NRA 2026/0756 (C)", source="sanral", closing_date="2026-11-16T10:00:00Z")
    td = t(slug="etenders-990004", contract_no="DIS-0001", ocid=OCID_DIS, source="etenders_ocds", closing_date="2026-10-26T09:00:00Z",
           document_urls=[{"url": ocds_doc("dddddddd-0000-0000-0000-000000000001", "", "")["url"], "title": "Bid document.pdf"}])
    c.rows("tenders").extend([t1, tl, tu_, ts, td])
    ids.update({"t1": t1["id"], "t_late": tl["id"], "t_unpursued": tu_["id"], "t_sanral": ts["id"], "t_dis": td["id"]})
    for co, tender, stage in (("a", t1, "bidding"), ("b", t1, "found"), ("d", t1, "lost"), ("a", tl, "bidding"), ("b", tl, "found"),
                              ("a", ts, "bidding"), ("a", td, "bidding"), ("d", td, "lost")):
        c.rows("tender_packs").append({"id": str(uuid.uuid4()), "company_id": ids[co], "tender_id": tender["id"], "pipeline_stage": stage})
    for co in ("a", "b", "d"):
        c.rows("tender_tasks").append({"id": str(uuid.uuid4()), "company_id": ids[co], "tender_id": t1["id"], "kind": "closing", "due_date": "2026-10-26"})
    for co in ("a", "b", "c"):
        c.rows("discovered_opportunities").append({"id": str(uuid.uuid4()), "company_id": ids[co], "ocid": OCID,
                                                   "closing_date": "2026-10-26T09:00:00Z", "first_seen": "2026-10-16T12:00:00Z"})
    c.rows("discovered_opportunities").append({"id": str(uuid.uuid4()), "company_id": ids["c"], "ocid": "ocds-9t57fa-990003",
                                               "closing_date": "2026-11-04T09:00:00Z", "first_seen": "2026-10-16T12:00:00Z"})
    for co in ("a", "d"):
        c.rows("tender_tasks").append({"id": str(uuid.uuid4()), "company_id": ids[co], "tender_id": td["id"], "kind": "closing", "due_date": "2026-10-26"})
        c.rows("discovered_opportunities").append({"id": str(uuid.uuid4()), "company_id": ids[co], "ocid": OCID_DIS,
                                                   "closing_date": "2026-10-26T09:00:00Z", "first_seen": "2026-10-16T12:00:00Z"})
    return ids


# ---------------------------------------------------------------------------
# Part 2b - one tender's failure doesn't stop the watch for the rest (QA
# seventh run, the "still open" item after Finding 9b)
# ---------------------------------------------------------------------------

class FlakyClient(MemClient):
    """A database write that fails for one tender only (a constraint error,
    a timeout) - every other write goes through."""

    def __init__(self, fail_tender_id):
        super().__init__()
        self.fail_tender_id = fail_tender_id

    def upsert(self, table, rows, on_conflict):
        if self.fail_tender_id and table == "tender_watched_documents" and any(r.get("tender_id") == self.fail_tender_id for r in rows):
            raise RuntimeError("HTTP 500 from PostgREST: canceling statement due to statement timeout")
        return super().upsert(table, rows, on_conflict)


def part2b():
    print("Part 2b - per-tender isolation: one bad tender in the batch, the rest still checked")
    sys.path.insert(0, os.path.join(ROOT, "engine", "alerts"))
    import system_alerts
    alerts = []
    system_alerts.set_sink(lambda p: alerts.append(p) or "alert-id")
    try:
        mk = lambda **kw: {"id": str(uuid.uuid4()), "status": "open", "created_at": "2026-10-16T12:00:00Z", **kw}  # noqa: E731
        bad_doc = mk(slug="etenders-990011", contract_no="BADDOC-01", ocid="ocds-9t57fa-990011", source="etenders_ocds",
                     closing_date="2026-11-04T09:00:00Z")
        good = mk(slug="etenders-990012", contract_no="WTE1062CE", ocid="ocds-9t57fa-990012", source="etenders_ocds",
                  closing_date="2026-11-04T09:00:00Z",
                  document_urls=[{"url": ocds_doc("cccccccc-0000-0000-0000-000000000001", "", "")["url"], "title": "Specification"}])
        db_fail = mk(slug="etenders-990013", contract_no="DBFAIL-01", ocid="ocds-9t57fa-990013", source="etenders_ocds",
                     closing_date="2026-11-04T09:00:00Z",
                     document_urls=[{"url": ocds_doc("eeeeeeee-0000-0000-0000-000000000000", "", "")["url"], "title": "Bid document.pdf"}])
        sanral = mk(slug="nra-2026-0757-c", contract_no="NRA 2026/0757 (C)", source="sanral", closing_date="2026-11-16T10:00:00Z")
        c = FlakyClient(db_fail["id"])
        co = {k: str(uuid.uuid4()) for k in ("a", "b")}
        for k, name in (("a", "Pursuer One (Pty) Ltd"), ("b", "Pursuer Two CC")):
            c.rows("companies").append({"id": co[k], "legal_name": name})
        c.rows("tenders").extend([bad_doc, good, db_fail, sanral])
        # Pack order = loop order: the malformed tender comes FIRST, so a crash
        # there means no other tender is checked at all.
        for k, t in (("a", bad_doc), ("a", good), ("b", good), ("b", db_fail), ("a", sanral)):
            c.rows("tender_packs").append({"id": str(uuid.uuid4()), "company_id": co[k], "tender_id": t["id"], "pipeline_stage": "bidding"})
        spec = ocds_doc("cccccccc-0000-0000-0000-000000000001", "Specification, roof trusses.pdf", "2026-10-16T08:05:36Z")
        addm = ocds_doc("cccccccc-0000-0000-0000-000000000002", "Wte1062-Addendum.docx", "2026-10-17T14:55:46Z", "docx")
        db_addm = ocds_doc("eeeeeeee-0000-0000-0000-000000000001", "ADDENDUM NO. 1.docx", "2026-10-17T11:00:00Z", "docx")
        files = {addm["url"]: addendum_docx(fixture("dws_wte1062ce_addendum1_ocr")),
                 db_addm["url"]: addendum_docx(fixture("ec_transport_scmu10_addendum1"))}
        feed = Feed()
        # The malformed release: a document entry that is a bare string, not an
        # object (what a half-written OCDS release looks like).
        bad_release = release(bad_doc["ocid"], [ocds_doc("ffffffff-0000-0000-0000-000000000001", "Bid.pdf", "2026-10-16T08:00:00Z")], "2026-11-04T09:00:00Z")
        bad_release["tender"]["documents"].append("Addendum 1.pdf")
        feed.releases[DAY] = [bad_release, release(good["ocid"], [spec, addm], "2026-11-04T09:00:00Z"),
                              release(db_fail["ocid"], [ocds_doc("eeeeeeee-0000-0000-0000-000000000000", "Bid document.pdf", "2026-10-16T08:00:00Z"),
                                                        db_addm], "2026-11-04T09:00:00Z")]
        page = {"url": "https://www.nra.co.za/open-tenders/nra-2026-0757-c", "closing_date": "2026/11/16 12:00",
                "attached_files": ["Tender document.pdf"], "file_count": "1"}
        logs = []

        def go():
            return watch.run(c, today=TODAY, fetch_ocds_day=feed, fetch_sanral=lambda slug: page,
                             fetch_doc=lambda url: files[url], log=logs.append)
        try:
            rep = go()
            raised = None
        except Exception as e:
            rep, raised = [], e
        check(raised is None, f"the run completes despite two failing tenders (raised: {type(raised).__name__ if raised else None}: {raised})")
        checked = {s["tender_id"] for s in c.select("tender_watch_state") if s.get("last_checked_at")}
        check(good["id"] in checked and sanral["id"] in checked,
              f"the good eTenders tender and the SANRAL tender after the bad one were both checked ({len(checked)} checked)")
        check(bad_doc["id"] not in checked and db_fail["id"] not in checked, "the two failing tenders were not marked checked")
        upd = [(e["company_id"], t["contract_no"], u["kind"]) for e in rep for t in e["tenders"] for u in t["updates"]]
        check(sorted(upd) == sorted([(co["a"], "WTE1062CE", "addendum"), (co["b"], "WTE1062CE", "addendum")]),
              f"the good tender's addendum is reported to both its pursuers, nothing from the failed ones ({upd})")
        s = c.select("tender_watched_documents", {"tender_id": sanral["id"]})
        check(len(s) == 1 and s[0]["baseline"], "the SANRAL tender's attached file is recorded as baseline")
        tu_alerts = [a for a in alerts if a["p_source"] == "tender_updates"]
        msgs = [a["p_message"] for a in tu_alerts]
        check(len(tu_alerts) == 2 and any("BADDOC-01" in m and "AttributeError" in m for m in msgs)
              and any("DBFAIL-01" in m and "statement timeout" in m for m in msgs),
              f"one system alert per failed tender, naming the tender and the reason ({msgs})")
        check(all(a["p_severity"] == "error" and a["p_detail"] and "Traceback" in a["p_detail"]
                  and a["p_context"].get("tender_id") in (bad_doc["id"], db_fail["id"]) for a in tu_alerts),
              "each alert is severity error, carries the traceback and the tender id")
        check(any("2 of 4 pursued tender(s) failed" in ln for ln in logs) and any("BADDOC-01: FAILED" in ln for ln in logs),
              "the run log says which tender failed and how many")
        # The fault clears (DB back): the next run catches up - nothing was lost.
        c.fail_tender_id = None
        alerts.clear()
        rep2 = go()
        upd2 = [(e["company_id"], t["contract_no"], u["kind"]) for e in rep2 for t in e["tenders"] for u in t["updates"]]
        check(upd2 == [(co["b"], "DBFAIL-01", "addendum")],
              f"next run, DB write works again: the skipped tender's addendum is reported then, once ({upd2})")
        check(len([a for a in alerts if "BADDOC-01" in a["p_message"]]) == 1 and len(alerts) == 1,
              "the still-malformed tender alerts again (one alert), nothing else does")
    finally:
        system_alerts.set_sink(None)


# ---------------------------------------------------------------------------
# Part 3 - the same on a replayed database, plus RLS
# ---------------------------------------------------------------------------

def seed_db(c):
    from test_manual_intake import lit  # noqa: F401
    c.sql("delete from tender_update_notifications; delete from tender_watched_documents; delete from tender_watch_state; "
          "delete from discovered_opportunities where ocid like 'ocds-9t57fa-99000%'; "
          "delete from tenders where slug in ('etenders-990001','etenders-990002','etenders-990003','etenders-990004','nra-2026-0756-c'); "
          "delete from companies where legal_name in ('Pursuer Bidding (Pty) Ltd','Pursuer Found CC','Feed Only Ltd','Lost It Ltd')")
    ids = {}
    for k, name in (("a", "Pursuer Bidding (Pty) Ltd"), ("b", "Pursuer Found CC"), ("c", "Feed Only Ltd"), ("d", "Lost It Ltd")):
        ids[k] = c.insert("companies", {"legal_name": name})["id"]
        for i, email in enumerate(MEMBER_EMAILS[k]):
            uid = c.sql(f"insert into auth.users (email) values ({'null' if email is None else repr(email)}) returning id").splitlines()[0]
            ids["u" + k + ("" if i == 0 else str(i + 1))] = uid
            c.insert("company_members", {"company_id": ids[k], "user_id": uid, "role": "owner" if i == 0 else "member"})

    def tender(**kw):
        return c.insert("tenders", {"status": "open", **kw})
    t1 = tender(slug="etenders-990001", contract_no="SCMU10-26/27-0017", ocid=OCID, source="etenders_ocds",
                closing_date="2026-10-26T09:00:00Z", description="Scholar transport",
                document_urls=[{"url": ocds_doc("aaaaaaaa-0000-0000-0000-000000000001", "", "")["url"], "title": "SCMU10 Bid document.pdf"}])
    tl = tender(slug="etenders-990002", contract_no="WTE1062CE", ocid=OCID_LATE, source="etenders_ocds", closing_date="2026-11-04T09:00:00Z",
                document_urls=[{"url": ocds_doc("bbbbbbbb-0000-0000-0000-000000000001", "", "")["url"], "title": "Specification"}])
    tu_ = tender(slug="etenders-990003", contract_no="NOBODY", ocid="ocds-9t57fa-990003", source="etenders_ocds", closing_date="2026-11-04T09:00:00Z")
    ts = tender(slug="nra-2026-0756-c", contract_no="NRA 2026/0756 (C)", source="sanral", closing_date="2026-11-16T10:00:00Z")
    td = tender(slug="etenders-990004", contract_no="DIS-0001", ocid=OCID_DIS, source="etenders_ocds", closing_date="2026-10-26T09:00:00Z",
                document_urls=[{"url": ocds_doc("dddddddd-0000-0000-0000-000000000001", "", "")["url"], "title": "Bid document.pdf"}])
    ids.update({"t1": t1["id"], "t_late": tl["id"], "t_unpursued": tu_["id"], "t_sanral": ts["id"], "t_dis": td["id"]})
    for co, t, stage in (("a", t1, "bidding"), ("b", t1, "found"), ("d", t1, "lost"), ("a", tl, "bidding"), ("b", tl, "found"),
                         ("a", ts, "bidding"), ("a", td, "bidding"), ("d", td, "lost")):
        c.insert("tender_packs", {"company_id": ids[co], "tender_id": t["id"], "pipeline_stage": stage})
    for co in ("a", "b", "d"):
        c.insert("tender_tasks", {"company_id": ids[co], "tender_id": t1["id"], "kind": "closing", "is_standard": True,
                                  "description": "Tender closes", "due_date": "2026-10-26"})
    for co in ("a", "b", "c"):
        c.insert("discovered_opportunities", {"company_id": ids[co], "ocid": OCID, "verdict": "possible",
                                              "closing_date": "2026-10-26T09:00:00Z", "first_seen": "2026-10-16T12:00:00Z"})
    c.insert("discovered_opportunities", {"company_id": ids["c"], "ocid": "ocds-9t57fa-990003", "verdict": "possible",
                                          "closing_date": "2026-11-04T09:00:00Z", "first_seen": "2026-10-16T12:00:00Z"})
    for co in ("a", "d"):
        c.insert("tender_tasks", {"company_id": ids[co], "tender_id": td["id"], "kind": "closing", "is_standard": True,
                                  "description": "Tender closes", "due_date": "2026-10-26"})
        c.insert("discovered_opportunities", {"company_id": ids[co], "ocid": OCID_DIS, "verdict": "possible",
                                              "closing_date": "2026-10-26T09:00:00Z", "first_seen": "2026-10-16T12:00:00Z"})
    return ids


def part3(psql):
    sys.path.insert(0, os.path.join(ROOT, "engine", "intake"))
    sys.path.insert(0, os.path.join(ROOT, "engine", "pack"))
    from test_manual_intake import Client

    class DbClient(Client):
        def rpc(self, fn, args=None):
            """PostgREST /rpc/<fn> with the service-role key: the JWT role claim set."""
            out = self.sql("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false); "
                           f"select coalesce(json_agg(r), '[]') from {fn}() r")
            return json.loads(out.split("\n", 1)[1])
    c = DbClient(psql, "/nonexistent")
    c.sql("grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated; "
          "grant execute on all functions in schema public to authenticated")
    ids = scenario(c, "3 - the watch on a scratch Postgres (every migration replayed)", seed_db)
    ok, n = c.as_user(ids["ua"], "select count(*) from tender_update_notifications")
    own = c.sql(f"select count(*) from tender_update_notifications where company_id = '{ids['a']}'")
    check(ok and n == own and int(n) > 0, f"RLS: a pursuer's member sees its own {own} notification(s) only ({n})")
    ok, n = c.as_user(ids["uc"], "select count(*) from tender_update_notifications")
    own_c = c.sql(f"select count(*) from tender_update_notifications where company_id = '{ids['c']}'")
    check(ok and n == own_c == "1", f"RLS: the feed-only company (a late joiner on one tender since run 6) sees only its own 1 notification ({n})")
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

    # company_member_labels() (0033/0048): a signed-in member still sees only
    # their own company's members; the service role (the engine) sees all.
    ok, n = c.as_user(ids["ub"], "select count(*) from company_member_labels()")
    check(ok and n == "1", f"labels: a member of the 1-member company sees 1 label, not everyone's ({n})")
    ok, out = c.as_user(ids["ua"], "select string_agg(label, ',' order by label) from company_member_labels()")
    check(ok and out == "estimator@pursuer-bidding.example,owner@pursuer-bidding.example",
          f"labels: a member of the bidding company sees its two members' e-mails ({out})")
    ok, n = c.as_user(ids["ua"], "select set_config('request.jwt.claims', '{\"role\":\"authenticated\"}', false); "
                                 "select count(*) from company_member_labels()")
    check(ok and n == "2", "labels: an authenticated JWT claim doesn't widen it")
    svc = c.rpc("company_member_labels")
    check(len(svc) >= 5 and {"owner@feed-only.example", "owner@lost-it.example"} <= {r["label"] for r in svc},
          f"labels: the service role sees every company's members ({len(svc)})")

    # 1. A person accepts the addendum's closing date the listing doesn't show.
    doc = ids["dis_doc"]
    accept = f"select accept_tender_update_date('{doc}', 'closing_date')"
    for who, why in (("uc", "a Discovery-feed-only company"), ("ud", "a company that lost the tender")):
        ok, err = c.as_user(ids[who], accept)
        check(not ok and "Only a company working on this tender" in err, f"accept: refused for {why}")
    check(c.sql(f"select closing_date from tenders where id = '{ids['t_dis']}'").startswith("2026-10-26"), "accept: nothing changed by the refusals")
    ok, out = c.as_user(ids["ua2"], accept)
    check(ok, f"accept: the bidding company's second member accepts it ({out[:200]})")
    tdis = c.select("tenders", {"id": ids["t_dis"]})[0]
    check(tdis["closing_date"].startswith("2026-11-06T09:00:00"), f"accept: tenders.closing_date = 6 Nov 11:00 SAST, the document's own time ({tdis['closing_date']})")
    dtasks = c.select("tender_tasks", {"tender_id": ids["t_dis"], "kind": "closing"})
    check(len(dtasks) == 2 and all(t["due_date"] == "2026-11-06" for t in dtasks),
          "accept: every company's 'Tender closes' milestone moved to 6 Nov (same rows the automatic path moves)")
    dopps = c.select("discovered_opportunities", {"ocid": OCID_DIS})
    check(len(dopps) == 2 and all(o["closing_date"] == tdis["closing_date"] for o in dopps), "accept: the Discovery rows for the release moved")
    ch = c.select("tender_watched_documents", {"id": doc})[0]["changes"]["closing_date"]
    check(ch["applied"] is True and ch["applied_by"] == "person" and ch["accepted_by"] == ids["ua2"]
          and ch["accepted_by_company"] == ids["a"] and ch.get("accepted_at") and ch["on_file_before_accept"].startswith("2026-10-26"),
          "accept: logged on the update - who (user + company), when, and the date it replaced")
    ok, err = c.as_user(ids["ua"], accept)
    check(not ok and "already been applied" in err, "accept: a second accept is refused")
    # Parity with the automatic path (t1, applied by apply_closing_date): the
    # same three places hold the same value.
    for tid, ocid in ((ids["t1"], OCID), (ids["t_dis"], OCID_DIS)):
        tc = c.select("tenders", {"id": tid})[0]["closing_date"]
        day = tu.to_date(tc).isoformat()
        tasks_ok = all(t["due_date"] == day for t in c.select("tender_tasks", {"tender_id": tid, "kind": "closing"}))
        opps_ok = all(o["closing_date"] == tc for o in c.select("discovered_opportunities", {"ocid": ocid}))
        check(tasks_ok and opps_ok, f"parity: {'automatic' if tid == ids['t1'] else 'accepted'} path - tender, every closing task and Discovery row agree ({tc})")

    # 2. Briefing: a contradicted date is accepted by a person the same way.
    c.sql(f"update tenders set briefing_date = '2026-10-25' where id = '{ids['t_late']}'")
    bdoc = c.insert("tender_watched_documents", {"tender_id": ids["t_late"], "doc_key": "x@briefing", "source": "etenders_ocds",
                                                  "title": "Addendum 2.pdf", "kind": "addendum", "urgency": "high",
                                                  "changes": {"briefing": {"date": "2026-10-29", "time": "10:00", "previous_date": "2026-10-22",
                                                                           "previous_on_file": "2026-10-25", "on_file_agrees": False,
                                                                           "applied": False, "quote": "Revised Site Briefing Date: 29 October 2026"}}})
    ok, out = c.as_user(ids["ub"], f"select accept_tender_update_date('{bdoc['id']}', 'briefing')")
    check(ok, f"accept briefing: the found company's member accepts it ({out[:160]})")
    tl = c.select("tenders", {"id": ids["t_late"]})[0]
    bt = c.select("tender_tasks", {"tender_id": ids["t_late"], "kind": "briefing"})
    check(tl["briefing_date"] == "2026-10-29" and tl["briefing_time"] == "10:00" and tl["briefing_source_document_id"] == bdoc["id"],
          "accept briefing: tenders.briefing_date/time = 29 Oct 10:00, from that document")
    check(len(bt) == 3 and all(t["due_date"] == "2026-10-29" and t["description"] == "Briefing session at 10:00" for t in bt),
          f"accept briefing: all 3 pursuers' briefing milestones moved, none duplicated ({len(bt)})")

    # 0048's index fix: the Workspace's own auto-seed statement (PostgREST
    # ?on_conflict=company_id,tender_id,kind + ignore-duplicates) now runs.
    ok, err = c.as_user(ids["ua"], f"insert into tender_tasks (company_id, tender_id, description, due_date, kind, is_standard) "
                                   f"values ('{ids['a']}', '{ids['t_late']}', 'Briefing session', '2026-10-29', 'briefing', true) "
                                   f"on conflict (company_id, tender_id, kind) do nothing")
    check(ok, f"auto-seed: on conflict (company_id, tender_id, kind) is accepted ({err[:120]})")
    ok, err = c.as_user(ids["ua"], f"insert into tender_tasks (company_id, tender_id, description, due_date, kind, is_standard) "
                                   f"values ('{ids['a']}', '{ids['t_late']}', 'Tender closes', '2026-11-04', 'closing', true) "
                                   f"on conflict (company_id, tender_id, kind) do nothing")
    n = c.sql(f"select count(*) from tender_tasks where tender_id = '{ids['t_late']}' and company_id = '{ids['a']}' and kind = 'closing'")
    check(ok and n == "1", "auto-seed: the closing milestone is created once")
    ok, _ = c.as_user(ids["ua"], f"insert into tender_tasks (company_id, tender_id, description) values ('{ids['a']}', '{ids['t_late']}', 'a'), "
                                 f"('{ids['a']}', '{ids['t_late']}', 'b')")
    check(ok, "auto-seed: manual tasks (kind null) are still unconstrained")


if __name__ == "__main__":
    part0_demo_slug_skip()
    part0b_sanral_closing_date_only_default()
    part1()
    scenario(MemClient(), "2 - the watch end to end (in-memory rows)", seed_mem)
    part2b()
    psql = os.environ.get("TU_PSQL")
    if psql:
        part3(psql)
    else:
        print("(Part 3 skipped - set TU_PSQL to a scratch Postgres with the migrations replayed)")
    print(f"\n{'ALL PASSED' if not FAILS else f'{len(FAILS)} FAILURE(S)'}")
    sys.exit(1 if FAILS else 0)
