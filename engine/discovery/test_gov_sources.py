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
    # real live row, 2026-11-01: "award" glued directly onto the station code with
    # no separator at all (unlike MPARN11462GXAWARD above, which has a space-
    # preceded "Award" in its own header text) - found 2026-11-01 misclassified
    # as "tender" when \baward required a boundary that doesn't exist here.
    ("E1828GXMPTUTaward", "Provision of 24-hour emergency spillage response and rehabilitation services for a period of 5 Years at Tutuka Power Station, on as and when required basis, Award.", "award", "E1828GXMPTUT"),
    ("E2778DXGOURegretLett", "E2778DXGOU - REGRET LETTER THE SUPPLY, DELIVERY AN", "regret", "E2778DXGOU"),
    # a real tender whose title contains "EXTENSION" (a building extension) - not a notice
    ("E3464CXMWPERE", "NTCSA EXECUTIVE OFFICE EXTENSION AT MEGAWATT PARK (MWP) AND", "tender", None),
    # Real live rows, 2026-11-05 (QA pass): REFERENCE truncates at 20 characters, so a
    # long enough glued notice word gets cut mid-word and the old REF_NOTICE_WORDS list
    # never matched the surviving fragment - refers_to_reference ended up as the WHOLE
    # glued string (notice word and all), which then matches no real tender's own clean
    # reference, silently orphaning the notice from the tender it was about.
    ("E2116DXFSOURValidit", "Validity Extension 2-Integrated Security System Technology Proposal fo",
     "validity_extension", "E2116DXFSOUR"),  # "Validity" cut to "Validit" - missing its own last letter
    ("E2292GXMPKRINOTIFICA", "Notification of Award to Successful and Regret to Unsuccessful Tendere",
     "award", "E2292GXMPKRI"),  # "Notification" cut to "NOTIFICA" - a word this list never had at all
    # "name" (singular - the list only had plural "names") fixes the same shape for a
    # "Name of..."/"...Name" glued prefix/suffix.
    ("NAMEOFE2818GXMPARNR", "Name of the Bidders for Provision of Air Heater Air in Leaka",
     "bidders_list", "E2818GXMPARNR"),
    ("BIDDERSNAME1404GXPOU", "BIDDERS NAME FOR CONTROL AND INSTRUMENTATION SITE INSTALLATI",
     "bidders_list", "1404GXPOU"),  # "bidders" alone left "NAME" glued to the real reference behind it
]
TRANSNET_ROW = {"nameOfTender": "BT1TRIMRFPWR2 Orchard", "descriptionOfTender": "TRIMMING OF VEGETATION ALONG THE RAIL RESERVE - ORCHARD", "tenderNumber": "TFR/2026/08/0004/114727/RFP", "briefingDate": "10/28/2026 11:00:00 AM", "briefingDetails": "A non-compulsory briefing session will be conducted via Microsoft Teams", "closingDate": "11/30/2026 10:00:00 AM", "publishedDate": "9/23/2026 5:08:39 PM", "tenderType": "RFP", "locationOfService": "Western Cape", "nameOfInstitution": "TFR", "tenderCategory": "Services", "tenderStatus": "Open", "rowKey": "114727"}
CAPETOWN_RFQ_HTML = """<table><tr><th>Reference Number</th><th>Title</th><th>Category</th><th>Closing Date</th><th>Closing Date Sortable</th><th>Posted Date</th><th>Posted Date Sortable</th><th></th></tr>
<tr><td>GA12700333</td><td>Ladies softshell jacket navy 3xl</td><td>Clothing, PPE &amp; Accessories</td><td>2026/10/28</td><td>10/28/2026 12:00:00 PM</td><td>2026/10/17</td><td>10/17/2026 2:20:39 PM</td><td><a href="/web1/procurementportal/RFQ/Details/331433">View</a></td></tr></table>"""
CAPETOWN_AWARD_DETAIL = "<div><h3>Award Status</h3><dl><dt>Status</dt><dd>Awarded</dd><dt>Reference Number</dt><dd>GH12700188</dd><dt>Title</dt><dd>THERMOSTAT;HWC;35-70 Celc;VKF-11</dd><dt>Date</dt><dd>2026/10/16</dd><dt>To</dt><dd>ALWAYS SUPERLATIVE</dd></dl><a>Back</a></div>"

# --- real rows, 18 Oct 2026 (sars_procurement / cidb_tenders / dbsa_procurement) ---
# The <p> "Published Tenders" detail blocks below (real live shape, found
# 2026-11-06) are a SEPARATE section from the dated <ul> summary list above -
# RFP14/2026 states a closing date there; RFP13/2026 deliberately doesn't
# (confirms a tender with no stated closing date still parses, closing=None,
# not a crash). 10/11/2026 is chosen deliberately: day and month both <=12,
# the exact shape that would silently come out as 11 October instead of the
# correct 10 November if this were ever routed through source_http.parse_sast()'s
# US-style (month-first) branch instead of being parsed as the day-first
# format SARS's own page actually uses.
SARS_PAGE_HTML = """<h2>What&#8217;s New</h2><ul><li><strong>16 October 2026 &#8211; New Tender</strong><ul>
<li><a href="https://www.sars.gov.za/tender/rfp14-2026-appointment-of-armed-security/">RFP14/2026: Appointment of armed security service provider | South African Revenue Service</a></li>
</ul></li><li><strong>15 October 2026 &#8211;</strong><ul>
<li><a href="https://www.sars.gov.za/tender/rfp13-2026-specialist-resources/">RFP13/2026: Appointment of specialist resources | South African Revenue Service</a></li>
</ul></li></ul>
<h2>Published Tenders</h2>
<p><strong>RFP14/2026: Appointment of armed security service provider</strong><br>
Closing Date: 10/11/2026 11:00 (<a href="https://www.sars.gov.za/tender/rfp14-2026-appointment-of-armed-security/">Click here for tender documents</a>)<br>
Briefing Session Date: (Non-Compulsory) 2026/10/26 at 11:00</p>
<p><strong>RFP13/2026: Appointment of specialist resources</strong><br>
(<a href="https://www.sars.gov.za/tender/rfp13-2026-specialist-resources/">Click here for tender documents</a>)</p>"""

CIDB_FEED_OPEN = {"tender_ID": "34", "description": "Appointment of a service provider to review the cidb standard",
                   "bid_number": "cidb 010 2526", "tender_advert_file": "https://www.cidb.org.za/wp-content/x.pdf",
                   "tender_briefing_file": "", "tender_advert_date_time": "2025-10-24 12:17:31",
                   "tender_awards_date_time": "2025-10-24 12:17:31", "status": "active", "realstatus": "Open"}
CIDB_FEED_AWARDED = {"tender_ID": "47", "description": "Website hosting and maintenance",
                      "bid_number": "cidb 001 2627", "tender_advert_file": "", "tender_briefing_file": "",
                      "tender_advert_date_time": "2026-09-14 09:12:33", "tender_awards_date_time": "2026-10-15 08:16:17",
                      "status": "active", "realstatus": "Awarded"}

# Real row, checked live 2026-11-07 (cidb 004 2627): the description field
# itself embeds a raw <a href> to a second real document (a pricing
# schedule) that tender_advert_file/tender_briefing_file never mention.
CIDB_FEED_DESC_LINK = {
    "tender_ID": "46", "bid_number": "cidb 004 2627",
    "description": ("Appointment of a service provider for electrical infrastructure upgrade project.\r\n\r\n"
                     '<a href="https://www.cidb.org.za/wp-content/uploads/2026/06/Annexure-B-BOQ.xlsx" '
                     'target="_blank" style="color:#b62836;font-weight:bold;">Click here</a> to download the '
                     "Pricing Schedule.\r\n\r\n\r\n"),
    "tender_advert_file": "https://www.cidb.org.za/wp-content/tender-uploads/x.pdf", "tender_briefing_file": "",
    "tender_advert_date_time": "2026-06-01 17:35:25", "tender_awards_date_time": "2026-06-29 12:58:56",
    "status": "active", "realstatus": "Awarded",
}
# Real row, checked live 2026-11-07 (cidb 005 2526): the real site's own
# markup is missing the opening quote on href (`href=...xlsx"`, closing
# quote still there) - the real malformed shape, not a hypothetical.
CIDB_FEED_DESC_LINK_UNQUOTED = {
    "tender_ID": "43", "bid_number": "cidb 005 2526",
    "description": ("Appointment of a service provider/s for general maintenance.\r\n"
                     '<a href=https://www.cidb.org.za/wp-content/uploads/2026/04/annexure-a.xlsx" '
                     'target="_blank" style="color:#b62836;font-weight: bold;">Click here</a> to download the '
                     "corrected Pricing Schedule for General Maintenance."),
    "tender_advert_file": "", "tender_briefing_file": "",
    "tender_advert_date_time": "2026-01-01 00:00:00", "tender_awards_date_time": "2026-01-01 00:00:00",
    "status": "active", "realstatus": "Awarded",
}

# Synthetic, not a live reproduction (SARS's own live page had only 2 open
# tenders, 2 distinct refs, when checked 2026-11-07 - too small a sample to
# ever show a real collision) - mirrors Kouga's and DBSA's own REAL reused-ref
# cases: an original "16 October" dated entry and a later "5 November"
# re-advertisement, same Ref No. ("RFP99/2026"), two different detail-page
# URLs. Fixed proactively per this review's own standing backlog note, closed
# with this regression test rather than left open indefinitely.
SARS_REUSED_REF_HTML = """<h2>What&#8217;s New</h2><ul><li><strong>16 October 2026 &#8211; New Tender</strong><ul>
<li><a href="https://www.sars.gov.za/tender/rfp99-2026-original/">RFP99/2026: Original listing | South African Revenue Service</a></li>
</ul></li><li><strong>5 November 2026 &#8211; New Tender</strong><ul>
<li><a href="https://www.sars.gov.za/tender/rfp99-2026-readvertised/">RFP99/2026: Re-advertised listing | South African Revenue Service</a></li>
</ul></li></ul>
<h2>Published Tenders</h2>
<p><strong>RFP99/2026: Original listing</strong><br>
(<a href="https://www.sars.gov.za/tender/rfp99-2026-original/">Click here for tender documents</a>)</p>
<p><strong>RFP99/2026: Re-advertised listing</strong><br>
(<a href="https://www.sars.gov.za/tender/rfp99-2026-readvertised/">Click here for tender documents</a>)</p>"""

DBSA_TABLE_HTML = """<table><tr><th>OPEN RFP's and RFR's</th><th>Date Published</th><th>Closing Date and Time</th></tr>
<tr><td><a href="/sites/default/files/x.pdf">RFP 164/2026:  Appointment of a Professional Service Provider</a></td><td>12 October 2026</td><td>02 November 2026 @ 23H55</td></tr>
<tr><td>RFP 186/2026:  A typo&#39;d closing date tender</td><td>2 October 2026</td><td>23 Ocober 2026 @ 23H55</td></tr>
</table>"""

# Confirmed live, 2026-11-07: DBSA's own page listed ref "RFP185/2026" TWICE -
# a later addendum notice alongside the original tender, same closing date,
# slightly different title wording ("Addendum 01" / GPS coordinates added),
# different published dates (28 Oct vs 2 Nov). Trimmed from the real rows,
# not an invented example.
DBSA_REUSED_REF_HTML = """<table><tr><th>OPEN RFP's and RFR's</th><th>Date Published</th><th>Closing Date and Time</th></tr>
<tr><td>RFP 185/2026: The Appointment of a Security Services Company Tender Volume , Addendum 01 Onsite Compulsory Briefing Session</td><td>2 November 2026</td><td>23 November 2026 @ 23H55</td></tr>
<tr><td>RFP185/2026: The Appointment of a Security Services Company Tender Volume Onsite Compulsory Tender Briefing</td><td>28 October 2026</td><td>23 November 2026 @ 23H55</td></tr>
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
    check("SARS closing date from the separate 'Published Tenders' detail section, day-first not US-style "
          "(10/11/2026 11:00 -> 10 November, not 11 October)",
          r["closing_date"] == "2026-11-10T11:00:00+02:00", r["closing_date"])
    r13 = sars_procurement.normalize(entries[1])
    check("SARS: a tender with no stated closing date still parses, closing=None not a crash",
          r13["contract_number"] == "RFP13/2026" and r13["closing_date"] is None, r13["closing_date"])

    # Found 2026-11-01, tested against the real live site: TENDER_LINK used to
    # require href as the literal first attribute right after "<a " - the
    # real SARS site already puts other attributes before href on plenty of
    # its own <a> tags elsewhere on these same pages, so a CMS/theme change
    # doing the same for a tender link would have silently dropped it with
    # no error. DOC_LINK (checked above) already tolerated this correctly.
    sars_attr_before_href = """<li><strong>17 October 2026 – New Tender</strong><ul>
<li><a target="_blank" href="https://www.sars.gov.za/tender/rfp20-2026-attr-before-href/">RFP20/2026: Attribute before href | South African Revenue Service</a></li>
</ul></li>"""
    attr_entries = sars_procurement.parse_listing(sars_attr_before_href)
    check("SARS: a tender link with an attribute before href is still found",
          len(attr_entries) == 1 and attr_entries[0]["ref"] == "RFP20/2026", attr_entries)

    # QA-Edge-Case-Findings.md, 2026-10-19: DOC_LINK has no scheme requirement
    # (a real site's own HTML commonly links a same-site document with a
    # relative href), but fetch_documents() used to store it unresolved -
    # download_discovered_documents.py's urllib.request.Request() then
    # raised ValueError on the raw href, crashing its whole run on the first
    # such link. Fixed by resolving against the page it was found on.
    real_http_get = sars_procurement.sh.http_get
    sars_procurement.sh.http_get = lambda url, timeout=60: (
        '<a href="/files/tender/spec.pdf">Specification</a>'
        '<a href="https://www.sars.gov.za/files/addendum.pdf">Addendum</a>'
    ).encode()
    try:
        docs = sars_procurement.fetch_documents("https://www.sars.gov.za/procurement/published-tenders/tender/rfp14-2026")
    finally:
        sars_procurement.sh.http_get = real_http_get
    check("SARS: a relative document href is resolved against the page it was found on",
          any(d["url"] == "https://www.sars.gov.za/files/tender/spec.pdf" for d in docs), docs)
    check("SARS: an already-absolute href is left exactly as it was",
          any(d["url"] == "https://www.sars.gov.za/files/addendum.pdf" for d in docs), docs)

    # Finding 183, QA-Edge-Case-Findings.md: live-fetched 2026-11-07 from the
    # real RFP18/2026 detail page (https://www.sars.gov.za/tender/rfp18-2026-
    # ...-36-months/) - the exact byte sequence of its own
    # elementor-widget-theme-post-content widget, with its own real nav-bar
    # chrome (also plain, extension-less https://www.sars.gov.za/... links)
    # kept immediately before it, unmodified. DOC_LINK alone matched ZERO of
    # this real page's own 4 real documents (confirmed separately against
    # the live page before this fix) because every one is a pretty permalink
    # with no file extension, and its own primary "tender pack" link's text
    # is 168 characters - longer than DOC_LINK's own 150-character cap too.
    SARS_DETAIL_RFP18_REAL = (
        '<a href="https://www.sars.gov.za/">Home</a>'
        '<a href="https://www.sars.gov.za/about/">About SARS</a>'
        '<a href="https://www.sars.gov.za/careers/">Careers</a>'
        '<div class="elementor-element elementor-element-5217bc6 elementor-widget '
        'elementor-widget-theme-post-content" data-id="5217bc6">'
        '<div class="elementor-widget-container">'
        '<p><strong>Main</strong></p>\n'
        '<p><a href="https://www.sars.gov.za/rfp18-2026-tender-pack/">Appointment of service '
        'provider(s) for the supply, maintenance of sanitary, and health care services for the '
        'SARS offices, countrywide for a period of 36 months</a></p>\n'
        '<p><strong>Supporting</strong></p>\n'
        '<p><a href="https://www.sars.gov.za/briefing-session-presentation-rfp-18-2026-hygiene-'
        'services-v2/">Briefing session presentation</a></p>\n'
        '<p><a href="https://www.sars.gov.za/rfp-18-2026-qa/">Questions and answers</a></p>\n'
        '<p><span style="color: #ff0000;"><a style="color: #ff0000;" href="https://www.sars.gov.za/'
        'rfp18-2026_hygiene-pricing-template-final/">Price template with editable GC &amp; GS '
        'cluster</a></span></p>\n'
        '\t\t\t\t</div>\n\t\t\t\t</div>\n\t\t\t\t\t</div>\n\t\t</div>'
        '<a href="https://www.sars.gov.za/media/">Media</a>'
        '<a href="https://www.sars.gov.za/sitemap/">Site Map</a>'
    )
    real_http_get2 = sars_procurement.sh.http_get
    sars_procurement.sh.http_get = lambda url, timeout=60: SARS_DETAIL_RFP18_REAL.encode()
    try:
        rfp18_docs = sars_procurement.fetch_documents(
            "https://www.sars.gov.za/tender/rfp18-2026-appointment-of-service-providers-for-the-"
            "supply-maintenance-of-sanitary-and-health-care-services-for-the-sars-offices-"
            "countrywide-for-a-period-of-36-months/")
    finally:
        sars_procurement.sh.http_get = real_http_get2
    check("SARS: real detail page's own extension-less 'Main' tender-pack link is captured",
          any(d["url"] == "https://www.sars.gov.za/rfp18-2026-tender-pack/"
              and d["title"].startswith("Appointment of service provider(s)") for d in rfp18_docs),
          rfp18_docs)
    check("SARS: a 'Main' link title over DOC_LINK's own 150-char cap is NOT truncated/dropped",
          any(len(d["title"]) > 150 for d in rfp18_docs), [len(d["title"]) for d in rfp18_docs])
    check("SARS: real detail page's own 3 'Supporting' addendum-style links (briefing/Q&A/pricing) "
          "are all captured, not just the main tender pack",
          {d["url"] for d in rfp18_docs} == {
              "https://www.sars.gov.za/rfp18-2026-tender-pack/",
              "https://www.sars.gov.za/briefing-session-presentation-rfp-18-2026-hygiene-services-v2/",
              "https://www.sars.gov.za/rfp-18-2026-qa/",
              "https://www.sars.gov.za/rfp18-2026_hygiene-pricing-template-final/",
          }, rfp18_docs)
    check("SARS: the page's own real nav-bar chrome (Home/About SARS/Careers/Media/Site Map - also "
          "plain extension-less https://www.sars.gov.za/... links) is NOT swept in as a bogus doc",
          all(d["url"] not in (
              "https://www.sars.gov.za/", "https://www.sars.gov.za/about/",
              "https://www.sars.gov.za/careers/", "https://www.sars.gov.za/media/",
              "https://www.sars.gov.za/sitemap/") for d in rfp18_docs), rfp18_docs)

    # RFP14/2026's real detail page has no "Supporting" section at all (just
    # its own "Main" tender pack) - confirmed live the same pass. A detail
    # page with no document section whatsoever (no "Main" marker at all)
    # must not raise - _DOC_SECTION.search() returning None is the normal,
    # expected case there, not an error.
    real_http_get3 = sars_procurement.sh.http_get
    sars_procurement.sh.http_get = lambda url, timeout=60: b"<p>No Main marker on this page at all.</p>"
    try:
        no_section_docs = sars_procurement.fetch_documents("https://www.sars.gov.za/tender/x/")
    finally:
        sars_procurement.sh.http_get = real_http_get3
    check("SARS: a detail page with no 'Main' document section at all still returns cleanly (no crash)",
          no_section_docs == [], no_section_docs)

    open_r = cidb_tenders.normalize(CIDB_FEED_OPEN)
    awarded_r = cidb_tenders.normalize(CIDB_FEED_AWARDED)
    check("cidb: status field ('active') is NOT the open signal", CIDB_FEED_AWARDED["status"] == "active")
    check("cidb: realstatus is", open_r["status"] == "advertised" and awarded_r["status"] == "awarded")
    check("cidb: no closing_date field published -> unset, not treated as expired",
          open_r["closing_date"] is None and open_r["is_closed"] is False)

    # Found 2026-11-07, checked against the real live feed: cidb's own
    # description field sometimes embeds a raw <a href> to a second real
    # document (a pricing schedule / addendum) that tender_advert_file/
    # tender_briefing_file never mention - it was silently missing from
    # `documents` entirely, and the literal HTML stayed in title/description.
    desc_link_r = cidb_tenders.normalize(CIDB_FEED_DESC_LINK)
    check("cidb: description-embedded <a href> document is recovered into documents",
          any(d["url"].endswith("Annexure-B-BOQ.xlsx") and "Pricing Schedule" in d["title"]
              for d in desc_link_r["documents"]), desc_link_r["documents"])
    check("cidb: the tender_advert_file document is still kept alongside it",
          any(d["title"] == "Tender advert" for d in desc_link_r["documents"]), desc_link_r["documents"])
    check("cidb: the raw <a> markup is stripped from title/description",
          "<a " not in desc_link_r["description"] and "<a " not in desc_link_r["title"], desc_link_r["description"])

    # Real malformed markup (cidb 005 2526): href's opening quote is missing
    # on the live site's own page, closing quote still there.
    unquoted_r = cidb_tenders.normalize(CIDB_FEED_DESC_LINK_UNQUOTED)
    check("cidb: a description link with a missing opening quote on href is still recovered",
          any(d["url"].endswith("annexure-a.xlsx") for d in unquoted_r["documents"]), unquoted_r["documents"])
    check("cidb: markup stripped even on the malformed-quote row",
          "<a " not in unquoted_r["description"], unquoted_r["description"])

    rows = dbsa_procurement.parse_table(DBSA_TABLE_HTML)
    check("DBSA: header row skipped, 2 tenders parsed", len(rows) == 2, len(rows))
    rels = [dbsa_procurement.normalize(r) for r in rows]
    check("DBSA ref + closing date - real stated time (23:55) preserved, not defaulted to midnight",
          rels[0]["contract_number"] == "RFP164/2026"
          and rels[0]["closing_date"] == "2026-11-02T23:55:00+02:00")
    check("DBSA doc link resolved to an absolute URL", rels[0]["documents"][0]["url"].startswith("https://www.dbsa.org/"))
    check("DBSA: a typo'd month ('Ocober') in the closing date -> unset, not a crash", rels[1]["closing_date"] is None)
    check("DBSA: single-digit hour ('9H00') parsed as 09:00, not dropped",
          dbsa_procurement._parse_dbsa_closing("9 January 2027 @ 9H00") == "2027-01-09T09:00:00+02:00")
    check("DBSA: 'at HH'H'MM' (the live page's own wording as of 2026-11-03, replacing '@' and "
          "silently re-breaking this exact parse until now) preserved, not dropped to None",
          dbsa_procurement._parse_dbsa_closing("13 November 2026 at 23H55") == "2026-11-13T23:55:00+02:00")
    check("DBSA: a genuinely date-only closing (no '@'/'at HH:MM' seen) defaults to the 11:00 SAST "
          "convention, not midnight - same as every other confirmed date-only source",
          dbsa_procurement._parse_dbsa_closing("12 October 2026") == "2026-10-12T11:00:00+02:00")

    check("new sources registered in ALL_SOURCES", {"sars_procurement", "cidb_tenders", "dbsa_procurement"}
          <= set(gov_sources.ALL_SOURCES))
    check("new sources have labels", all(gov_sources.SOURCE_LABELS.get(s) for s in
          ("sars_procurement", "cidb_tenders", "dbsa_procurement")))


def test_sars_reused_ref_gets_distinct_ocids_not_dropped():
    # Standing backlog item (System-Status.md, named three prior passes
    # running): SARS's own ocid is built from the raw Ref No. alone, the
    # identical pre-fix shape kouga.py's and dbsa_procurement.py's own
    # _disambiguate_reused_refs() already closed for their own sibling
    # readers. No live collision observed yet (SARS's real page had only 2
    # open tenders, 2 distinct refs, 2026-11-07) - fixed proactively with
    # this synthetic fixture (SARS_REUSED_REF_HTML above), not a live
    # reproduction.
    #
    # Left alone, this used to be WORSE than a plain ocid collision: the old
    # fetch_releases() de-duped entries on `ref or url` before normalize()
    # ever ran, so the second (re-advertised) entry was silently DROPPED
    # from the output entirely, never even reaching the DB - a real tender
    # that a company would otherwise be told about, simply never appearing.
    print("sars_procurement: reused ref disambiguation")
    import html as html_mod
    real_fetch_list = sars_procurement.fetch_list
    # fetch_list() normally does the html.unescape() itself (sars_procurement.py's
    # own fetch_list, replaced here) - replicated explicitly since these
    # fixtures carry raw HTML entities ("&#8211;") the same way SARS_PAGE_HTML
    # does above.
    sars_procurement.fetch_list = lambda: html_mod.unescape(SARS_REUSED_REF_HTML)
    try:
        rels = sars_procurement.fetch_releases(with_documents=False, log=lambda *a, **k: None)
    finally:
        sars_procurement.fetch_list = real_fetch_list
    same_ref = [r for r in rels if r["contract_number"] == "RFP99/2026"]
    check("both the original and its re-advertisement are present (same ref, 2 rows) - "
          "not silently dropped by the in-page dedup", len(same_ref) == 2, len(same_ref))
    check("...but they do NOT share an ocid (the collision this fix closes)",
          len({r["ocid"] for r in same_ref}) == 2, [r["ocid"] for r in same_ref])
    check("...and each disambiguated ocid still starts with the shared ref, for traceability",
          all(r["ocid"].startswith("sars-procurement:RFP99/2026:") for r in same_ref),
          [r["ocid"] for r in same_ref])

    # The ORIGINAL (non-colliding) fixture still gets plain, unsuffixed
    # ocids through the same fetch_releases() entry point, and the genuine
    # same-tender-mentioned-twice case (SARS_PAGE_HTML's own "What's New" +
    # dated-entry duplicate shape) still correctly collapses to one row -
    # confirms the fix doesn't touch refs that were never ambiguous.
    sars_procurement.fetch_list = lambda: html_mod.unescape(SARS_PAGE_HTML)
    try:
        plain_rels = sars_procurement.fetch_releases(with_documents=False, log=lambda *a, **k: None)
    finally:
        sars_procurement.fetch_list = real_fetch_list
    check("every non-colliding ref keeps its plain, unsuffixed ocid",
          all(r["ocid"] == f"sars-procurement:{r['contract_number']}" for r in plain_rels if r["contract_number"]),
          [r["ocid"] for r in plain_rels])
    check("SARS: still exactly 2 tenders from the original fixture (no new duplicate introduced)",
          len(plain_rels) == 2, len(plain_rels))


def test_dbsa_reused_ref_gets_distinct_ocids_not_a_collision():
    # DBSA's own procurement page lists one RFP twice when it is relisted
    # with an addendum (same pattern kouga.py's own _disambiguate_reused_refs()
    # closed for Kouga's reused Ref No, 2026-11-06) - confirmed live,
    # 2026-11-07, DBSA_REUSED_REF_HTML above. Left alone, both rows get the
    # identical ocid ("dbsa-procurement:RFP185/2026"), and this engine's own
    # per-release scoring/seeding (watch_new_tenders.fan_out()'s own
    # release_key(), seed_supabase_opportunities.seed()'s own
    # (company_id, ocid) upsert) would treat them as the SAME release scored
    # and reported twice in one run, whichever is written last silently
    # overwriting the other's discovered_opportunities row.
    print("dbsa_procurement: reused ref disambiguation")
    real_fetch_list = dbsa_procurement.fetch_list
    dbsa_procurement.fetch_list = lambda: DBSA_REUSED_REF_HTML
    try:
        rels = dbsa_procurement.fetch_releases(log=lambda *a, **k: None)
    finally:
        dbsa_procurement.fetch_list = real_fetch_list
    same_ref = [r for r in rels if r["contract_number"] == "RFP185/2026"]
    check("both the original and its addendum notice are present (same ref, 2 rows)",
          len(same_ref) == 2, len(same_ref))
    check("...but they do NOT share an ocid (the collision this fix closes)",
          len({r["ocid"] for r in same_ref}) == 2, [r["ocid"] for r in same_ref])
    check("...and each disambiguated ocid still starts with the shared ref, for traceability",
          all(r["ocid"].startswith("dbsa-procurement:RFP185/2026:") for r in same_ref),
          [r["ocid"] for r in same_ref])

    # The ORIGINAL (non-colliding) fixture still gets plain, unsuffixed
    # ocids through the same fetch_releases() entry point - confirms the fix
    # doesn't touch refs that were never ambiguous, which would otherwise
    # re-trigger a "new tender" alert for every DBSA tender, not just the
    # genuinely reused ones.
    dbsa_procurement.fetch_list = lambda: DBSA_TABLE_HTML
    try:
        plain_rels = dbsa_procurement.fetch_releases(log=lambda *a, **k: None)
    finally:
        dbsa_procurement.fetch_list = real_fetch_list
    check("every non-colliding ref keeps its plain, unsuffixed ocid",
          all(r["ocid"] == f"dbsa-procurement:{r['contract_number']}" for r in plain_rels if r["contract_number"]),
          [r["ocid"] for r in plain_rels])


def test_merge_find_picks_newest_candidate_on_relisted_ref():
    # Finding 330: merge()'s own _find() does `cands[0]` when more than one
    # base-list (portal/OCDS) release shares a ref key - but tender_changes.
    # relistings() exists specifically because a buyer can legitimately list
    # the SAME bid number twice as two different, both-still-"Published"
    # releases with different ocids/closing dates (its own docstring: "Seen
    # live 2026-10-17", Eastern Cape Transport's SCMU10-26/27-0017). This is
    # the exact same duplicate-key universe over the exact same `releases`/
    # base-list data Findings 328/329 already fixed for readvertisements()/
    # eskom_notices() in tender_changes.py, one file over: `_index()` here
    # already groups by key into a LIST (not a single-value dict), proving
    # the collision is anticipated, but the one real consumer, `_find()`,
    # then discarded every candidate but the first one it happened to see,
    # with no rule for which is "right" - an accident of `by_source[source]`
    # iteration order, not a deliberate choice. Reproduced directly: the
    # SAME two relisted portal releases (old closing 26 Oct, new closing
    # 6 Nov, same contract_number, different ocid) plus one DBSA direct-site
    # release for the same bid, fed in old-then-new and new-then-old - the
    # direct site's own documents landed on whichever portal release
    # happened to be listed FIRST, not on the live one, flipping with the
    # input order.
    print("gov_sources.merge: _find() picks the newest of several same-ref base candidates, not cands[0]")

    def portal_row(id_, closing):
        return etenders_portal.normalize({
            "id": id_, "tender_No": "RFP185/2026", "description": "Scholar transport services",
            "category": "Services", "type": "Request for Proposal",
            "organ_of_State": "Development Bank of Southern Africa",
            "status": "Published", "closing_Date": closing, "date_Published": "2026-10-01T00:00:00",
            "briefingSession": False, "province": "Gauteng", "supportDocument": [], "cancelled": None,
        })

    old = portal_row(910001, "2026-10-26T12:00:00")  # the stale, superseded listing
    new = portal_row(910002, "2026-11-06T12:00:00")  # the live relisting
    direct = dict(old, source="dbsa_procurement", ocid="dbsa-procurement:RFP185/2026",
                 listing_sources=[{"source": "dbsa_procurement", "url": "https://dbsa.org/RFP185-2026"}],
                 documents=[{"title": "Addendum 1.pdf", "url": "https://dbsa.org/addendum1.pdf"}])

    for order_name, portal_order in (("old-then-new", [old, new]), ("new-then-old", [new, old])):
        merged = gov_sources.merge({"etenders_portal": portal_order, "dbsa_procurement": [direct]})
        by_ocid = {m["ocid"]: m for m in merged}
        enriched = [m for m in merged if m.get("ocid") != direct["ocid"]
                   and any(s["source"] == "dbsa_procurement" for s in m["listing_sources"])]
        check(f"[{order_name}] exactly one portal release picked up the DBSA fold (not zero, not both)",
              len(enriched) == 1, [m["ocid"] for m in merged])
        check(f"[{order_name}] the LIVE relisting ({new['ocid']}) got the DBSA documents, not the stale one",
              enriched and enriched[0]["ocid"] == new["ocid"], enriched[0]["ocid"] if enriched else None)
        check(f"[{order_name}] the stale listing stayed portal-only, no DBSA documents folded in",
              by_ocid[old["ocid"]]["documents"] == [], by_ocid[old["ocid"]]["documents"])


def test_new_sources_are_in_buyer_family():
    # QA-Edge-Case-Findings.md, 2026-10-18 (fourteenth run): sars_procurement/
    # cidb_tenders/dbsa_procurement shipped without a BUYER_FAMILY entry.
    # _find()'s own family check (`not family or family.search(...)`) treats
    # a missing entry as "any buyer matches" - the buyer-isolation merge()'s
    # own docstring promises ("reference numbers aren't unique across
    # buyers") silently didn't apply to any of the three newest sources.
    # Reproduces the exact failure: an unrelated department's portal row and
    # a SARS tender that happen to share a generic reference format must
    # stay two separate tenders, not fold into one with the wrong buyer.
    print("gov_sources.BUYER_FAMILY covers every foldable new source")
    for name, buyer_const in (("sars_procurement", sars_procurement.BUYER),
                              ("cidb_tenders", cidb_tenders.BUYER),
                              ("dbsa_procurement", dbsa_procurement.BUYER)):
        check(f"{name} is in BUYER_FAMILY", name in gov_sources.BUYER_FAMILY)
        check(f"{name}'s BUYER_FAMILY pattern matches its own BUYER string",
              bool(gov_sources.BUYER_FAMILY[name].search(buyer_const)), buyer_const)

    portal_unrelated = etenders_portal.normalize(dict(
        PORTAL_OTHER_BUYER_SAME_REF, id=900101, tender_No="RFP14/2026",
        description="Appointment of a caterer for Head Office", organ_of_State="Department of Something Unrelated"))
    sars_row = sars_procurement.normalize({"url": "https://sars/tender/rfp14-2026", "title": "ICT infrastructure audit",
                                           "ref": "RFP14/2026", "published": "2026-10-16T00:00:00+02:00"})
    merged = gov_sources.merge({"etenders_portal": [portal_unrelated], "sars_procurement": [sars_row]})
    check("a SARS tender sharing a generic ref format with an unrelated department's portal row stays separate",
          len(merged) == 2, [m["buyer"] for m in merged])

    # Same buyer (SARS's own tender also listed on the portal under SARS's
    # name): the fold must still happen - this isn't "never match SARS."
    portal_sars = etenders_portal.normalize(dict(
        PORTAL_OTHER_BUYER_SAME_REF, id=900102, tender_No="RFP14/2026",
        description="ICT infrastructure audit", organ_of_State="South African Revenue Service"))
    merged2 = gov_sources.merge({"etenders_portal": [portal_sars], "sars_procurement": [sars_row]})
    check("a SARS tender listed on the portal under SARS's own name still folds",
          len(merged2) == 1 and len(merged2[0]["listing_sources"]) == 2)


def test_merge():
    print("gov_sources.merge")
    portal = [etenders_portal.normalize(x) for x in (PORTAL_SANRAL_0756C, PORTAL_SANRAL_N011, PORTAL_OTHER_BUYER_SAME_REF)]
    closed = [etenders_portal.normalize(PORTAL_SANRAL_0754A_CLOSED)]
    # is_closed is baked into each release at construction time (sh.release(),
    # called by sanral_site() below, sets it via sh.is_past() against the REAL
    # clock right then - gov_sources.merge() itself never recomputes it; it
    # only reads the field it's handed). The 2026-10-23 QA pass froze the
    # clock around the merge() call below, on the mistaken belief ("confirmed
    # by reading the code") that merge() does the recomputing - it doesn't, so
    # that freeze never actually took effect for `site`, which is built
    # before the patch is applied. Result: the "open on SANRAL, Closed on
    # portal" case (hardcoded 2026-11-06 as still-open, same bug class as the
    # randwater fixture, System-Status.md Finding 62) flipped for real today
    # regardless of the earlier fix. Root-caused by reproducing the exact
    # failure and tracing is_closed back to sh.release()'s own construction
    # time, not assumed. Fix: freeze the clock BEFORE building `site` (every
    # sanral_site() call) as well as around merge(), so every is_closed value
    # this test depends on is computed under the same frozen "now" - correct
    # regardless of what the real wall clock says on any future day.
    import datetime as _real_datetime

    class _FixedBeforeClosing(_real_datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            base = _real_datetime.datetime(2026, 10, 25, 9, 0, tzinfo=_real_datetime.timezone.utc)
            return base.astimezone(tz) if tz else base

    _real_dt = sh.datetime.datetime
    sh.datetime.datetime = _FixedBeforeClosing
    try:
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
    finally:
        sh.datetime.datetime = _real_dt
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


def test_fold_copies_published_opening_category():
    # Finding 244: _fold()'s field-copy list stopped at scm_reference -
    # published_date/opening_date/procurement_category were never copied
    # from a direct-site release into its matched portal row, even when the
    # portal's OWN value for the field was null. etenders_portal.normalize()
    # passes date_Published/category straight through as None whenever the
    # portal genuinely didn't record them for that row (not hypothetical -
    # both are nullable on the real portal). Reproduces with the real,
    # unmodified normalize()/normalize_rfq()/merge() - no mocking.
    print("gov_sources._fold copies published_date/opening_date/procurement_category")
    portal_no_dates = etenders_portal.normalize({
        "id": 900200, "tender_No": "GA12700333", "description": "Ladies softshell jacket navy 3xl",
        "category": None, "type": "Request for Quotation", "organ_of_State": "City of Cape Town",
        "status": "Published", "closing_Date": "2026-10-28T12:00:00", "date_Published": None,
        "briefingSession": False, "province": "Western Cape", "supportDocument": [], "cancelled": None,
    })
    check("portal row itself has no published/opening/category (the live-data condition this bites on)",
          portal_no_dates["published_date"] is None and portal_no_dates["opening_date"] is None
          and portal_no_dates["procurement_category"] is None)
    cells = ["GA12700333", "Ladies softshell jacket navy 3xl", "Clothing, PPE & Accessories",
             "2026/10/28", "10/28/2026 12:00:00 PM", "2026/10/17", "10/17/2026 2:20:39 PM"]
    direct = capetown_procurement.normalize_rfq(cells, "/web1/procurementportal/RFQ/Details/331433", "331433")
    merged = gov_sources.merge({"etenders_portal": [portal_no_dates], "capetown_procurement": [direct]})
    check("direct-site release folds into the portal row", len(merged) == 1, len(merged))
    m = merged[0]
    check("published_date copied from the direct site, not left null", m["published_date"] == direct["published_date"], m["published_date"])
    check("opening_date copied from the direct site, not left null", m["opening_date"] == direct["opening_date"], m["opening_date"])
    check("procurement_category copied from the direct site, not left null",
          m["procurement_category"] == direct["procurement_category"], m["procurement_category"])

    # The SAME gap, in the separate "open on the buyer's own site, closed on
    # the portal" fold path (merge()'s own closed_idx branch) - it used to
    # duplicate only listing_sources/documents/direct_documents by hand and
    # skip the field-copy loop entirely, so this path never picked up a null
    # field from the direct site either, even after the fix above.
    import datetime as _real_datetime

    class _FixedClock(_real_datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            base = _real_datetime.datetime(2026, 10, 25, 9, 0, tzinfo=_real_datetime.timezone.utc)
            return base.astimezone(tz) if tz else base

    _real_dt = sh.datetime.datetime
    sh.datetime.datetime = _FixedClock
    try:
        closed_no_dates = etenders_portal.normalize({
            "id": 900300, "tender_No": "N011-010-2027/1F", "description": "FLOOD MITIGATION",
            "category": None, "type": "Request for Bid(Open-Tender)",
            "organ_of_State": "South African National Roads Agency Soc Limited (SANRAL)", "status": "Closed",
            "closing_Date": "2026-10-15T12:00:00", "date_Published": None,
            "briefingSession": False, "province": "KwaZulu-Natal", "supportDocument": [], "cancelled": None,
        }, "closed")
        reopened = sanral_site("N011-010-2027/1F", "2026-11-19T12:00:00+02:00", slug="n011")
        reopened["published_date"] = "2026-10-01T00:00:00+02:00"
        reopened["procurement_category"] = "Construction"
        merged2 = gov_sources.merge({"etenders_portal": [], "sanral": [reopened]}, portal_closed=[closed_no_dates])
    finally:
        sh.datetime.datetime = _real_dt
    check("closed-portal-row fold path also copies published_date", len(merged2) == 1 and merged2[0]["published_date"] == "2026-10-01T00:00:00+02:00",
          merged2[0].get("published_date") if merged2 else None)
    check("closed-portal-row fold path also copies procurement_category", merged2[0]["procurement_category"] == "Construction",
          merged2[0].get("procurement_category"))


def test_scope_enrichment_hook():
    """attach_scope_enrichment() - the per-release hook tender_enrichment.py's
    own module docstring named. Heuristic-only tagging attached to every
    release, never fatal when one release's tagging blows up."""
    print("gov_sources.attach_scope_enrichment")
    releases = [
        {"ocid": "ocds-test-1", "title": "Appointment of a service provider for guarding services",
         "description": "24-hour armed guarding and access control at regional offices for 36 months.",
         "documents": [{"title": "Bill_of_Quantities.xlsx", "url": "https://example.test/boq.xlsx"}]},
        {"ocid": "ocds-test-2", "title": "Supply of stationery", "description": "Office stationery supply."},
    ]
    gov_sources.attach_scope_enrichment(releases, log=lambda m: None)
    r1 = releases[0]["scope_enrichment"]
    check("per-release tagging attached", r1 is not None and "security_facilities" in r1["industry_tags"])
    check("heuristic only at this stage", r1["confidence"] == "heuristic")
    check("BOQ-named document detected by title", r1["boq_summary"]["referenced"] is True)
    check("existing release fields untouched", releases[0]["title"] == "Appointment of a service provider for guarding services")

    # One release that will make enrich_release() blow up must not take out
    # the others - same "never fatal" discipline as every other source read
    # in this file. A non-iterable `documents` (not the [{"title","url"},...]
    # shape every real reader produces) makes detect_boq_reference()'s own
    # `for d in documents` raise TypeError.
    bad = [{"ocid": "ocds-bad", "title": "x", "description": "y", "documents": 123}]
    logged = []
    gov_sources.attach_scope_enrichment(bad, log=logged.append)
    check("a tagging failure is caught and logged, not raised", bad[0]["scope_enrichment"] is None and len(logged) == 1)


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


class FixedDateTime(datetime.datetime):
    """Freezes datetime.datetime.now() to a given instant - same pattern as
    engine/general/test_process_general_jobs.py's own FixedDateTime (Finding 291) /
    engine/pack/test_pdf_merge.py / engine/cv/test_generate_cv.py's - needed to land
    squarely inside the 00:00-01:59 SAST window (22:00-23:59 UTC the day before)."""
    _frozen = None

    @classmethod
    def now(cls, tz=None):
        base = cls._frozen
        return base.astimezone(tz) if tz is not None else base.replace(tzinfo=None)


def test_etenders_ocds_fetch_window_uses_sast_calendar_day_not_naive_utc_today():
    print("\ngov_sources.read_source('etenders_ocds'): its own OCDS fetch window must use the "
          "real SAST calendar day, not a naive datetime.date.today(), during the 00:00-01:59 SAST window")
    # Finding 292 (2026-11-09): read_source('etenders_ocds') used to build its own date_from/
    # date_to window from a bare datetime.date.today() - the same naive-UTC-anchor mistake
    # already fixed in this exact computation everywhere else it's done (watch_new_tenders.py's
    # own `today` line immediately before it calls into this very function; daily_digest.py's
    # own score_discovery_feed()). 22:30 UTC on 2026-11-09 is 00:30 SAST on 2026-11-10 - the real
    # SAST "today" is 2026-11-10, a full day later than the naive UTC one.
    FixedDateTime._frozen = datetime.datetime(2026, 11, 9, 22, 30, 0, tzinfo=datetime.timezone.utc)
    real_datetime = gov_sources.datetime.datetime
    gov_sources.datetime.datetime = FixedDateTime

    import etenders_national
    captured = {}
    real_fetch = etenders_national.fetch_releases

    def fake_fetch(date_from, date_to, max_pages=200):
        captured["date_from"], captured["date_to"] = date_from, date_to
        return []
    etenders_national.fetch_releases = fake_fetch
    try:
        releases, notices = gov_sources.read_source("etenders_ocds")
    finally:
        gov_sources.datetime.datetime = real_datetime
        etenders_national.fetch_releases = real_fetch

    check("fetch window's date_to is the real SAST calendar day (2026-11-10), not the naive-UTC "
          "one (2026-11-09) a bare date.today() would give on a UTC-TZ host at this instant",
          captured.get("date_to") == "2026-11-10", captured)
    check("fetch window's date_from is 14 real SAST days back from that same real SAST day",
          captured.get("date_from") == "2026-10-27", captured)
    check("no releases, no notices, nothing crashes with the frozen clock in place",
          releases == [] and notices == [])


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
    test_sars_reused_ref_gets_distinct_ocids_not_dropped()
    test_dbsa_reused_ref_gets_distinct_ocids_not_a_collision()
    test_merge_find_picks_newest_candidate_on_relisted_ref()
    test_new_sources_are_in_buyer_family()
    test_merge()
    test_fold_copies_published_opening_category()
    test_scope_enrichment_hook()
    test_changes()
    test_etenders_ocds_fetch_window_uses_sast_calendar_day_not_naive_utc_today()
    test_digest()
    print(f"\n{'ALL PASSED' if not FAILS else str(len(FAILS)) + ' FAILED: ' + ', '.join(FAILS)}")
    sys.exit(1 if FAILS else 0)
