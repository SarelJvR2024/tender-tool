"""
Offline tests for vaal_central_water.py, against the REAL page source of
https://vaalcentralwater.co.za/advertised-tenders/ (this sandbox's own curl,
2026-10-20 - see that module's own docstring for the WAF/User-Agent story).
FIXTURE_PAGE below is five real rows from that saved page, trimmed of the
other four tenders but otherwise untouched: an empty decorative row with no
reference (confirmed real - the live page has one), the two real header
rows (one of which carries an extra "elementor-hidden-mobile" class the
tender rows don't have - the reason ROW_SPLIT tolerates extra classes, not
just the exact class string every tender row happens to use), a plain
(non-<strong>) multi-line title with a real <br/> line break (VCW380), a
<strong>-wrapped reference AND title (VCW440 - confirmed inconsistent with
VCW380 on the real page), and a plain reference with six real document
buttons including the site's own typo ("Breifing Session", VCW438) - kept
verbatim, not corrected, same discipline as test_randwater.py's "MAINTENACE"/
"INFRUSTRUCTURE".

Run: python3 engine/discovery/test_vaal_central_water.py   (exit 1 on any failure)
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402
import vaal_central_water as vcw  # noqa: E402
import gov_sources  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


FIXTURE_PAGE = r"""
<div class="elementor-element elementor-element-abef1a0 e-flex e-con-boxed e-con e-parent" data-id="abef1a0" data-element_type="container" data-e-type="container" data-settings="{&quot;background_background&quot;:&quot;classic&quot;}">
					<div class="e-con-inner">
					</div>
				</div>
		<div class="elementor-element elementor-element-cd28d5f e-flex e-con-boxed e-con e-parent" data-id="cd28d5f" data-element_type="container" data-e-type="container">
					<div class="e-con-inner">
				<div class="elementor-element elementor-element-caba3d1 elementor-widget elementor-widget-text-editor" data-id="caba3d1" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p><strong>Advertised tenders</strong></p>								</div>
				</div>
					</div>
				</div>
		<div class="elementor-element elementor-element-14e5221 elementor-hidden-mobile e-flex e-con-boxed e-con e-parent" data-id="14e5221" data-element_type="container" data-e-type="container" data-settings="{&quot;background_background&quot;:&quot;classic&quot;}">
					<div class="e-con-inner">
		<div class="elementor-element elementor-element-31557d1 e-con-full e-flex e-con e-child" data-id="31557d1" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-134a9c7 elementor-widget elementor-widget-text-editor" data-id="134a9c7" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p><strong>Reference no.</strong></p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-e1afc78 e-con-full e-flex e-con e-child" data-id="e1afc78" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-cccad17 elementor-widget elementor-widget-text-editor" data-id="cccad17" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p><strong>Description</strong></p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-9db50e9 e-con-full e-flex e-con e-child" data-id="9db50e9" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-7f5934d elementor-widget elementor-widget-text-editor" data-id="7f5934d" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p><strong>Date uploaded</strong></p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-17bc4ed e-con-full e-flex e-con e-child" data-id="17bc4ed" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-22a823b elementor-widget elementor-widget-text-editor" data-id="22a823b" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p><strong>Closing date</strong></p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-9a8e261 e-con-full e-flex e-con e-child" data-id="9a8e261" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-3466ec2 elementor-widget elementor-widget-text-editor" data-id="3466ec2" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p><strong>Download</strong></p>								</div>
				</div>
				</div>
					</div>
				</div>
		<div class="elementor-element elementor-element-e3efa91 e-flex e-con-boxed e-con e-parent" data-id="e3efa91" data-element_type="container" data-e-type="container" data-settings="{&quot;background_background&quot;:&quot;classic&quot;}">
					<div class="e-con-inner">
		<div class="elementor-element elementor-element-5d2c8f5 e-con-full e-flex e-con e-child" data-id="5d2c8f5" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-d28ceab elementor-widget elementor-widget-text-editor" data-id="d28ceab" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p>VCW380/PWLPLM/24</p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-7415f7f e-con-full e-flex e-con e-child" data-id="7415f7f" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-987c5ff elementor-widget elementor-widget-text-editor" data-id="987c5ff" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p>MALUTI-A-PHOFUNG LOCAL MUNICIPALITY: APPOINTMENT OF A MAXIMUM OF FOUR<br />(04) CONTRACTORS FOR THE REPAIRS OF POTABLE WATER LEAKS MALUTI-APHOFUNG<br />LOCAL MUNICIPALITY IN PHUTHADITJABA</p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-13f4b81 e-con-full e-flex e-con e-child" data-id="13f4b81" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-8c9f4e1 elementor-widget elementor-widget-text-editor" data-id="8c9f4e1" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p>Date uploaded:</p><p>11 SEPTEMBER 2026</p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-ab9cd3a e-con-full e-flex e-con e-child" data-id="ab9cd3a" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-832ef0c elementor-widget elementor-widget-text-editor" data-id="832ef0c" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p>Closing date:</p><p>09 OCTOBER 2026</p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-15b3db9 e-con-full e-flex e-con e-child" data-id="15b3db9" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-90bca00 elementor-align-left elementor-mobile-align-center elementor-widget elementor-widget-button" data-id="90bca00" data-element_type="widget" data-e-type="widget" data-widget_type="button.default">
				<div class="elementor-widget-container">
									<div class="elementor-button-wrapper">
					<a class="elementor-button elementor-button-link elementor-size-sm" href="https://vaalcentralwater.co.za/wp-content/uploads/2026/09/TENDER-NO.-VCW380-PWLPLM-24-Tender-Doc_Rev-3-Submitted-11Sept26.pdf">
						<span class="elementor-button-content-wrapper">
									<span class="elementor-button-text">Tender advert</span>
					</span>
					</a>
				</div>
								</div>
				</div>
				<div class="elementor-element elementor-element-6b7c938 elementor-align-left elementor-mobile-align-center elementor-widget elementor-widget-button" data-id="6b7c938" data-element_type="widget" data-e-type="widget" data-widget_type="button.default">
				<div class="elementor-widget-container">
									<div class="elementor-button-wrapper">
					<a class="elementor-button elementor-button-link elementor-size-sm" href="https://vaalcentralwater.co.za/wp-content/uploads/2026/09/VCW380-PWLPLM-24-Bill-of-Quantites-with-Formulas-for-Contractors.xlsx">
						<span class="elementor-button-content-wrapper">
									<span class="elementor-button-text">BoQ</span>
					</span>
					</a>
				</div>
								</div>
				</div>
				</div>
					</div>
				</div>
		<div class="elementor-element elementor-element-93fde95 e-flex e-con-boxed e-con e-parent" data-id="93fde95" data-element_type="container" data-e-type="container" data-settings="{&quot;background_background&quot;:&quot;classic&quot;}">
					<div class="e-con-inner">
		<div class="elementor-element elementor-element-2e83891 e-con-full e-flex e-con e-child" data-id="2e83891" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-4a8779d elementor-widget elementor-widget-text-editor" data-id="4a8779d" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p><strong>VCW440/STEELBPTB/26 </strong></p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-5966267 e-con-full e-flex e-con e-child" data-id="5966267" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-b5731ad elementor-widget elementor-widget-text-editor" data-id="b5731ad" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p><strong>CONSTRUCTION OF A STEEL BY-PASS PIPELINE AND BREAK PRESSURE TANK AT BRANDKOP RESERVOIR INCLUDING RESERVOIR JOINT SEALING AND CONCRETE REPAIRS</strong></p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-504b13e e-con-full e-flex e-con e-child" data-id="504b13e" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-15008a4 elementor-widget elementor-widget-text-editor" data-id="15008a4" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p>Date uploaded:</p><p>08 SEPTEMBER 2026</p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-03fae77 e-con-full e-flex e-con e-child" data-id="03fae77" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-9bd2b8b elementor-widget elementor-widget-text-editor" data-id="9bd2b8b" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p>Closing date:</p><p>06 OCTOBER 2026</p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-068800a e-con-full e-flex e-con e-child" data-id="068800a" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-10e3e65 elementor-align-left elementor-mobile-align-center elementor-widget elementor-widget-button" data-id="10e3e65" data-element_type="widget" data-e-type="widget" data-widget_type="button.default">
				<div class="elementor-widget-container">
									<div class="elementor-button-wrapper">
					<a class="elementor-button elementor-button-link elementor-size-sm" href="https://vaalcentralwater.co.za/wp-content/uploads/2026/09/CONSTRUCTION-OF-A-STEEL-BY-PASS-PIPELINE-AND-BREAK-PRESSURE.pdf">
						<span class="elementor-button-content-wrapper">
									<span class="elementor-button-text">Tender advert</span>
					</span>
					</a>
				</div>
								</div>
				</div>
				<div class="elementor-element elementor-element-dd96b46 elementor-align-left elementor-mobile-align-center elementor-widget elementor-widget-button" data-id="dd96b46" data-element_type="widget" data-e-type="widget" data-widget_type="button.default">
				<div class="elementor-widget-container">
									<div class="elementor-button-wrapper">
					<a class="elementor-button elementor-button-link elementor-size-sm" href="https://vaalcentralwater.co.za/wp-content/uploads/2026/09/Brandkop-Sealing-and-By-Pass-Drawings-.pdf">
						<span class="elementor-button-content-wrapper">
									<span class="elementor-button-text">Drawings</span>
					</span>
					</a>
				</div>
								</div>
				</div>
				<div class="elementor-element elementor-element-a97831b elementor-align-left elementor-mobile-align-center elementor-widget elementor-widget-button" data-id="a97831b" data-element_type="widget" data-e-type="widget" data-widget_type="button.default">
				<div class="elementor-widget-container">
									<div class="elementor-button-wrapper">
					<a class="elementor-button elementor-button-link elementor-size-sm" href="https://vaalcentralwater.co.za/wp-content/uploads/2026/09/VCW440-STELBPTB-26-BOQ_Tender-Blank.xlsx">
						<span class="elementor-button-content-wrapper">
									<span class="elementor-button-text">BoQ Blank</span>
					</span>
					</a>
				</div>
								</div>
				</div>
				</div>
					</div>
				</div>
		<div class="elementor-element elementor-element-d4cfa4d e-flex e-con-boxed e-con e-parent" data-id="d4cfa4d" data-element_type="container" data-e-type="container" data-settings="{&quot;background_background&quot;:&quot;classic&quot;}">
					<div class="e-con-inner">
		<div class="elementor-element elementor-element-5eb6520 e-con-full e-flex e-con e-child" data-id="5eb6520" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-0da0f4e elementor-widget elementor-widget-text-editor" data-id="0da0f4e" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p>VCW438/LIMS3/26</p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-65e6b54 e-con-full e-flex e-con e-child" data-id="65e6b54" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-307bbbb elementor-widget elementor-widget-text-editor" data-id="307bbbb" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p>APPOINTMENT OF A SUITABLY QUALIFIED SERVICE PROVIDER FOR THE IMPLEMENTATION, MAINTENANCE AND ANNUAL LICENSING OF LABORATORY INFORMATION MANAGEMENT SYSTEM (LIMS) FOR A PERIOD OF THREE (3) YEARS.</p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-dc50e81 e-con-full e-flex e-con e-child" data-id="dc50e81" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-b84af1d elementor-widget elementor-widget-text-editor" data-id="b84af1d" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p>Date uploaded:</p><p>19 AUGUST 2026</p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-b2dc893 e-con-full e-flex e-con e-child" data-id="b2dc893" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-d472752 elementor-widget elementor-widget-text-editor" data-id="d472752" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p>Closing date:</p><p>10 SEPTEMBER 2026</p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-bb6c913 e-con-full e-flex e-con e-child" data-id="bb6c913" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-0f0aaeb elementor-align-left elementor-mobile-align-center elementor-widget elementor-widget-button" data-id="0f0aaeb" data-element_type="widget" data-e-type="widget" data-widget_type="button.default">
				<div class="elementor-widget-container">
									<div class="elementor-button-wrapper">
					<a class="elementor-button elementor-button-link elementor-size-sm" href="https://vaalcentralwater.co.za/wp-content/uploads/2026/08/LABORATORY-INFORMATION-MANAGEMENT-SYSTEM-LIMS.pdf">
						<span class="elementor-button-content-wrapper">
									<span class="elementor-button-text">Tender advert</span>
					</span>
					</a>
				</div>
								</div>
				</div>
				<div class="elementor-element elementor-element-bf7e6ae elementor-align-left elementor-mobile-align-center elementor-widget elementor-widget-button" data-id="bf7e6ae" data-element_type="widget" data-e-type="widget" data-widget_type="button.default">
				<div class="elementor-widget-container">
									<div class="elementor-button-wrapper">
					<a class="elementor-button elementor-button-link elementor-size-sm" href="https://vaalcentralwater.co.za/wp-content/uploads/2026/09/LIMS-Addendum-1.pdf">
						<span class="elementor-button-content-wrapper">
									<span class="elementor-button-text">Addendum 1</span>
					</span>
					</a>
				</div>
								</div>
				</div>
				<div class="elementor-element elementor-element-532485b elementor-align-left elementor-mobile-align-center elementor-widget elementor-widget-button" data-id="532485b" data-element_type="widget" data-e-type="widget" data-widget_type="button.default">
				<div class="elementor-widget-container">
									<div class="elementor-button-wrapper">
					<a class="elementor-button elementor-button-link elementor-size-sm" href="https://vaalcentralwater.co.za/wp-content/uploads/2026/09/LIMSBriefing-session1.pptx">
						<span class="elementor-button-content-wrapper">
									<span class="elementor-button-text">Breifing Session</span>
					</span>
					</a>
				</div>
								</div>
				</div>
				<div class="elementor-element elementor-element-ec06f93 elementor-align-left elementor-mobile-align-center elementor-widget elementor-widget-button" data-id="ec06f93" data-element_type="widget" data-e-type="widget" data-widget_type="button.default">
				<div class="elementor-widget-container">
									<div class="elementor-button-wrapper">
					<a class="elementor-button elementor-button-link elementor-size-sm" href="https://vaalcentralwater.co.za/wp-content/uploads/2026/09/List-of-Equipment-For-LIMS.pdf">
						<span class="elementor-button-content-wrapper">
									<span class="elementor-button-text">Equipment List</span>
					</span>
					</a>
				</div>
								</div>
				</div>
				<div class="elementor-element elementor-element-3c32412 elementor-align-left elementor-mobile-align-center elementor-widget elementor-widget-button" data-id="3c32412" data-element_type="widget" data-e-type="widget" data-widget_type="button.default">
				<div class="elementor-widget-container">
									<div class="elementor-button-wrapper">
					<a class="elementor-button elementor-button-link elementor-size-sm" href="https://vaalcentralwater.co.za/wp-content/uploads/2026/09/Meeting-minutes-LIMS_encrypted_.pdf">
						<span class="elementor-button-content-wrapper">
									<span class="elementor-button-text">Minutes</span>
					</span>
					</a>
				</div>
								</div>
				</div>
				<div class="elementor-element elementor-element-9aa6365 elementor-align-left elementor-mobile-align-center elementor-widget elementor-widget-button" data-id="9aa6365" data-element_type="widget" data-e-type="widget" data-widget_type="button.default">
				<div class="elementor-widget-container">
									<div class="elementor-button-wrapper">
					<a class="elementor-button elementor-button-link elementor-size-sm" href="https://vaalcentralwater.co.za/wp-content/uploads/2026/09/Correct-SBD-3.2.pdf">
						<span class="elementor-button-content-wrapper">
									<span class="elementor-button-text">SBD 3.2</span>
					</span>
					</a>
				</div>
								</div>
				</div>
				</div>
					</div>
				</div>
"""

# A real "notice" row from the live page, 2026-11-01 - "EXTENSION OF
# VALIDITY TO TENDERS" lists 5 reference numbers as separate <p> tags all
# inside the FIRST widget (the one ROW_FIELDS expects to hold exactly one
# reference), with the real title in the SECOND widget. Appended as its own
# row, not mixed into FIXTURE_PAGE above, so the 3-tenders assertion below
# stays about the original fixture unchanged.
NOTICE_ROW = r"""
		<div class="elementor-element elementor-element-93fde96 e-flex e-con-boxed e-con e-parent" data-id="93fde96" data-element_type="container" data-e-type="container" data-settings="{&quot;background_background&quot;:&quot;classic&quot;}">
					<div class="e-con-inner">
		<div class="elementor-element elementor-element-2e83892 e-con-full e-flex e-con e-child" data-id="2e83892" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-4a8779e elementor-widget elementor-widget-text-editor" data-id="4a8779e" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p>VCW/MAINCE/25</p><p>VCW/MAINEB/25</p><p>VCW/MAINME/25</p><p>VCW383/LEGAL36/24</p><p>VCW261/PPE/21</p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-5966268 e-con-full e-flex e-con e-child" data-id="5966268" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-b5731ae elementor-widget elementor-widget-text-editor" data-id="b5731ae" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p><strong>EXTENSION OF VALIDITY TO TENDERS</strong></p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-504b13f e-con-full e-flex e-con e-child" data-id="504b13f" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-15008a5 elementor-widget elementor-widget-text-editor" data-id="15008a5" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p>Date uploaded:</p><p>03 October 2026</p>								</div>
				</div>
				</div>
		<div class="elementor-element elementor-element-03fae78 e-con-full e-flex e-con e-child" data-id="03fae78" data-element_type="container" data-e-type="container">
				<div class="elementor-element elementor-element-9bd2b8c elementor-widget elementor-widget-text-editor" data-id="9bd2b8c" data-element_type="widget" data-e-type="widget" data-widget_type="text-editor.default">
				<div class="elementor-widget-container">
									<p>Closing date:</p><p>07 December 2026</p>								</div>
				</div>
				</div>
					</div>
				</div>
"""


# --- parse_tenders() against the real fixture -------------------------------

rows = vcw.parse_tenders(FIXTURE_PAGE)
check("all 3 real tenders found, in page order, header/empty rows skipped (not errors)",
      [r[0] for r in rows] == ["VCW380/PWLPLM/24", "VCW440/STEELBPTB/26", "VCW438/LIMS3/26"],
      [r[0] for r in rows])

# A multi-reference "notice" row (e.g. "EXTENSION OF VALIDITY TO TENDERS")
# crams several <p>-wrapped reference numbers into the column ROW_FIELDS
# expects to hold exactly one - its lazy .*? then grabs the SECOND reference
# as if it were the title. Found 2026-11-01, reproduced against the real
# live page (not just this fixture): skipped with a warning, not emitted as
# a bogus tender whose "title" is itself a reference number.
notice_logs = []
rows_with_notice = vcw.parse_tenders(FIXTURE_PAGE + NOTICE_ROW, log=lambda m: notice_logs.append(m))
check("the multi-reference notice row is skipped, not emitted as a 4th tender",
      [r[0] for r in rows_with_notice] == ["VCW380/PWLPLM/24", "VCW440/STEELBPTB/26", "VCW438/LIMS3/26"],
      [r[0] for r in rows_with_notice])
check("...and a warning naming the skipped reference is logged, not silently dropped",
      len(notice_logs) == 1 and "VCW/MAINCE/25" in notice_logs[0], notice_logs)

vcw380 = rows[0]
check("a plain (non-<strong>) reference with a trailing <br/>-broken title reads as one clean line",
      vcw380[1] == "MALUTI-A-PHOFUNG LOCAL MUNICIPALITY: APPOINTMENT OF A MAXIMUM OF FOUR (04) CONTRACTORS FOR THE "
                   "REPAIRS OF POTABLE WATER LEAKS MALUTI-APHOFUNG LOCAL MUNICIPALITY IN PHUTHADITJABA",
      vcw380[1])
check("uploaded date text read correctly", vcw380[2] == "11 SEPTEMBER 2026", vcw380[2])
check("closing date text read correctly", vcw380[3] == "09 OCTOBER 2026", vcw380[3])
check("2 real documents read, in page order",
      [d[1] for d in vcw380[4]] == ["Tender advert", "BoQ"], vcw380[4])

vcw440 = rows[1]
check("a <strong>-wrapped reference (with the site's own trailing space) reads clean",
      vcw440[0] == "VCW440/STEELBPTB/26", repr(vcw440[0]))
check("a <strong>-wrapped title reads clean too", vcw440[1].startswith("CONSTRUCTION OF A STEEL BY-PASS"), vcw440[1])
check("3 documents read for the strong-wrapped row", len(vcw440[4]) == 3, vcw440[4])

vcw438 = rows[2]
check("6 documents read, including every one (not just the first/last)", len(vcw438[4]) == 6, vcw438[4])
check("a real site typo in a document label is preserved, not corrected",
      any(label == "Breifing Session" for _, label in vcw438[4]), vcw438[4])

# --- normalize() -> the shared release shape --------------------------------

rel = vcw.normalize(*vcw380)
check("ocid is source-namespaced, stable, no OCDS id to fake", rel["ocid"] == "vaal_central_water:VCW380/PWLPLM/24", rel["ocid"])
check("contract_number is the real reference", rel["contract_number"] == "VCW380/PWLPLM/24")
check("closing_date parsed to real SAST ISO (full month name, not an abbreviation), defaulted to 11:00 "
      "- the listing gives no time (Batch 2B: never a literal midnight)",
      rel["closing_date"] == "2026-10-09T11:00:00+02:00", rel["closing_date"])
check("published_date parsed from 'Date uploaded'", rel["published_date"] == "2026-09-11T00:00:00+02:00", rel["published_date"])
check("buyer is Vaal Central Water Board", rel["buyer"] == "Vaal Central Water Board")
check("source/source_id/source_url set for listing_sources",
      rel["source"] == "vaal_central_water" and rel["source_id"] == "VCW380/PWLPLM/24")
check("documents carry real urls and labels, not faked",
      rel["documents"][0]["url"].endswith("Tender-Doc_Rev-3-Submitted-11Sept26.pdf") and
      rel["documents"][0]["title"] == "Tender advert", rel["documents"])
check("is_closed computed correctly from the real closing date (09 Oct 2026, already past "
      "this fixture's own 'today' at the time this test runs - correctly flagged closed, not open)",
      rel["is_closed"] is True)

# --- the "0 tenders parsed" safety check: fails loudly, never silently ------
#     verified as a real regression catch, not just code that looks right:
#     revert to a page with no recognisable row -> confirm it raises;
#     restore the real fixture -> confirm it's clean again (same discipline
#     as randwater's pageCount check, just verified explicitly here too).

try:
    vcw.parse_tenders("<html><body>nothing here</body></html>")
    check("an unparseable page raises instead of silently reporting zero tenders", False)
except RuntimeError as e:
    check("an unparseable page raises instead of silently reporting zero tenders",
          "0 tenders parsed" in str(e), str(e))
check("...and the real fixture is unaffected by that check (still parses clean)",
      len(vcw.parse_tenders(FIXTURE_PAGE)) == 3)

# --- wired into gov_sources without reintroducing the 14th-run merge bug ---

check("vaal_central_water is in SOURCE_LABELS", "vaal_central_water" in gov_sources.SOURCE_LABELS)
check("vaal_central_water is in ALL_SOURCES (reachability from a real GitHub Actions run confirmed - run 39600219996)",
      "vaal_central_water" in gov_sources.ALL_SOURCES)
check("vaal_central_water has its own BUYER_FAMILY entry - QA-Edge-Case-Findings.md 14th run's bug class",
      "vaal_central_water" in gov_sources.BUYER_FAMILY)
check("the BUYER_FAMILY pattern actually matches 'Vaal Central Water Board'",
      bool(gov_sources.BUYER_FAMILY["vaal_central_water"].search("Vaal Central Water Board")))
check("...and does not match an unrelated buyer (no false-positive fold)",
      not gov_sources.BUYER_FAMILY["vaal_central_water"].search("Rand Water"))

# --- _disambiguate_reused_refs(): the same confirmed-live reused-Ref bug ---
#     already fixed for dbsa_procurement.py (Ref "RFP185/2026", 2026-11-07)
#     and kouga.py (Ref "235/2026", 2026-11-06) - this page can equally list
#     a re-advertisement/addendum as a SECOND row for the same Ref No.,
#     alongside its own original, with no per-row detail URL to tell the
#     two apart (same shape as DBSA, not kouga's own per-card URL slug).

row_original = vcw.normalize("VCW422/CONTR/IRM2/26", "CONTRACTOR FOR IRM PHASE 2",
                              "01 September 2026", "15 September 2026", [])
row_readvert = vcw.normalize("VCW422/CONTR/IRM2/26",
                              "RE-ADVERTISEMENT: CONTRACTOR FOR IRM PHASE 2 (ADDENDUM 1 - EXTENDED CLOSING)",
                              "20 October 2026", "10 November 2026", [])
check("pre-disambiguation, a reused ref DOES collide to the identical ocid (confirms the bug "
      "shape is real before asserting the fix)",
      row_original["ocid"] == row_readvert["ocid"] == "vaal_central_water:VCW422/CONTR/IRM2/26")

reused_pair = [row_original, row_readvert]
vcw._disambiguate_reused_refs(reused_pair)
check("a reused ref is disambiguated by published_date, no longer colliding",
      reused_pair[0]["ocid"] != reused_pair[1]["ocid"] and
      reused_pair[0]["ocid"] == "vaal_central_water:VCW422/CONTR/IRM2/26:2026-09-01T00:00:00+02:00" and
      reused_pair[1]["ocid"] == "vaal_central_water:VCW422/CONTR/IRM2/26:2026-10-20T00:00:00+02:00",
      [r["ocid"] for r in reused_pair])

single = [vcw.normalize("VCW999/X/26", "SOME OTHER TENDER", "01 January 2026", "01 February 2026", [])]
before_ocid = single[0]["ocid"]
vcw._disambiguate_reused_refs(single)
check("a non-colliding ref keeps exactly the ocid it always had (no other tender re-triggers "
      "a 'new tender' alert)",
      single[0]["ocid"] == before_ocid == "vaal_central_water:VCW999/X/26")

same_day_pair = [
    vcw.normalize("VCW1/A/26", "TITLE A", "01 January 2026", "01 February 2026", []),
    vcw.normalize("VCW1/A/26", "TITLE B (RE-ADVERT)", "01 January 2026", "15 February 2026", []),
]
vcw._disambiguate_reused_refs(same_day_pair)
check("...and a same-published_date collision still falls back to a title hash, never silently merged",
      same_day_pair[0]["ocid"] != same_day_pair[1]["ocid"], [r["ocid"] for r in same_day_pair])

if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
    sys.exit(1)
print("\nALL PASSED")
