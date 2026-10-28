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

# is_closed is computed inside release() against the REAL current time
# (source_http.is_past(), no `now` override threaded through from here) -
# this fixture's own closing date (29 Oct 2026) is a real, hardcoded
# calendar date that WILL eventually be in the past, same bug class as the
# randwater fixture that just flipped (System-Status.md, Finding 62,
# 2026-10-23: "any fixture with a hardcoded near-term real date will
# eventually flip the same way... a separate, broader task" - this is that
# task, done for this fixture). Freezing the clock (same FixedDateTime
# monkeypatch pattern as engine/test_form_field_audit.py's
# test_today_iso_is_sast_not_naive_utc(), restored immediately after) makes
# "is_closed is False" correct forever, regardless of when this test
# actually runs - not just correct until 2026-10-29. QA pass, 2026-10-23.
import datetime as _real_datetime


class _FixedBeforeClosing(_real_datetime.datetime):
    @classmethod
    def now(cls, tz=None):
        base = _real_datetime.datetime(2026, 10, 25, 9, 0, tzinfo=_real_datetime.timezone.utc)
        return base.astimezone(tz) if tz else base


_real_dt = sh.datetime.datetime
sh.datetime.datetime = _FixedBeforeClosing
try:
    rel = kouga.normalize(*cards[9])
finally:
    sh.datetime.datetime = _real_dt
check("ocid is source-namespaced, stable", rel["ocid"] == "kouga:225/2026", rel["ocid"])
check("contract_number is the real reference", rel["contract_number"] == "225/2026")
check("closing_date parsed to real SAST ISO (DMY-with-month-abbreviation format), defaulted to 11:00 "
      "- Kouga's own card gives no time (Batch 2B: never a literal midnight)",
      rel["closing_date"] == "2026-10-29T11:00:00+02:00", rel["closing_date"])
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

# --- fetch_releases()'s own multi-page loop: never tested end to end ------

# Every check above exercises parse_cards()/max_page()/normalize() in
# isolation - fetch_releases() itself (the real function every production
# run actually calls: the MAX_PAGES_CAP safety raise, the "0 cards on page 1"
# raise, the "0 cards on a LATER page stops early rather than guessing
# further" break, and the multi-page assembly loop) had no test anywhere.
# QA pass, 2026-10-28.

PAGE_2 = FIXTURE_PAGE_1.replace("225/2026", "225/2026-p2").replace(
    "<div>1</div>", "<a href='https://www.kouga.gov.za/tenders/page/1'>1</a>")
PAGE_3 = FIXTURE_PAGE_1.replace("225/2026", "225/2026-p3")
EMPTY_PAGE = "<html><body>nothing here</body></html>"
_real_http_get = sh.http_get


def _serve(pages):
    def fake(url, timeout=90):
        for suffix, html in pages.items():
            if url.endswith(suffix):
                return html.encode("utf-8")
        raise AssertionError(f"unexpected URL requested: {url}")
    return fake


def test_fetch_releases_assembles_every_page_up_to_the_real_last_page():
    # FIXTURE_PAGE_1's own pagination names page 28 as last; max_pages=3 caps
    # it down to a real, small multi-page fetch for the test. The real
    # per-page URL is LIST_URL + "/page/N" (LIST_URL already ends in
    # "/status/open") - "/status/open/page/2", not a bare "/page/2".
    sh.http_get = _serve({"/tenders/status/open": FIXTURE_PAGE_1,
                         "/status/open/page/2": PAGE_2, "/status/open/page/3": PAGE_3})
    try:
        rels = kouga.fetch_releases(max_pages=3)
    finally:
        sh.http_get = _real_http_get
    check("all 3 pages' cards are assembled (10 per page = 30 total)", len(rels) == 30, len(rels))
    check("page 2's own distinct ref made it into the result", any(r["contract_number"] == "225/2026-p2" for r in rels))
    check("page 3's own distinct ref made it into the result", any(r["contract_number"] == "225/2026-p3" for r in rels))


def test_fetch_releases_max_pages_zero_means_page_1_only_not_ignored():
    # The real bug: `if max_pages:` treats 0 the same as "not given at all"
    # (falsy), silently fetching every one of the real site's pages instead
    # of stopping after page 1 as a caller explicitly asking for 0 MORE
    # pages intended. Confirmed this test fails against the pre-fix code by
    # reverting the fix and re-running (see QA-Edge-Case-Findings.md).
    calls = []

    def fake(url, timeout=90):
        calls.append(url)
        return FIXTURE_PAGE_1.encode("utf-8")
    sh.http_get = fake
    try:
        rels = kouga.fetch_releases(max_pages=0)
    finally:
        sh.http_get = _real_http_get
    check("max_pages=0 fetches ONLY page 1, not every page the site reports",
          len(calls) == 1, calls)
    check("...and still returns page 1's own 10 real cards", len(rels) == 10, len(rels))


def test_fetch_releases_stops_early_on_an_empty_later_page():
    sh.http_get = _serve({"/tenders/status/open": FIXTURE_PAGE_1,
                         "/status/open/page/2": PAGE_2, "/status/open/page/3": EMPTY_PAGE})
    logs = []
    try:
        rels = kouga.fetch_releases(max_pages=5, log=logs.append)
    finally:
        sh.http_get = _real_http_get
    check("stops after the empty page, not guessing page 4/5 too",
          len(rels) == 20, len(rels))
    check("a warning names the specific empty page, doesn't raise or go silent",
          any("page 3" in ln and "0 cards" in ln for ln in logs), logs)


def test_fetch_releases_raises_when_page_1_itself_has_zero_cards():
    sh.http_get = _serve({"/tenders/status/open": EMPTY_PAGE})
    try:
        kouga.fetch_releases()
        check("0 cards on page 1 raises rather than reporting a silent empty result", False)
    except RuntimeError as e:
        check("0 cards on page 1 raises rather than reporting a silent empty result",
              "0 tender cards parsed" in str(e), str(e))
    finally:
        sh.http_get = _real_http_get


def test_fetch_releases_raises_past_the_safety_cap_without_fetching_further():
    over_cap = FIXTURE_PAGE_1.replace("page/28", "page/61")
    calls = []

    def fake(url, timeout=90):
        calls.append(url)
        return over_cap.encode("utf-8")
    sh.http_get = fake
    try:
        kouga.fetch_releases()
        check("a last-page number past MAX_PAGES_CAP raises rather than fetching 61 pages", False)
    except RuntimeError as e:
        check("a last-page number past MAX_PAGES_CAP raises rather than fetching 61 pages",
              "past this reader's safety cap" in str(e), str(e))
    finally:
        sh.http_get = _real_http_get
    check("...and never even tries to fetch a second page before raising", calls == ["https://www.kouga.gov.za/tenders/status/open"], calls)


test_fetch_releases_assembles_every_page_up_to_the_real_last_page()
test_fetch_releases_max_pages_zero_means_page_1_only_not_ignored()
test_fetch_releases_stops_early_on_an_empty_later_page()
test_fetch_releases_raises_when_page_1_itself_has_zero_cards()
test_fetch_releases_raises_past_the_safety_cap_without_fetching_further()

if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
    sys.exit(1)
print("\nALL PASSED")
