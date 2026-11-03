"""
Offline checks for list_tenders.py - no network.

Finding 124 (2026-11-03, discovery rotation): a single malformed row (fewer
than 6 cells) anywhere in SANRAL's own AJAX list response crashed
_parse_row()'s unpacking, which crashed fetch_tenders()'s own list
comprehension - every OTHER real, well-formed tender in that same response
was lost too, not just the one bad row. This module's own docstring already
documents SANRAL's response as inconsistent (total_filtered doesn't always
equal the actual row count), so a single short row is a realistic, not
theoretical, shape - and gov_sources.fetch_all()'s own per-source try/except
only means the whole SANRAL source gets dropped for the run (correctly
alerted), not that the real tenders in the same response are preserved.

Usage: python3 engine/discovery/test_list_tenders.py
"""
import json
import os
import sys
from unittest.mock import patch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import list_tenders as lt  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'}  {name}" + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


GOOD_ROW = [
    '<a href="/sanral-tenders/detail/r-396-010-2025-1f">R.396-010-2025/1F</a>',
    "Consulting Engineering Services", "Eastern Cape",
    "Routine ad-hoc maintenance of R396 Section 1", "procurement@nra.co.za", "22 October 2026",
]


def test_parse_row_reads_a_real_well_formed_row():
    print("_parse_row(): a real, well-formed 6-cell row parses cleanly")
    r = lt._parse_row(GOOD_ROW)
    check("reference read from the link text", r["reference"] == "R.396-010-2025/1F", r)
    check("slug read from the href", r["slug"] == "r-396-010-2025-1f", r)
    check("email extracted from the queries-to cell", r["queries_to_email"] == "procurement@nra.co.za", r)
    check("closing date carried through", r["closing_date"] == "22 October 2026", r)


def test_parse_row_on_a_short_row_raises_a_clear_error_not_a_bare_unpack_crash():
    print("_parse_row(): a row with fewer than 6 cells raises a clear, actionable error")
    try:
        lt._parse_row(GOOD_ROW[:4])
        check("a 4-cell row raises", False, "no exception was raised at all")
    except ValueError as e:
        check("the error names how many cells it actually got", "4 cell" in str(e), str(e))
    except Exception as e:
        check("raises ValueError specifically, not some other exception type", False,
              f"{type(e).__name__}: {e}")


class _FakeResponse:
    def __init__(self, payload):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self):
        return json.dumps(self._payload).encode()


def _fake_urlopen(payload):
    return lambda req, timeout=30: _FakeResponse(payload)


def test_fetch_tenders_skips_one_malformed_row_without_losing_the_rest():
    print("fetch_tenders(): one malformed row among real ones is skipped and warned about, "
          "not a crash that loses every tender in the response")
    short_row = GOOD_ROW[:3]  # a real, reachable shape per this module's own docstring
    other_good_row = [
        '<a href="/sanral-tenders/detail/r-343-020-2025-1f">R.343-020-2025/1F</a>',
        "Consulting Engineering Services", "KwaZulu-Natal",
        "Rehabilitation of the N3", "bids@nra.co.za", "5 November 2026",
    ]
    payload = {"tenders": [GOOD_ROW, short_row, other_good_row], "total": 139, "total_filtered": 3}
    warnings = []
    with patch("list_tenders.urllib.request.urlopen", _fake_urlopen(payload)):
        rows, total, total_filtered = lt.fetch_tenders(log=warnings.append)
    check("the two real, well-formed rows are both still returned (the bug this test guards)",
          len(rows) == 2, rows)
    check("the first good row's reference survived", any(r["reference"] == "R.396-010-2025/1F" for r in rows), rows)
    check("the second good row's reference survived too", any(r["reference"] == "R.343-020-2025/1F" for r in rows), rows)
    check("exactly one warning was logged for the one bad row, not silently dropped with no trace",
          len(warnings) == 1 and "skipped" in warnings[0], warnings)
    check("total/total_filtered are still passed through unchanged", total == 139 and total_filtered == 3,
          (total, total_filtered))


def main():
    test_parse_row_reads_a_real_well_formed_row()
    test_parse_row_on_a_short_row_raises_a_clear_error_not_a_bare_unpack_crash()
    test_fetch_tenders_skips_one_malformed_row_without_losing_the_rest()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
