"""
Offline tests for kouga.py, against the REAL page source of
https://www.kouga.gov.za/tenders/status/open (this sandbox's own curl,
2026-10-21). FIXTURE_PAGE_1 below is that real page's 10 tender cards plus
its own real pagination block (the ">|" jump-to-last-page link naming page
28 - not guessed, the exact number the live site's own markup gave), kept
verbatim including the real typo ("MULTL-FUNCTION" in the 220/2026 erratum
title) and the real cancellation/erratum notices mixed in among ordinary
tenders - not corrected or filtered, since a reader must parse what the
site actually sends.

Run: python3 engine/discovery/test_kouga.py   (exit 1 on any failure)
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402
import kouga  # noqa: E402
import gov_sources  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


FIXTURE_PAGE_1 = r"""
<a href="https://www.kouga.gov.za/tender/cancellation-of-notice-no-246-2026-supply-delivery-of-branded-corporate-branding-items-for-the-kouga-municipality-tourism-brand-greater-garden-route" title="View tender CANCELLATION OF NOTICE NO: 246/2026 - SUPPLY & DELIVERY OF BRANDED CORPORATE BRANDING ITEMS FOR THE KOUGA MUNICIPALITY TOURISM BRAND: GREATER GARDEN ROUTE" class="box">
                                <div class="text">
                                    <h3>CANCELLATION OF NOTICE NO: 246/2026 - SUPPLY & DELIVERY OF BRANDED CORPORATE BRANDING ITEMS FOR THE KOUGA MUNICIPALITY TOURISM BRAND: GREATER GARDEN ROUTE</h3>
                                    <div class="infobox">

                                        <div class="rel__info">
                                            <strong>Ref No:</strong>246/2026                                        </div>
                                        <div class="startdate">
                                            <strong>Start Date:</strong>20 Oct 2026                                        </div>
                                        <div class="closingdate">
                                        <strong>Closing Date:</strong>21 Oct 2026                                        </div>
                                    </div>
                                    <p></p>
                                </div>
                                <div class="button">
                                    <div class="btn__main">Find Out More</div>
                                </div>
                            </a>
                            <a href="https://www.kouga.gov.za/tender/rfq-supply-and-delivery-of-walk-behind-roller" title="View tender RFQ: SUPPLY AND DELIVERY OF WALK BEHIND ROLLER" class="box">
                                <div class="text">
                                    <h3>RFQ: SUPPLY AND DELIVERY OF WALK BEHIND ROLLER</h3>
                                    <div class="infobox">

                                        <div class="rel__info">
                                            <strong>Ref No:</strong>231/2026                                        </div>
                                        <div class="startdate">
                                            <strong>Start Date:</strong>20 Oct 2026                                        </div>
                                        <div class="closingdate">
                                        <strong>Closing Date:</strong>29 Oct 2026                                        </div>
                                    </div>
                                    <p></p>
                                </div>
                                <div class="button">
                                    <div class="btn__main">Find Out More</div>
                                </div>
                            </a>
                            <a href="https://www.kouga.gov.za/tender/rfq-wheel-alignment-on-truck-front-axles-and-adjustment-of-rear-axles-and-balancing-of-all-truck-and-yellow-plant-wheels-for-a-period-ending-30-june-2027" title="View tender RFQ: WHEEL ALIGNMENT ON TRUCK FRONT AXLES AND ADJUSTMENT OF REAR AXLES AND BALANCING OF ALL TRUCK AND YELLOW PLANT WHEELS FOR A PERIOD ENDING 30 JUNE 2027" class="box">
                                <div class="text">
                                    <h3>RFQ: WHEEL ALIGNMENT ON TRUCK FRONT AXLES AND ADJUSTMENT OF REAR AXLES AND BALANCING OF ALL TRUCK AND YELLOW PLANT WHEELS FOR A PERIOD ENDING 30 JUNE 2027</h3>
                                    <div class="infobox">

                                        <div class="rel__info">
                                            <strong>Ref No:</strong>247/2026                                        </div>
                                        <div class="startdate">
                                            <strong>Start Date:</strong>13 Oct 2026                                        </div>
                                        <div class="closingdate">
                                        <strong>Closing Date:</strong>27 Oct 2026                                        </div>
                                    </div>
                                    <p></p>
                                </div>
                                <div class="button">
                                    <div class="btn__main">Find Out More</div>
                                </div>
                            </a>
                            <a href="https://www.kouga.gov.za/tender/rfq-supply-delivery-and-installation-of-festive-season-lighting" title="View tender RFQ: SUPPLY, DELIVERY, AND INSTALLATION OF FESTIVE SEASON LIGHTING" class="box">
                                <div class="text">
                                    <h3>RFQ: SUPPLY, DELIVERY, AND INSTALLATION OF FESTIVE SEASON LIGHTING</h3>
                                    <div class="infobox">

                                        <div class="rel__info">
                                            <strong>Ref No:</strong>245/2026                                        </div>
                                        <div class="startdate">
                                            <strong>Start Date:</strong>12 Oct 2026                                        </div>
                                        <div class="closingdate">
                                        <strong>Closing Date:</strong>21 Oct 2026                                        </div>
                                    </div>
                                    <p></p>
                                </div>
                                <div class="button">
                                    <div class="btn__main">Find Out More</div>
                                </div>
                            </a>
                            <a href="https://www.kouga.gov.za/tender/erratum-on-notice-no-220-2026-office-equipment-printers-copiers-and-multl-function-machines-lease-option-and-print-management-software" title="View tender ERRATUM ON NOTICE NO: 220/2026 OFFICE EQUIPMENT (PRINTERS, COPIERS AND MULTL-FUNCTION MACHINES: LEASE OPTION) AND PRINT MANAGEMENT SOFTWARE" class="box">
                                <div class="text">
                                    <h3>ERRATUM ON NOTICE NO: 220/2026 OFFICE EQUIPMENT (PRINTERS, COPIERS AND MULTL-FUNCTION MACHINES: LEASE OPTION) AND PRINT MANAGEMENT SOFTWARE</h3>
                                    <div class="infobox">

                                        <div class="rel__info">
                                            <strong>Ref No:</strong>239/2026                                        </div>
                                        <div class="startdate">
                                            <strong>Start Date:</strong>09 Oct 2026                                        </div>
                                        <div class="closingdate">
                                        <strong>Closing Date:</strong>02 Nov 2026                                        </div>
                                    </div>
                                    <p></p>
                                </div>
                                <div class="button">
                                    <div class="btn__main">Find Out More</div>
                                </div>
                            </a>
                            <a href="https://www.kouga.gov.za/tender/rfq-repairs-to-the-hopper-unit-and-leaking-hydraulic-cylinders-of-fmx-511-ec" title="View tender RFQ: REPAIRS TO THE HOPPER UNIT AND LEAKING HYDRAULIC CYLINDERS OF FMX 511 EC " class="box">
                                <div class="text">
                                    <h3>RFQ: REPAIRS TO THE HOPPER UNIT AND LEAKING HYDRAULIC CYLINDERS OF FMX 511 EC </h3>
                                    <div class="infobox">

                                        <div class="rel__info">
                                            <strong>Ref No:</strong>235/2026                                        </div>
                                        <div class="startdate">
                                            <strong>Start Date:</strong>06 Oct 2026                                        </div>
                                        <div class="closingdate">
                                        <strong>Closing Date:</strong>20 Oct 2026                                        </div>
                                    </div>
                                    <p></p>
                                </div>
                                <div class="button">
                                    <div class="btn__main">Find Out More</div>
                                </div>
                            </a>
                            <a href="https://www.kouga.gov.za/tender/rfq-hiring-of-light-delivery-vehicles-for-various-directorates-of-kouga-local-municipality-for-the-festive-period" title="View tender RFQ: HIRING OF LIGHT DELIVERY VEHICLES FOR VARIOUS DIRECTORATES OF KOUGA LOCAL MUNICIPALITY FOR THE FESTIVE PERIOD" class="box">
                                <div class="text">
                                    <h3>RFQ: HIRING OF LIGHT DELIVERY VEHICLES FOR VARIOUS DIRECTORATES OF KOUGA LOCAL MUNICIPALITY FOR THE FESTIVE PERIOD</h3>
                                    <div class="infobox">

                                        <div class="rel__info">
                                            <strong>Ref No:</strong>234/2026                                        </div>
                                        <div class="startdate">
                                            <strong>Start Date:</strong>06 Oct 2026                                        </div>
                                        <div class="closingdate">
                                        <strong>Closing Date:</strong>20 Oct 2026                                        </div>
                                    </div>
                                    <p></p>
                                </div>
                                <div class="button">
                                    <div class="btn__main">Find Out More</div>
                                </div>
                            </a>
                            <a href="https://www.kouga.gov.za/tender/rfq-electrical-breaker-and-concrete-mixer" title="View tender RFQ: ELECTRICAL BREAKER AND CONCRETE MIXER" class="box">
                                <div class="text">
                                    <h3>RFQ: ELECTRICAL BREAKER AND CONCRETE MIXER</h3>
                                    <div class="infobox">

                                        <div class="rel__info">
                                            <strong>Ref No:</strong>233/2026                                        </div>
                                        <div class="startdate">
                                            <strong>Start Date:</strong>06 Oct 2026                                        </div>
                                        <div class="closingdate">
                                        <strong>Closing Date:</strong>15 Oct 2026                                        </div>
                                    </div>
                                    <p></p>
                                </div>
                                <div class="button">
                                    <div class="btn__main">Find Out More</div>
                                </div>
                            </a>
                            <a href="https://www.kouga.gov.za/tender/rfq-supply-delivery-and-offloading-of-4mm-airdac-cable-without-pilot-cores" title="View tender RFQ: SUPPLY, DELIVERY AND OFFLOADING OF 4MM² AIRDAC CABLE WITHOUT PILOT CORES" class="box">
                                <div class="text">
                                    <h3>RFQ: SUPPLY, DELIVERY AND OFFLOADING OF 4MM² AIRDAC CABLE WITHOUT PILOT CORES</h3>
                                    <div class="infobox">

                                        <div class="rel__info">
                                            <strong>Ref No:</strong>224/2026                                        </div>
                                        <div class="startdate">
                                            <strong>Start Date:</strong>02 Oct 2026                                        </div>
                                        <div class="closingdate">
                                        <strong>Closing Date:</strong>13 Oct 2026                                        </div>
                                    </div>
                                    <p></p>
                                </div>
                                <div class="button">
                                    <div class="btn__main">Find Out More</div>
                                </div>
                            </a>
                            <a href="https://www.kouga.gov.za/tender/resealing-of-roads-phase-4" title="View tender RESEALING OF ROADS - PHASE 4 " class="box">
                                <div class="text">
                                    <h3>RESEALING OF ROADS - PHASE 4 </h3>
                                    <div class="infobox">

                                        <div class="rel__info">
                                            <strong>Ref No:</strong>225/2026                                        </div>
                                        <div class="startdate">
                                            <strong>Start Date:</strong>29 Sep 2026                                        </div>
                                        <div class="closingdate">
                                        <strong>Closing Date:</strong>29 Oct 2026                                        </div>
                                    </div>
                                    <p></p>
                                </div>
                                <div class="button">
                                    <div class="btn__main">Find Out More</div>
                                </div>
                            </a>
                </div>

        </div>
            <div class="paging">
                <div class="paging-nav">
                    <div>1</div> <a href='https://www.kouga.gov.za/tenders/page/2' >2</a> <a href='https://www.kouga.gov.za/tenders/page/3' >3</a> <a href='https://www.kouga.gov.za/tenders/page/4' >4</a> <a href='https://www.kouga.gov.za/tenders/page/2'>></a> <a href='https://www.kouga.gov.za/tenders/page/28'>>|</a>
"""


# --- parse_cards() / max_page() against the real fixture --------------------

cards = kouga.parse_cards(FIXTURE_PAGE_1)
check("all 10 real cards found, in page order",
      [c[2] for c in cards] == ["246/2026", "231/2026", "247/2026", "245/2026", "239/2026",
                                 "235/2026", "234/2026", "233/2026", "224/2026", "225/2026"],
      [c[2] for c in cards])
check("a real cancellation notice is kept, not filtered out", "CANCELLATION" in cards[0][1])
check("a real site typo in a title is preserved, not corrected", "MULTL-FUNCTION" in cards[4][1])
check("title/ref/dates read cleanly (no leftover whitespace)", cards[9][1] == "RESEALING OF ROADS - PHASE 4", repr(cards[9][1]))
check("closing date text read correctly", cards[9][4] == "29 Oct 2026", cards[9][4])
check("real last-page number read from the page's own '>|' pagination link, not guessed",
      kouga.max_page(FIXTURE_PAGE_1) == 28, kouga.max_page(FIXTURE_PAGE_1))

# --- normalize() -> the shared release shape --------------------------------

rel = kouga.normalize(*cards[9])
check("ocid is source-namespaced, stable", rel["ocid"] == "kouga:225/2026", rel["ocid"])
check("contract_number is the real reference", rel["contract_number"] == "225/2026")
check("closing_date parsed to real SAST ISO (DMY-with-month-abbreviation format)",
      rel["closing_date"] == "2026-10-29T00:00:00+02:00", rel["closing_date"])
check("published_date parsed from 'Start Date'", rel["published_date"] == "2026-09-29T00:00:00+02:00", rel["published_date"])
check("buyer is Kouga Local Municipality", rel["buyer"] == "Kouga Local Municipality")
check("source/source_id set for listing_sources", rel["source"] == "kouga" and rel["source_id"] == "225/2026")
check("source_url is the tender's own detail page (no document link on the listing card itself)",
      rel["source_url"].endswith("resealing-of-roads-phase-4"))
check("is_closed computed correctly from the real closing date (future -> not yet closed)",
      rel["is_closed"] is False)

# --- safety checks: fails loudly, never silently ----------------------------

try:
    kouga.parse_cards("<html><body>nothing here</body></html>")
    present = kouga.parse_cards("<html><body>nothing here</body></html>")
    check("an unparseable page returns 0 cards (checked by fetch_releases, not parse_cards itself)",
          present == [])
except Exception as e:
    check("parse_cards itself never raises - the empty-result check belongs to fetch_releases", False, str(e))

check("max_page() defaults to 1 (not a crash) when no pagination links are present at all",
      kouga.max_page("<html>no cards, no paging</html>") == 1)

# --- wired into gov_sources without reintroducing the 14th-run merge bug ---

check("kouga is in SOURCE_LABELS", "kouga" in gov_sources.SOURCE_LABELS)
check("kouga is in ALL_SOURCES (reachability from a real GitHub Actions run confirmed - run 39600219996)",
      "kouga" in gov_sources.ALL_SOURCES)
check("kouga has its own BUYER_FAMILY entry - QA-Edge-Case-Findings.md 14th run's bug class",
      "kouga" in gov_sources.BUYER_FAMILY)
check("the BUYER_FAMILY pattern actually matches 'Kouga Local Municipality'",
      bool(gov_sources.BUYER_FAMILY["kouga"].search("Kouga Local Municipality")))
check("...and does not match an unrelated buyer (no false-positive fold)",
      not gov_sources.BUYER_FAMILY["kouga"].search("Lephalale Local Municipality"))

if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
    sys.exit(1)
print("\nALL PASSED")
