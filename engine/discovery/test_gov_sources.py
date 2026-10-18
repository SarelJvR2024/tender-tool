"""
Offline tests for the government-source readers (etenders_portal.py,
eskom_bulletin.py, transnet_etenders.py, capetown_procurement.py,
gov_sources.py) and the listing-change tracker (tender_changes.py). No
network: every fixture is a real row read on 2026-10-17, trimmed, with the
contact fields the readers drop already removed.

Run: python3 engine/discovery/test_gov_sources.py   (exit 1 on any failure)
"""
import copy
import datetime
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402
import etenders_portal  # noqa: E402
import eskom_bulletin  # noqa: E402
import transnet_etenders  # noqa: E402
import capetown_procurement  # noqa: E402
import sars_procurement  # noqa: E402
import cidb_tenders  # noqa: E402
import dbsa_procurement  # noqa: E402
import gov_sources  # noqa: E402
import tender_changes  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


# --- real rows, 17 Oct 2026 ----------------------------------------------------
PORTAL_WTE1062 = {"id": 174359, "tender_No": "WTE1062CE", "description": "SUPPLY AND DELIVERY OF LOCAL CONTENT ROOF TIMBER TRUSSES AND 0.5 mm IBR ROOF COVERING SHEETS FOR THE KLIPFONTEIN DAM PROJECT IN VRYHEID, CLOSEST TOWN, KZN PROVINCE\r\n\r\n", "category": "Construction", "type": "Request for Quotation", "organ_of_State": "Water and Sanitation", "status": "Published", "closing_Date": "2026-11-04T11:00:00", "date_Published": "2026-10-16T00:00:00", "compulsory_briefing_session": "2026-10-22T10:00:00", "briefingVenue": "Klipfontein dam near Vryheid", "briefingSession": True, "briefingCompulsory": True, "province": "KwaZulu-Natal", "supportDocument": [{"supportDocumentID": "aeb54c1e-0940-499a-bacc-2d1aae03ced4", "fileName": "Wte1062-Addendum.pdf", "extension": ".pdf", "active": True, "dateModified": "2026-10-17T14:55:46.967768"}, {"supportDocumentID": "316c161c-807e-49e0-ba1d-5311397e2a88", "fileName": "Annexure  C.pdf", "extension": ".pdf", "active": True, "dateModified": "2026-10-16T08:37:53.2912197"}, {"supportDocumentID": "757e365b-78cb-45ed-a124-c3d999a3d8c1", "fileName": "Specification,Roof timber trusses for klipfontein.pdf", "extension": ".pdf", "active": True, "dateModified": "2026-10-16T08:05:36.1378286"}], "cancelled": None}
PORTAL_CANCELLED_TWICE = [  # the portal returns one row per cancellation record
    {"id": 174406, "tender_No": "IHLM-59/2026-27/ADMIN", "description": "TRAINING ON MUNICIPAL FINANCE MANAGEMENT PROGRAMME FOR 20 MUNICIPAL EMPLOYEES", "category": "Services: General", "type": "Request for Bid(Open-Tender)", "organ_of_State": "Ingquza Hill Local Municipality", "status": "Cancelled", "closing_Date": "2026-11-04T12:00:00", "date_Published": "2026-10-16T00:00:00", "briefingSession": False, "province": "Eastern Cape", "supportDocument": [], "cancelled": {"reason": "Error by publisher ie. Incorrect date, incorrect documents", "dateModified": "2026-10-16T13:22:35.7137263", "tendersID": 174406}},
    {"id": 174406, "tender_No": "IHLM-59/2026-27/ADMIN", "description": "TRAINING ON MUNICIPAL FINANCE MANAGEMENT PROGRAMME FOR 20 MUNICIPAL EMPLOYEES", "category": "Services: General", "type": "Request for Bid(Open-Tender)", "organ_of_State": "Ingquza Hill Local Municipality", "status": "Cancelled", "closing_Date": "2026-11-04T12:00:00", "date_Published": "2026-10-16T00:00:00", "briefingSession": False, "province": "Eastern Cape", "supportDocument": [], "cancelled": {"reason": "Error by publisher ie. Incorrect date, incorrect documents", "dateModified": "2026-10-16T13:22:37.4763741", "tendersID": 174406}},
]
PORTAL_SANRAL_0756C = {"id": 171756, "tender_No": "NRA 2026 / 0756 (C) ", "description": "ROUTINE ROAD MAINTENANCE NORTH WEST BATCH 3", "category": "Construction", "type": "Request for Bid(Open-Tender)", "organ_of_State": "South African National Roads Agency Soc Limited (SANRAL)", "status": "Published", "closing_Date": "2026-11-10T12:00:00", "date_Published": "2026-09-20T00:00:00", "briefingSession": False, "province": "North West", "supportDocument": [], "cancelled": None}
PORTAL_SANRAL_N011 = {"id": 174470, "tender_No": "N011-010-2027/1F ", "description": "FOR CONSULTING ENGINEERING SERVICES FOR THE PROVISION OF FLOOD MITIGATION MEASURES ON NATIONAL ROUTE N11 SECTION 1 IN LADYSMITH (KM 0.0 TO KM 10.0).", "category": "Services: Professional", "type": "Request for Bid(Open-Tender)", "organ_of_State": "South African National Roads Agency Soc Limited (SANRAL)", "status": "Published", "closing_Date": "2026-11-19T12:00:00", "date_Published": "2026-10-16T00:00:00", "briefingSession": False, "province": "KwaZulu-Natal", "supportDocument": [], "cancelled": None}
PORTAL_SANRAL_0754A_CLOSED = {"id": 171042, "tender_No": "NRA 2026/0754 (A)", "description": "GAUTENG RRM CONTRACTORS BATCH 1", "category": "Construction", "type": "Request for Bid(Open-Tender)", "organ_of_State": "South African National Roads Agency Soc Limited (SANRAL)", "status": "Closed", "closing_Date": "2026-10-15T12:00:00", "date_Published": "2026-09-15T00:00:00", "briefingSession": False, "province": "Gauteng", "supportDocument": [], "cancelled": None}
PORTAL_OTHER_BUYER_SAME_REF = {"id": 900001, "tender_No": "N011-010-2027/1F", "description": "Unrelated", "category": "Services: General", "type": "Request for Quotation", "organ_of_State": "Some Municipality", "status": "Published", "closing_Date": "2026-11-19T12:00:00", "date_Published": "2026-10-16T00:00:00", "briefingSession": False, "province": "Gauteng", "supportDocument": [], "cancelled": None}

ESKOM_TENDER = {"TENDER_ID": 90001, "DESCRIPTION": "GENERATION", "REFERENCE": "E3263GXPARN2", "HEADER_DESC": "The provision of Outside Plant MV Switchgear Upgrade at Arnot Power Station", "SCOPE_DETAILS": "The provision of Outside Plant MV Switchgear Upgrade at Arnot Power Station", "OFFICE_LOCATION": "ARNOT", "DOCS": 2, "CLOSING_DATE": "2026-10-21T10:00:00", "PUBLISHEDDATE": "2026-09-30T09:00:00", "DATEMODIFIED": "2026-09-30T09:00:00", "Audience": "All Suppliers", "Province": "Mpumalanga"}
ESKOM_NOTICES = [
    ("E3484CXMWPList of bidders", "List of bidders -E3484CXMWP Refurbishment and upgrading of e", "bidders_list", "E3484CXMWP"),
    ("MWP2524DXcancellatio", "Cancellation TEAP PROCESS FOR THE SUPPLY AND DELIVERY OF BULK METERED", "cancellation", "MWP2524DX"),
    ("CANCELLAE3122GXGPLET", "CANCELLATION - FOR SUPPLY AND DELIVERY OF DRUMS", "cancellation", "E3122GXGPLET"),
    ("VALIDITYE2442DXFSOU", "Validity extension-Establishing an Enabling Agreement", "validity_extension", "E2442DXFSOU"),
    ("E3573GXMPKRI", "TENDER CLOSING EXTENDED: Supply and Delivery of Critical spares", "closing_date_extension", "E3573GXMPKRI"),
    ("MPARN11462GXAWARD", "Notification of Award of MPARN11462GX Provision of", "award", "MPARN11462GX"),
    ("E2778DXGOURegretLett", "E2778DXGOU - REGRET LETTER THE SUPPLY, DELIVERY AN", "regret", "E2778DXGOU"),
    # a real tender whose title contains "EXTENSION" (a building extension) - not a notice
    ("E3464CXMWPERE", "NTCSA EXECUTIVE OFFICE EXTENSION AT MEGAWATT PARK (MWP) AND", "tender", None),
]
TRANSNET_ROW = {"nameOfTender": "BT1TRIMRFPWR2 Orchard", "descriptionOfTender": "TRIMMING OF VEGETATION ALONG THE RAIL RESERVE - ORCHARD", "tenderNumber": "TFR/2026/08/0004/114727/RFP", "briefingDate": "10/28/2026 11:00:00 AM", "briefingDetails": "A non-compulsory briefing session will be conducted via Microsoft Teams", "closingDate": "11/30/2026 10:00:00 AM", "publishedDate": "9/23/2026 5:08:39 PM", "tenderType": "RFP", "locationOfService": "Western Cape", "nameOfInstitution": "TFR", "tenderCategory": "Services", "tenderStatus": "Open", "rowKey": "114727"}
CAPETOWN_RFQ_HTML = """<table><tr><th>Reference Number</th><th>Title</th><th>Category</th><th>Closing Date</th><th>Closing Date Sortable</th><th>Posted Date</th><th>Posted Date Sortable</th><th></th></tr>
<tr><td>GA12700333</td><td>Ladies softshell jacket navy 3xl</td><td>Clothing, PPE &amp; Accessories</td><td>2026/10/28</td><td>10/28/2026 12:00:00 PM</td><td>2026/10/17</td><td>10/17/2026 2:20:39 PM</td><td><a href="/web1/procurementportal/RFQ/Details/331433">View</a></td></tr></table>"""
CAPETOWN_AWARD_DETAIL = "<div><h3>Award Status</h3><dl><dt>Status</dt><dd>Awarded</dd><dt>Reference Number</dt><dd>GH12700188</dd><dt>Title</dt><dd>THERMOSTAT;HWC;35-70 Celc;VKF-11</dd><dt>Date</dt><dd>2026/10/16</dd><dt>To</dt><dd>ALWAYS SUPERLATIVE</dd></dl><a>Back</a></div>"

# --- real rows, 18 Oct 2026 (sars_procurement / cidb_tenders / dbsa_procurement) ---
SARS_PAGE_HTML = """<h2>What&#8217;s New</h2><ul><li><strong>16 October 2026 &#8211; New Tender</strong><ul>
<li><a href="https://www.sars.gov.za/tender/rfp14-2026-appointment-of-armed-security/">RFP14/2026: Appointment of armed security service provider | South African Revenue Service</a></li>
</ul></li><li><strong>15 October 2026 &#8211;</strong><ul>
<li><a href="https://www.sars.gov.za/tender/rfp13-2026-specialist-resources/">RFP13/2026: Appointment of specialist resources | South African Revenue Service</a></li>
</ul></li></ul>"""

CIDB_FEED_OPEN = {"tender_ID": "34", "description": "Appointment of a service provider to review the cidb standard",
                   "bid_number": "cidb 010 2526", "tender_advert_file": "https://www.cidb.org.za/wp-content/x.pdf",
                   "tender_briefing_file": "", "tender_advert_date_time": "2025-10-24 12:17:31",
                   "tender_awards_date_time": "2025-10-24 12:17:31", "status": "active", "realstatus": "Open"}
CIDB_FEED_AWARDED = {"tender_ID": "47", "description": "Website hosting and maintenance",
                      "bid_number": "cidb 001 2627", "tender_advert_file": "", "tender_briefing_file": "",
                      "tender_advert_date_time": "2026-09-14 09:12:33", "tender_awards_date_time": "2026-10-15 08:16:17",
                      "status": "active", "realstatus": "Awarded"}

DBSA_TABLE_HTML = """<table><tr><th>OPEN RFP's and RFR's</th><th>Date Published</th><th>Closing Date and Time</th></tr>
<tr><td><a href="/sites/default/files/x.pdf">RFP 164/2026:  Appointment of a Professional Service Provider</a></td><td>12 October 2026</td><td>02 November 2026 @ 23H55</td></tr>
<tr><td>RFP 186/2026:  A typo&#39;d closing date tender</td><td>2 October 2026</td><td>23 Ocober 2026 @ 23H55</td></tr>
</table>"""


def sanral_site(reference, closing, scm=None, title=None, slug=None):
    r = sh.release(ocid=f"sanral:{slug or sh.norm_ref(reference)}", contract_number=reference, title=title or reference,
                   description=title, buyer="South African National Roads Agency Soc Limited (SANRAL)",
                   closing_date=closing, source="sanral", source_id=slug, source_url=f"https://www.nra.co.za/open-tenders/{slug}",
                   status="advertised")
    r["scm_reference"] = scm
    return r


def test_source_http():
    print("source_http")
    check("SAST naive", sh.iso_sast("2026-11-16T12:00:00") == "2026-11-16T12:00:00+02:00")
    check("US date (Transnet)", sh.iso_sast("11/30/2026 3:00:00 PM") == "2026-11-30T15:00:00+02:00")
    check("slash date (Cape Town / SANRAL)", sh.iso_sast("2026/11/19 12:00") == "2026-11-19T12:00:00+02:00")
    check("year-1 placeholder is None", sh.iso_sast("0001-01-01T00:00:00") is None)
    check("system timestamp read as UTC", sh.iso_utc("2026-10-17T14:55:46.967768") == "2026-10-17T16:55:46.967768+02:00")
    check("norm_ref strips CONTRACT SANRAL:", sh.norm_ref("CONTRACT SANRAL: C.003-092-2024/1F") == sh.norm_ref("C-003-092-2024/1F"))


def test_portal():
    print("etenders_portal")
    r = etenders_portal.normalize(PORTAL_WTE1062)
    check("ocid join rule", r["ocid"] == "ocds-9t57fa-174359")
    check("bid number is contract_number", r["contract_number"] == "WTE1062CE")
    check("title is the description", r["title"].startswith("SUPPLY AND DELIVERY OF LOCAL CONTENT"))
    check("briefing compulsory", r["briefing"] == {"date": "2026-10-22T10:00:00+02:00", "compulsory": True, "venue": "Klipfontein dam near Vryheid"})
    check("document link", r["documents"][0]["url"].startswith("https://www.etenders.gov.za/home/Download?blobName=aeb54c1e-0940-499a-bacc-2d1aae03ced4.pdf"))
    check("status advertised", r["status"] == "advertised" and r["province"] == "KwaZulu-Natal")
    rows = etenders_portal.dedupe_rows(PORTAL_CANCELLED_TWICE)
    check("two cancellation rows -> one tender", len(rows) == 1 and len(rows[0]["_cancellations"]) == 2)
    c = etenders_portal.normalize(rows[0], "cancelled")
    check("cancellation reason + latest time", c["status"] == "cancelled" and c["cancellation"]["reason"].startswith("Error by publisher")
          and c["cancellation"]["cancelled_at"].startswith("2026-10-16T15:22:37"))


def test_eskom():
    print("eskom_bulletin")
    for ref, head, kind, base in ESKOM_NOTICES:
        e = dict(ESKOM_TENDER, REFERENCE=ref, HEADER_DESC=head)
        got = eskom_bulletin.classify(e)
        check(f"classify {ref}", got == kind, got)
        if base:
            check(f"refers to {base}", eskom_bulletin.base_reference(ref) == base, eskom_bulletin.base_reference(ref))
    r = eskom_bulletin.normalize(ESKOM_TENDER, [{"title": "Scope.pdf", "url": eskom_bulletin.FILE_URL.format(id=1)}])
    check("tender normalised", r["ocid"] == "eskom-bulletin:90001" and r["notice_kind"] is None and r["buyer"] == "ESKOM - Generation")
    check("no contact e-mail kept", "EMAIL" not in json.dumps(r) and "eskom.co.za" not in json.dumps({k: v for k, v in r.items() if k != "source_url" and k != "documents" and k != "listing_sources"}))


def test_transnet_capetown():
    print("transnet_etenders / capetown_procurement")
    t = transnet_etenders.normalize(TRANSNET_ROW)
    check("Transnet title is the description, not the internal code", t["title"].startswith("TRIMMING OF VEGETATION"))
    check("Transnet division name", t["buyer"] == "Transnet Freight Rail")
    check("Transnet US dates", t["closing_date"] == "2026-11-30T10:00:00+02:00")
    check("non-compulsory briefing", t["briefing"]["compulsory"] is False)
    rows = capetown_procurement.parse_table(CAPETOWN_RFQ_HTML)
    check("Cape Town table: header skipped", len(rows) == 1)
    r = capetown_procurement.normalize_rfq(*rows[0])
    check("Cape Town RFQ", r["contract_number"] == "GA12700333" and r["closing_date"] == "2026-10-28T12:00:00+02:00"
          and r["ocid"] == "capetown-rfq:331433" and r["procurement_category"] == "Clothing, PPE & Accessories")
    check("Cape Town award supplier", capetown_procurement.parse_award_detail(CAPETOWN_AWARD_DETAIL) == "ALWAYS SUPERLATIVE")


def test_new_sources():
    print("sars_procurement / cidb_tenders / dbsa_procurement")
    import html as html_mod
    entries = sars_procurement.parse_listing(html_mod.unescape(SARS_PAGE_HTML))
    check("SARS: 2 dated entries found", len(entries) == 2, len(entries))
    r = sars_procurement.normalize(entries[0])
    check("SARS ref parsed", r["contract_number"] == "RFP14/2026")
    check("SARS title excludes the ' | South African Revenue Service' suffix",
          r["title"] is not None and "South African Revenue Service" not in r["title"], r["title"])
    check("SARS published date", r["published_date"] == "2026-10-16T00:00:00+02:00")

    open_r = cidb_tenders.normalize(CIDB_FEED_OPEN)
    awarded_r = cidb_tenders.normalize(CIDB_FEED_AWARDED)
    check("cidb: status field ('active') is NOT the open signal", CIDB_FEED_AWARDED["status"] == "active")
    check("cidb: realstatus is", open_r["status"] == "advertised" and awarded_r["status"] == "awarded")
    check("cidb: no closing_date field published -> unset, not treated as expired",
          open_r["closing_date"] is None and open_r["is_closed"] is False)

    rows = dbsa_procurement.parse_table(DBSA_TABLE_HTML)
    check("DBSA: header row skipped, 2 tenders parsed", len(rows) == 2, len(rows))
    rels = [dbsa_procurement.normalize(r) for r in rows]
    check("DBSA ref + closing date", rels[0]["contract_number"] == "RFP164/2026"
          and rels[0]["closing_date"] == "2026-11-02T00:00:00+02:00")
    check("DBSA doc link resolved to an absolute URL", rels[0]["documents"][0]["url"].startswith("https://www.dbsa.org/"))
    check("DBSA: a typo'd month ('Ocober') in the closing date -> unset, not a crash", rels[1]["closing_date"] is None)

    check("new sources registered in ALL_SOURCES", {"sars_procurement", "cidb_tenders", "dbsa_procurement"}
          <= set(gov_sources.ALL_SOURCES))
    check("new sources have labels", all(gov_sources.SOURCE_LABELS.get(s) for s in
          ("sars_procurement", "cidb_tenders", "dbsa_procurement")))


def test_merge():
    print("gov_sources.merge")
    portal = [etenders_portal.normalize(x) for x in (PORTAL_SANRAL_0756C, PORTAL_SANRAL_N011, PORTAL_OTHER_BUYER_SAME_REF)]
    closed = [etenders_portal.normalize(PORTAL_SANRAL_0754A_CLOSED)]
    site = [
        # SANRAL lists by contract number; the portal by NRA bid number. The
        # SCM reference on SANRAL's page is the bridge.
        sanral_site("CONTRACT SANRAL: X.002-211-2024/1F", "2026-11-10T12:00:00+02:00", scm="NRA 2026/0756 (C)", slug="x002"),
        sanral_site("N.011-010-2027/1F", "2026-11-13T12:00:00+02:00", slug="n011"),  # portal says 19 Nov
        sanral_site("NRA2026/0754 (A)", "2026-11-06T12:00:00+02:00", scm="NRA2026/0754 (A)", slug="nra2026-0754-a"),
        sanral_site("NRA 2026/0021", "2026-11-02T12:00:00+02:00", slug="nra-2026-0021"),
        sanral_site("NRA 2026/0021 (B)", "2026-11-02T12:00:00+02:00", slug="nra-2026-0021-b"),
    ]
    m = gov_sources.merge({"etenders_portal": portal, "sanral": site}, closed)
    by = {x["ocid"]: x for x in m}
    c = by["ocds-9t57fa-171756"]
    check("matched on the NRA bid number via SCM reference", [s["source"] for s in c["listing_sources"]] == ["etenders_portal", "sanral"])
    n = by["ocds-9t57fa-174470"]
    check("matched on the contract number", len(n["listing_sources"]) == 2)
    check("closing-date disagreement recorded", any(d["field"] == "closing_date" for d in n.get("source_disagreements", [])))
    check("other buyer with the same reference NOT folded", len(by["ocds-9t57fa-900001"]["listing_sources"]) == 1)
    a = by.get("ocds-9t57fa-171042")
    check("open on SANRAL, Closed on portal -> folded, portal ocid kept", a is not None and a["status"] == "advertised"
          and a["closing_date"] == "2026-11-06T12:00:00+02:00" and not a["is_closed"])
    check("... and the disagreement says the portal closed it", a and any(d["field"] == "status" and d["base_value"] == "closed" for d in a["source_disagreements"]))
    check("same-source lots not folded together", "sanral:nra-2026-0021" in by and "sanral:nra-2026-0021-b" in by)
    lot = etenders_portal.normalize(dict(PORTAL_SANRAL_0756C, id=900002, tender_No="NRA 2026/0021 (B)",
                                         description="RRM LIMPOPO BATCH 2 - NRA 2026/0021"))
    m2 = gov_sources.merge({"etenders_portal": [lot], "sanral": [sanral_site("NRA 2026/0021", "2026-09-21T12:00:00+02:00", slug="nra-2026-0021")]})
    check("a bid number without a lot letter doesn't swallow one of its lots",
          len([x for x in m2 if x["ocid"] == "ocds-9t57fa-900002"][0]["listing_sources"]) == 1)
    check("SANRAL ids: contract + bid number", gov_sources.sanral_ids("BID NUMBER: NRA 2026/0754 (B) CONTRACT SANRAL N.011-010-2017/1F")
          == {"NRA:2026/754B", "SC:N01101020171F"})


def test_changes():
    print("tender_changes")
    base = etenders_portal.normalize(PORTAL_WTE1062)
    ev, snaps = tender_changes.detect([base], {})
    late = [e for e in ev if e["change_type"] == "document_added"]
    check("first sighting: addendum uploaded after publication reported", len(late) == 1 and "Wte1062-Addendum.pdf" in late[0]["summary"])
    check("first sighting: ordinary annexure uploaded at publication not reported", not any("Annexure" in e["summary"] for e in ev))
    # second run: closing date extended, briefing moved, a new document listed
    later = copy.deepcopy(base)
    later["closing_date"] = "2026-11-18T11:00:00+02:00"
    later["briefing"]["date"] = "2026-10-29T10:00:00+02:00"
    later["documents"].append({"title": "Addendum 2 - extension of closing date.pdf", "url": "https://x/y.pdf"})
    ev2, _ = tender_changes.detect([later], snaps)
    kinds = sorted(e["change_type"] for e in ev2)
    check("closing date extension detected", any(e["change_type"] == "closing_date_changed" and "extended" in e["summary"] for e in ev2), kinds)
    check("briefing move detected", "briefing_changed" in kinds)
    check("new document detected", any(e["change_type"] == "document_added" and "Addendum 2" in e["summary"] for e in ev2))
    earlier = copy.deepcopy(base)
    earlier["closing_date"] = "2026-10-30T11:00:00+02:00"
    ev3, _ = tender_changes.detect([earlier], snaps)
    check("closing date brought forward flagged", any("BROUGHT FORWARD" in e["summary"] for e in ev3))
    ev4, _ = tender_changes.detect([base], snaps)
    check("no change -> nothing", ev4 == [] or all(e["change_type"] == "document_added" and False for e in ev4), [e["summary"] for e in ev4])
    # cancellation + re-advertisement of the same title
    cancelled = [etenders_portal.normalize(etenders_portal.dedupe_rows(PORTAL_CANCELLED_TWICE)[0], "cancelled")]
    readv = etenders_portal.normalize(dict(PORTAL_CANCELLED_TWICE[0], id=174500, tender_No="IHLM-59/2026-27/ADMIN-R",
                                           status="Published", cancelled=None))
    ev5, _ = tender_changes.detect([readv], {}, cancelled)
    check("cancellation event with reason", any(e["change_type"] == "cancelled" and "Error by publisher" in e["summary"]
                                                and e["ocid"] == "ocds-9t57fa-174406" for e in ev5))
    check("re-advertisement linked to the cancelled tender", any(e["change_type"] == "readvertised" and e["old_value"]["ocid"] == "ocds-9t57fa-174406" for e in ev5))
    # the buyer listed the same bid number again, later, with a later date (EC Transport, live 17 Oct)
    first = etenders_portal.normalize(dict(PORTAL_WTE1062, id=171679, tender_No="SCMU10-26/27-0017 A", organ_of_State="Eastern Cape - Transport",
                                           closing_Date="2026-10-26T11:00:00", date_Published="2026-09-20T00:00:00", supportDocument=[]))
    again = etenders_portal.normalize(dict(PORTAL_WTE1062, id=171925, tender_No="SCMU10-26/27-0017A", organ_of_State="Eastern Cape - Transport",
                                           closing_Date="2026-11-06T11:00:00", date_Published="2026-09-28T00:00:00", supportDocument=[]))
    rl = tender_changes.relistings([first, again])
    check("re-listing with a later date reported on the older listing", len(rl) == 1 and rl[0]["ocid"] == "ocds-9t57fa-171679"
          and rl[0]["change_type"] == "readvertised" and "06 Nov 2026" in rl[0]["summary"])
    closed_row = etenders_portal.normalize(dict(PORTAL_WTE1062, status="Closed", bidders=[
        {"biddersName": "ONLY4U STATIONERS", "amount": None, "updatedBy": "An Official", "isDeleted": False},
        {"biddersName": "MSUTHU GWACA GROUP OF COMPANIES", "amount": 120000.0, "updatedBy": "An Official", "isDeleted": False},
        {"biddersName": "DELETED CO", "amount": None, "isDeleted": True}]))
    check("portal bidders kept, official's name dropped, deleted skipped",
          closed_row.get("bidders") == [{"name": "ONLY4U STATIONERS", "amount": None}, {"name": "MSUTHU GWACA GROUP OF COMPANIES", "amount": 120000.0}])
    pb = tender_changes.portal_bidders([closed_row])
    check("bidders list event", len(pb) == 1 and pb[0]["change_type"] == "bidders_list_published" and "1 with a price" in pb[0]["summary"])
    # same-day hour difference between sources is not a moved deadline
    r = copy.deepcopy(base)
    r["source_disagreements"] = [{"field": "closing_date", "source": "eskom_bulletin", "value": "2026-11-04T10:00:00+02:00",
                                  "base_source": "etenders_portal", "base_value": "2026-11-04T11:00:00+02:00"}]
    check("same-day hour difference suppressed", not tender_changes.disagreements(r))
    # local store dedupes across runs
    with tempfile.TemporaryDirectory() as d:
        store = tender_changes.LocalStore(os.path.join(d, "s.json"), os.path.join(d, "c.json"))
        new1 = store.save(snaps, ev2)
        new2 = store.save(snaps, ev2)
        check("store: a change is recorded once", len(new1) == len(ev2) and new2 == [])
        recent = store.recent_changes({base["ocid"]}, datetime.datetime.now(sh.SAST) - datetime.timedelta(hours=1))
        check("store: recent changes by ocid", len(recent) == len(ev2))
    # Eskom notice attaches to the tender it names
    tender = eskom_bulletin.normalize(dict(ESKOM_TENDER, REFERENCE="E3484CXMWP"))
    notice = eskom_bulletin.normalize(dict(ESKOM_TENDER, TENDER_ID=90002, REFERENCE="E3484CXMWPList of bidders",
                                           HEADER_DESC="List of bidders", PUBLISHEDDATE=datetime.date.today().isoformat() + "T09:00:00"))
    ev6 = tender_changes.eskom_notices([notice], [tender])
    check("Eskom bidders list attached to its tender", len(ev6) == 1 and ev6[0]["change_type"] == "bidders_list_published"
          and ev6[0]["ocid"] == "eskom-bulletin:90001")


def test_digest():
    print("daily_digest listing_changes")
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "notify"))
    import daily_digest
    changes = [{"ocid": "a", "change_type": "document_added", "contract_number": "X"},
               {"ocid": "a", "change_type": "cancelled", "contract_number": "X"},
               {"ocid": "b", "change_type": "cancelled", "contract_number": "Y"}]
    sig = daily_digest.listing_change_signals(changes, [{"ocid": "a"}])
    check("only this company's feed, cancellation first", [c["change_type"] for c in sig] == ["cancelled", "document_added"])
    base = {k: [] for k in ("new_tenders", "document_expiry", "tender_tasks", "readiness_changes", "submission_due", "tender_updates")}
    viewer = daily_digest.build_digest_for_person({"name": "V", "tender_role": "viewer"}, dict(base, listing_changes=sig))
    check("viewer gets a count", viewer.get("listing_changes") == {"count": 2, "cancelled": 1})
    full = daily_digest.build_digest_for_person({"name": "F", "tender_role": "full_cycle"}, dict(base, listing_changes=sig))
    check("full_cycle gets the items", len(full.get("listing_changes") or []) == 2)


if __name__ == "__main__":
    test_source_http()
    test_portal()
    test_eskom()
    test_transnet_capetown()
    test_new_sources()
    test_merge()
    test_changes()
    test_digest()
    print(f"\n{'ALL PASSED' if not FAILS else str(len(FAILS)) + ' FAILED: ' + ', '.join(FAILS)}")
    sys.exit(1 if FAILS else 0)
