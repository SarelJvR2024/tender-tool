"""
Offline tests for randwater.py, against the REAL page source of
https://bids.randwater.co.za/Public/Procurement/Bids/ViewPublishedBids.aspx
(Sarel, 2026-10-20 - View Page Source from his own browser, since this
module's own docstring explains why no automated environment in this
session could fetch it directly). FIXTURE_PAGE below is that real response,
trimmed of unrelated page chrome (menus, viewstate, footer) - the
dxhlControl_Office365 bid blocks and the newsControl init script (for the
pageCount check) are kept verbatim, including Rand Water's own typos
("MAINTENACE", "INFRUSTRUCTURE") and inconsistent capitalization - not
corrected, since a reader must parse what the site actually sends.

Run: python3 engine/discovery/test_randwater.py   (exit 1 on any failure)
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402
import randwater  # noqa: E402
import gov_sources  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


FIXTURE_PAGE = r"""
<script id="dxss_88388803">
ASPx.createControl(ASPxClientNewsControl,'PageContent_ctlPublishedBids_newsPanel_newsControl','',{'callBack':function(arg) { WebForm_DoCallback('ctl00$PageContent$ctlPublishedBids$newsPanel$newsControl',arg,ASPx.Callback,'PageContent_ctlPublishedBids_newsPanel_newsControl',ASPx.CallbackError,true); },'uniqueID':'ctl00$PageContent$ctlPublishedBids$newsPanel$newsControl','serverEvents':['TailClick'],'stateObject':{'b':false,'pc':0,'pi':0,'ps':0,'endlessPagingMode':0,'layout':0,'aspi':0,'pageSize':20,'ic':0,'pageCount':1,'pageIndex':0}});
</script>
<table class="dxhlControl_Office365" id="PageContent_ctlPublishedBids_newsPanel_newsControl_ctl07" style="width:100%;border-collapse:separate;">
    <tr>
        <td style="width:100%;vertical-align:Top;"><div class="dxhlHeader_Office365 newsArticle" style="border-bottom-style:Solid;border-bottom-width:0px;margin-bottom:19px;">
            RFQ10419311
        </div><div class="dxhlDate_Office365 newsArticle" style="margin-bottom:18px;">
            CLOSING DATE:  23 Oct 2026 16:00
        </div><div class="dxhlContent_Office365" style="vertical-align:Top;margin-bottom:3px;">
            Supply and Install PH30 and PH120 Cabling at Rand Water Rietvlei
        </div><div class="dxhlTailDiv_Office365" style="color:Orange;text-decoration:underline;">
            <span class="dxhlTail_Office365 dxhl" onclick="ASPx.HLTClick(event, 'PageContent_ctlPublishedBids_newsPanel_newsControl', 'RFQ10419311')" style="color:Orange;text-decoration:underline;cursor:pointer;">View</span>
        </div></td>
    </tr>
</table>
<table class="dxhlControl_Office365" id="PageContent_ctlPublishedBids_newsPanel_newsControl_ctl08" style="width:100%;border-collapse:separate;">
    <tr>
        <td style="width:100%;vertical-align:Top;"><div class="dxhlHeader_Office365 newsArticle" style="border-bottom-style:Solid;border-bottom-width:0px;margin-bottom:19px;">
            RFQ10418855
        </div><div class="dxhlDate_Office365 newsArticle" style="margin-bottom:18px;">
            CLOSING DATE:  23 Oct 2026 16:00
        </div><div class="dxhlContent_Office365" style="vertical-align:Top;margin-bottom:3px;">
            MAINTENANCE AND REFURBISHMENT OF ZK SCHOOL AND WAR ON LEAKS AT RAND WATER ZWARTKOPJES
        </div><div class="dxhlTailDiv_Office365" style="color:Orange;text-decoration:underline;">
            <span class="dxhlTail_Office365 dxhl" onclick="ASPx.HLTClick(event, 'PageContent_ctlPublishedBids_newsPanel_newsControl', 'RFQ10418855')" style="color:Orange;text-decoration:underline;cursor:pointer;">View</span>
        </div></td>
    </tr>
</table>
<table class="dxhlControl_Office365" id="PageContent_ctlPublishedBids_newsPanel_newsControl_ctl09" style="width:100%;border-collapse:separate;">
    <tr>
        <td style="width:100%;vertical-align:Top;"><div class="dxhlHeader_Office365 newsArticle" style="border-bottom-style:Solid;border-bottom-width:0px;margin-bottom:19px;">
            RFQ10418221
        </div><div class="dxhlDate_Office365 newsArticle" style="margin-bottom:18px;">
            CLOSING DATE:  23 Oct 2026 16:00
        </div><div class="dxhlContent_Office365" style="vertical-align:Top;margin-bottom:3px;">
            MAINTENANCE AND REPAIRS OF GENERATORS At RAND WATER HEAD OFFICE (RV) AND SCIENTIFIC SERVICES (AS) FOR 24 MONTHS
        </div><div class="dxhlTailDiv_Office365" style="color:Orange;text-decoration:underline;">
            <span class="dxhlTail_Office365 dxhl" onclick="ASPx.HLTClick(event, 'PageContent_ctlPublishedBids_newsPanel_newsControl', 'RFQ10418221')" style="color:Orange;text-decoration:underline;cursor:pointer;">View</span>
        </div></td>
    </tr>
</table>
<table class="dxhlControl_Office365" id="PageContent_ctlPublishedBids_newsPanel_newsControl_ctl10" style="width:100%;border-collapse:separate;">
    <tr>
        <td style="width:100%;vertical-align:Top;"><div class="dxhlHeader_Office365 newsArticle" style="border-bottom-style:Solid;border-bottom-width:0px;margin-bottom:19px;">
            RFQ10420501
        </div><div class="dxhlDate_Office365 newsArticle" style="margin-bottom:18px;">
            CLOSING DATE:  23 Oct 2026 16:00
        </div><div class="dxhlContent_Office365" style="vertical-align:Top;margin-bottom:3px;">
            MAINTENACE OF PLUMBING INFRUSTRUCTURE FOR AS AND WHEN REQUIRED AT VARIOUS RAND WATER SITES
        </div><div class="dxhlTailDiv_Office365" style="color:Orange;text-decoration:underline;">
            <span class="dxhlTail_Office365 dxhl" onclick="ASPx.HLTClick(event, 'PageContent_ctlPublishedBids_newsPanel_newsControl', 'RFQ10420501')" style="color:Orange;text-decoration:underline;cursor:pointer;">View</span>
        </div></td>
    </tr>
</table>
"""


# --- parse_bids() against the real fixture ---------------------------------

rows = randwater.parse_bids(FIXTURE_PAGE)
check("all 4 real bids found, in page order", [r[0] for r in rows] ==
      ["RFQ10419311", "RFQ10418855", "RFQ10418221", "RFQ10420501"], [r[0] for r in rows])
check("closing date text read correctly (double space after the colon, tolerated)",
      rows[0][1] == "23 Oct 2026 16:00", rows[0][1])
check("title read correctly, real typos preserved not corrected",
      rows[3][2] == "MAINTENACE OF PLUMBING INFRUSTRUCTURE FOR AS AND WHEN REQUIRED AT VARIOUS RAND WATER SITES",
      rows[3][2])
check("a title with parentheses reads intact",
      "(RV)" in rows[2][2] and "(AS)" in rows[2][2], rows[2][2])

# --- normalize() -> the shared release shape --------------------------------

rel = randwater.normalize(*rows[0])
check("ocid is source-namespaced, stable, no OCDS id to fake", rel["ocid"] == "randwater:RFQ10419311", rel["ocid"])
check("contract_number is the real reference", rel["contract_number"] == "RFQ10419311")
check("closing_date parsed to real SAST ISO (the new date format)",
      rel["closing_date"] == "2026-10-23T16:00:00+02:00", rel["closing_date"])
check("buyer is Rand Water", rel["buyer"] == "Rand Water")
check("source/source_id/source_url set for listing_sources", rel["source"] == "randwater" and rel["source_id"] == "RFQ10419311")
check("documents deliberately empty - the detail popup isn't read, not silently faked", rel["documents"] == [])
check("is_closed computed correctly from the real closing date (future -> not yet closed)",
      rel["is_closed"] is False)

# --- the pageCount safety check: never silently drop a 2nd page's bids ------

PAGED_FIXTURE = FIXTURE_PAGE.replace("'pageCount':1", "'pageCount':2")
try:
    randwater.parse_bids(PAGED_FIXTURE)
    check("pageCount > 1 raises instead of silently reading only page 1", False)
except RuntimeError as e:
    check("pageCount > 1 raises instead of silently reading only page 1", "2" in str(e), str(e))

# --- wired into gov_sources without reintroducing the 14th-run merge bug ---

check("randwater is in SOURCE_LABELS", "randwater" in gov_sources.SOURCE_LABELS)
check("randwater deliberately NOT in ALL_SOURCES (reachability from automation unconfirmed)",
      "randwater" not in gov_sources.ALL_SOURCES)
check("randwater has its own BUYER_FAMILY entry - QA-Edge-Case-Findings.md 14th run's bug class",
      "randwater" in gov_sources.BUYER_FAMILY)
check("the BUYER_FAMILY pattern actually matches 'Rand Water'",
      bool(gov_sources.BUYER_FAMILY["randwater"].search("Rand Water")))
check("...and does not match an unrelated buyer (no false-positive fold)",
      not gov_sources.BUYER_FAMILY["randwater"].search("City of Cape Town"))

# --- source_http.parse_sast's new DMY format, directly --------------------

check("parse_sast: DMY with time", sh.parse_sast("23 Oct 2026 16:00").isoformat() == "2026-10-23T16:00:00+02:00")
check("parse_sast: DMY without time defaults to midnight",
      sh.parse_sast("23 Oct 2026").isoformat() == "2026-10-23T00:00:00+02:00")
check("parse_sast: an unrecognised month name is unreadable, not a guess",
      sh.parse_sast("23 Xyz 2026 16:00") is None)
check("parse_sast: existing ISO format still works (no regression)",
      sh.parse_sast("2026-11-16T12:00:00").isoformat() == "2026-11-16T12:00:00+02:00")
check("parse_sast: existing US-style format still works (no regression)",
      sh.parse_sast("11/30/2026 3:00:00 PM").isoformat() == "2026-11-30T15:00:00+02:00")
check("parse_sast: existing Cape Town slash-date format still works (no regression)",
      sh.parse_sast("2026/10/28").isoformat() == "2026-10-28T00:00:00+02:00")

if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
    sys.exit(1)
print("\nALL PASSED")
