"""
Offline tests for capetown_procurement.py - Finding 489: fetch_rfqs()/
fetch_awards() used to silently drop any row too short to parse, with zero
trace anywhere, the same "silent skip" shape Finding 486 fixed in
run_discovery.py one cycle earlier - except fetch_rfqs() is reachable from
the REAL scheduled daily discovery pipeline (gov_sources.ALL_SOURCES ->
watch_new_tenders.py), not a manual-only tool. award_outcomes.py's own
fetch_portal_awarded() (the eTenders portal's sibling awards reader) already
tracks and reports a skipped-broken-record count for the same shape of
problem; this file's own award/RFQ readers never did, until this fix.

FIXTURE_RFQ_PAGE/FIXTURE_AWARDS_PAGE below are hand-built, matching the
module's own documented real column layout (see capetown_procurement.py's
own normalize_rfq()/fetch_awards() comments) - not captured from a live
page (this sandbox has no network access to web1.capetown.gov.za), but
shaped exactly like the real DOM parse_table()/DETAIL already handle (a
<tr>/<td> table, a header row with "Reference Number" as its first cell,
a /Details/<id> detail link) - including one deliberately short, malformed
row in each to prove the new skip-and-log path, not just the happy path.

Run: python3 engine/discovery/test_capetown_procurement.py   (exit 1 on any failure)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402
import capetown_procurement as cp  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


# Reference Number | Title | Category | Closing Date | Closing (sortable) | Posted | Posted (sortable)
FIXTURE_RFQ_PAGE = """
<table>
<tr><th>Reference Number</th><th>Title</th><th>Category</th><th>Closing Date</th>
    <th>Closing (sortable)</th><th>Posted</th><th>Posted (sortable)</th></tr>
<tr><td><a href="/web1/procurementportal/RFQ/Details/1001">GH12700100</a></td>
    <td>Supply of protective clothing</td><td>Clothing</td>
    <td>28 Nov 2026</td><td>2026-11-28</td><td>14 Nov 2026</td><td>2026-11-14</td></tr>
<tr><td>GH12700200</td><td>Plumbing supplies - broken row, no detail link, no sortable columns</td>
    <td>Plumbing</td></tr>
<tr><td><a href="/web1/procurementportal/RFQ/Details/1002">GH12700300</a></td>
    <td>Minor electrical repairs</td><td>Electrical</td>
    <td>30 Nov 2026</td><td>2026-11-30</td><td>16 Nov 2026</td><td>2026-11-16</td></tr>
</table>
"""

# Reference | Title | Category | Status | Award Date (+ an optional sortable date, 6th column)
FIXTURE_AWARDS_PAGE = """
<table>
<tr><th>Reference Number</th><th>Title</th><th>Category</th><th>Status</th><th>Award Date</th></tr>
<tr><td><a href="/web1/procurementportal/Award/Details/2001">GH12700188</a></td>
    <td>Supply of tools</td><td>Tools</td><td>Awarded</td><td>10 Nov 2026</td></tr>
<tr><td>GH12700999</td><td>Broken row</td><td>Services</td></tr>
</table>
"""


# --- parse_table() against the two fixtures, the real parser, pure --------

rfq_rows = cp.parse_table(FIXTURE_RFQ_PAGE)
check("header row excluded (parse_table's own 'Reference Number' skip)", len(rfq_rows) == 3, len(rfq_rows))
check("the full 7-cell row really has 7 cells", len(rfq_rows[0][0]) == 7, len(rfq_rows[0][0]))
check("the broken row really has only 3 cells - the exact shape that used to vanish silently",
      len(rfq_rows[1][0]) == 3, len(rfq_rows[1][0]))
check("the broken row has no detail link either", rfq_rows[1][1] is None)

award_rows = cp.parse_table(FIXTURE_AWARDS_PAGE)
check("awards: header row excluded", len(award_rows) == 2, len(award_rows))
check("awards: the full row has 5 cells", len(award_rows[0][0]) == 5, len(award_rows[0][0]))
check("awards: the broken row really has only 3 cells", len(award_rows[1][0]) == 3, len(award_rows[1][0]))


# --- fetch_rfqs(): the real bug, end to end, sh.http_get monkeypatched -----

_orig_http_get = sh.http_get
sh.http_get = lambda url, timeout=120: FIXTURE_RFQ_PAGE.encode("utf-8")
log_lines = []
try:
    rels = cp.fetch_rfqs(log=log_lines.append)
finally:
    sh.http_get = _orig_http_get

check("fetch_rfqs: both well-formed RFQs are returned, broken row excluded",
      len(rels) == 2, len(rels))
check("fetch_rfqs: real references read correctly, in page order",
      [r["contract_number"] for r in rels] == ["GH12700100", "GH12700300"],
      [r["contract_number"] for r in rels])
check("the real bug, fixed: a WARNING is logged for the skipped row, naming its own reference",
      any("WARNING" in l and "GH12700200" in l for l in log_lines), log_lines)
check("the WARNING names the actual cell count, not a generic message",
      any("only 3 cell(s)" in l for l in log_lines), log_lines)
check("the final summary line reports the skip count, not just the kept count",
      any("1 row(s) skipped" in l for l in log_lines), log_lines)

# A page with every row well-formed logs no skip at all - the fix must not
# invent a false "skipped" count when nothing was actually skipped.
sh.http_get = lambda url, timeout=120: FIXTURE_RFQ_PAGE.replace(
    '<tr><td>GH12700200</td><td>Plumbing supplies - broken row, no detail link, no sortable columns</td>\n'
    '    <td>Plumbing</td></tr>\n', ""
).encode("utf-8")
clean_log = []
try:
    clean_rels = cp.fetch_rfqs(log=clean_log.append)
finally:
    sh.http_get = _orig_http_get
check("a page with no broken rows: no WARNING logged at all",
      not any("WARNING" in l for l in clean_log), clean_log)
check("a page with no broken rows: the summary line has no skip count",
      not any("skipped" in l for l in clean_log), clean_log)
check("a page with no broken rows: both rows still returned", len(clean_rels) == 2, len(clean_rels))


# --- fetch_awards(): the same real bug, end to end -------------------------

sh.http_get = lambda url, timeout=120: FIXTURE_AWARDS_PAGE.encode("utf-8")
award_log = []
try:
    awards = cp.fetch_awards(with_supplier=False, log=award_log.append)
finally:
    sh.http_get = _orig_http_get

check("fetch_awards: the one well-formed award is returned, broken row excluded",
      len(awards) == 1, len(awards))
check("fetch_awards: real reference read correctly", awards[0]["reference"] == "GH12700188", awards[0])
check("fetch_awards: the real bug, fixed - a WARNING is logged for the skipped row",
      any("WARNING" in l and "GH12700999" in l for l in award_log), award_log)
check("fetch_awards: the WARNING names the actual cell count",
      any("only 3 cell(s)" in l for l in award_log), award_log)
check("fetch_awards: the final summary line reports the skip count",
      any("1 row(s) skipped" in l for l in award_log), award_log)


if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
    sys.exit(1)
print("\nALL PASSED")
