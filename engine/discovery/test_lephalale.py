"""
Offline tests for lephalale.py, against real page/document content from
lephalale.gov.za (this sandbox's own curl, 2026-10-21):

  - FIXTURE_LISTING below is the real opening rows of the listing table's
    HTML (trimmed, otherwise verbatim).
  - fixtures/lephalale/*.pdf are 3 real batch PDFs, kept whole (not
    trimmed - they're small, and a real PDF can't be hand-edited the way an
    HTML/text fixture can): September 2026 (1 tender), August 2026 (2
    tenders, different closing dates), March 2026 (3 tenders - including the
    real "T46/2025-2026" reference reused across two completely different
    tenders, 8/2/821 and 8/2/805, a real data-quality issue, not this
    reader's own bug - see the module's own docstring).

Run: python3 engine/discovery/test_lephalale.py   (exit 1 on any failure)
"""
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_http as sh  # noqa: E402
import lephalale  # noqa: E402
import gov_sources  # noqa: E402

FAILS = []
HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "fixtures", "lephalale")


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


FIXTURE_LISTING = r"""
<table id='customers'>
  <tr>
    <th>Description</th>
    <th>Date uploaded</th>
    <th>Closing date</th>
  </tr><tr><td><a href='../Documents/September Batch 2026 - Copy.pdf' target='_blank'>September Batch 2026</a></td><td>2026-10-05</td><td>2026-10-19</td></tr><tr><td><a href='../Documents/August_Batch_2026.pdf' target='_blank'>August Batch 2026</a></td><td>2026-08-24</td><td>2026-09-21</td></tr><tr><td><a href='../Documents/June_Batch_2026_batch.pdf' target='_blank'>June Batch 2026 batch</a></td><td>2026-06-30</td><td>2026-07-29</td></tr><tr><td><a href='../Documents/ERRATUM JUNE 2O26.pdf' target='_blank'>ERRATUM JUNE 2O26</a></td><td>2026-07-01</td><td>2026-07-20</td></tr><tr><td><a href='../Documents/March Batch 2026 batch - 2026 tenders.pdf' target='_blank'>March Batch 2026 batch</a></td><td>2026-03-30</td><td>2026-05-05</td></tr>
"""


# --- parse_listing() against the real fixture -------------------------------

rows = lephalale.parse_listing(FIXTURE_LISTING)
check("5 real rows found, in page order", len(rows) == 5, len(rows))
check("a relative href with real unescaped spaces resolves and percent-encodes correctly",
      rows[0][0] == "https://www.lephalale.gov.za/Documents/September%20Batch%202026%20-%20Copy.pdf", rows[0][0])
check("a relative href with no spaces resolves too", rows[1][0].endswith("/Documents/August_Batch_2026.pdf"), rows[1][0])
check("label text read correctly", rows[0][1] == "September Batch 2026", rows[0][1])
check("the listing's own ISO dates read correctly (used only for the fetch cutoff, not release data)",
      rows[0][2] == "2026-10-05" and rows[0][3] == "2026-10-19", (rows[0][2], rows[0][3]))

# --- parse_batch() against the 3 real PDFs ----------------------------------


def _text(filename):
    return lephalale._pdf_text(open(os.path.join(FIXTURES, filename), "rb").read())


sept_rows = lephalale.parse_batch(_text("September Batch 2026 - Copy.pdf"))
check("September batch: exactly 1 tender (not a bundle)", len(sept_rows) == 1, sept_rows)
check("internal ref read correctly", sept_rows[0][0] == "8/2/837", sept_rows[0][0])
check("T-number read correctly, including the trailing year", sept_rows[0][1] == "T10/2026-2027", sept_rows[0][1])
check("closing date is the real SAST datetime, DD/MM/YYYY read correctly (19 Oct, not 10 Jan)",
      sept_rows[0][3] == datetime.datetime(2026, 10, 19, tzinfo=sh.SAST), sept_rows[0][3])

aug_rows = lephalale.parse_batch(_text("August_Batch_2026.pdf"))
check("August batch: exactly 2 tenders, a real bundle", len(aug_rows) == 2, aug_rows)
check("both internal refs are distinct", aug_rows[0][0] != aug_rows[1][0], aug_rows)
check("DD/MM/YYYY read as day-first, not month-first: '07/09/2026' is 7 September, not 9 July",
      aug_rows[0][3] == datetime.datetime(2026, 9, 7, tzinfo=sh.SAST), aug_rows[0][3])
check("the second tender's own, later closing date is read correctly, not confused with the first's",
      aug_rows[1][3] == datetime.datetime(2026, 9, 21, tzinfo=sh.SAST), aug_rows[1][3])

mar_rows = lephalale.parse_batch(_text("March Batch 2026 batch - 2026 tenders.pdf"))
check("March batch: exactly 3 tenders", len(mar_rows) == 3, mar_rows)
mar_refs = [r[0] for r in mar_rows]
check("all 3 internal refs are distinct even though two share the same T-number",
      len(set(mar_refs)) == 3, mar_refs)
mar_tnumbers = [r[1] for r in mar_rows]
check("the real data-quality issue is reproduced, not hidden: 'T46/2025-2026' really is reused "
      "across two different tenders in the real document",
      mar_tnumbers.count("T46/2025-2026") == 2, mar_tnumbers)

# --- normalize() -> the shared release shape --------------------------------

rel = lephalale.normalize(*sept_rows[0], "https://example.org/batch.pdf", "September Batch 2026")
check("ocid is source-namespaced on the real unique key (internal ref, not the reused T-number)",
      rel["ocid"] == "lephalale:8/2/837", rel["ocid"])
check("contract_number is the internal ref", rel["contract_number"] == "8/2/837")
check("closing_date is a real SAST ISO string, defaulted to 11:00 - the batch PDF gives no time "
      "(Batch 2B: never a literal midnight)", rel["closing_date"] == "2026-10-19T11:00:00+02:00", rel["closing_date"])
check("buyer is Lephalale Local Municipality", rel["buyer"] == "Lephalale Local Municipality")
check("source/source_id/source_url set for listing_sources",
      rel["source"] == "lephalale" and rel["source_id"] == "8/2/837")
check("the batch PDF itself is kept as this release's one document (it's where the real text lives)",
      len(rel["documents"]) == 1 and rel["documents"][0]["url"] == "https://example.org/batch.pdf")
check("is_closed computed correctly (19 Oct 2026 is in the past relative to this fixture's own 'today')",
      rel["is_closed"] is True)

# --- the "0 batch rows" / "0 tenders from N opened batches" safety checks ---

try:
    lephalale.parse_listing("<html><body>nothing here</body></html>")
    check("an unparseable listing page raises instead of silently reporting zero batches", False)
except RuntimeError as e:
    check("an unparseable listing page raises instead of silently reporting zero batches",
          "0 batch rows" in str(e), str(e))
check("...and the real fixture is unaffected by that check (still parses clean)",
      len(lephalale.parse_listing(FIXTURE_LISTING)) == 5)

check("a batch PDF with no 'Ref no:' at all (an erratum, pure prose) legitimately returns [], not an error",
      lephalale.parse_batch("This is an erratum notice with no tender table in it at all.") == [])

# --- wired into gov_sources without reintroducing the 14th-run merge bug ---

check("lephalale is in SOURCE_LABELS", "lephalale" in gov_sources.SOURCE_LABELS)
check("lephalale is in ALL_SOURCES (reachability from a real GitHub Actions run confirmed - run 39600219996)",
      "lephalale" in gov_sources.ALL_SOURCES)
check("lephalale has its own BUYER_FAMILY entry - QA-Edge-Case-Findings.md 14th run's bug class",
      "lephalale" in gov_sources.BUYER_FAMILY)
check("the BUYER_FAMILY pattern actually matches 'Lephalale Local Municipality'",
      bool(gov_sources.BUYER_FAMILY["lephalale"].search("Lephalale Local Municipality")))
check("...and does not match an unrelated buyer (no false-positive fold)",
      not gov_sources.BUYER_FAMILY["lephalale"].search("Vaal Central Water Board"))

# --- _recent_enough()'s cutoff uses SAST, not a naive UTC today() ---------

# Finding (2026-10-27): _recent_enough() computed "today" via naive
# datetime.date.today() - a bridge worker container has no TZ set and runs
# in UTC by default, so this is one calendar day BEHIND the real SAST date
# for the whole 00:00-01:59 SAST window every day, making the cutoff one day
# too lenient (a batch that should already be excluded as too old is still
# fetched) during that window - the same naive-UTC-"today" bug class this
# repo has independently fixed in several other files. Simulates the system
# clock at UTC 2026-10-20 23:30 (= SAST 2026-10-21 01:30, inside the bad
# window) by monkeypatching this module's own datetime.date AND
# datetime.datetime (the fixed code reads the aware one; the original buggy
# code called datetime.date.today() directly, so both must be patched for
# this test to actually exercise either version - patching only one of them
# let a reverted fix pass by accident, falling through to the real sandbox
# clock instead, confirmed the hard way on a different file this same day),
# restored immediately after.


class _FixedDateTime(datetime.datetime):
    @classmethod
    def now(cls, tz=None):
        base = datetime.datetime(2026, 10, 20, 23, 30, tzinfo=datetime.timezone.utc)
        return base.astimezone(tz) if tz else base


class _FixedDate(datetime.date):
    @classmethod
    def today(cls):
        return cls(2026, 10, 20)  # the naive UTC date at that same simulated moment


_real_datetime, _real_date = lephalale.datetime.datetime, lephalale.datetime.date
lephalale.datetime.datetime, lephalale.datetime.date = _FixedDateTime, _FixedDate
try:
    # cutoff_days=10: the real SAST today is 2026-10-21, so the real cutoff is
    # 2026-10-11 - a batch closing on 2026-10-10 is one day too old and must be excluded.
    check("a batch exactly one day older than the real SAST cutoff is correctly excluded, "
          "not let through by a naive UTC 'today' that's one day behind",
          lephalale._recent_enough("2026-10-10", 10) is False)
    check("a batch closing exactly on the real SAST cutoff day is still included",
          lephalale._recent_enough("2026-10-11", 10) is True)
finally:
    lephalale.datetime.datetime, lephalale.datetime.date = _real_datetime, _real_date

if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
    sys.exit(1)
print("\nALL PASSED")
