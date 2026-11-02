"""
Regression test for fill_tender.py's tender_check_notes() - the pure
function behind main()'s three post-fill WARNING checks (Form B7's own
closing date vs SETUP's, a bundled TENDDER row that isn't YES, a YES row
with no Form C2.4 figures yet).

Finding 114 (2026-11-01, SANRAL pack rotation): all three used to only
print() - never reaching `notes`, the one list main() returns and
assemble_pack.py actually surfaces into the pack's own manifest warnings
(what a person reviewing the pack sees). A background worker's stdout is
not a notification channel - the same gap this codebase has already found
and fixed for other print-only checks.

No RRM-family sample workbook is committed to this repo (see
test_fill_b7_legacy_precedence.py's own docstring, which hits the same
limit for fill_tender.py's Form B7 precedence fix), so this can't drive
fill_tender.main() end to end the way test_fill_b7_legacy_precedence.py
drives fill_conventional.py against a real Conventional-family sample.
tender_check_notes() was factored out specifically so these checks are
testable as pure functions of already-read values instead - no Workbook
needed at all.

Run: python3 engine/test_fill_tender.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fill_tender as ft  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def test_closing_date_mismatch_is_noted():
    print("tender_check_notes(): Form B7's own closing date differing from SETUP's is reported")
    notes = ft.tender_check_notes("2026-10-29", "2026-11-05", [])
    check("exactly one note, naming both dates", len(notes) == 1 and "2026-10-29" in notes[0] and "2026-11-05" in notes[0], notes)


def test_matching_closing_dates_produce_no_note():
    print("tender_check_notes(): matching closing dates produce nothing")
    notes = ft.tender_check_notes("2026-10-29", "2026-10-29", [])
    check("no note when the two dates agree", notes == [], notes)


def test_bundled_contract_not_yes_is_noted():
    print("tender_check_notes(): a bundled TENDER row whose own YES/NO answer isn't YES is reported")
    notes = ft.tender_check_notes("x", "x", [(1, "R.396-010-2025/1F", "NO", None)])
    check("names the tender number, contract and the real (non-YES) answer",
          len(notes) == 1 and "TENDER 1" in notes[0] and "R.396-010-2025/1F" in notes[0] and "'NO'" in notes[0], notes)


def test_bundled_contract_yes_but_no_c24_figures_is_noted():
    print("tender_check_notes(): a YES row with no Form C2.4 value/hours/category yet is reported")
    notes = ft.tender_check_notes("x", "x", [(2, "R.397", "YES", None)])
    check("names the Form C2.4 sheet and tender number", len(notes) == 1 and "FORM C2.4" in notes[0] and "TENDER 2" in notes[0], notes)
    notes_zero = ft.tender_check_notes("x", "x", [(2, "R.397", "YES", 0)])
    check("a literal 0 counts as 'not filled in' too, same as None/''", len(notes_zero) == 1, notes_zero)


def test_bundled_contract_yes_and_filled_produces_no_note():
    print("tender_check_notes(): a YES row with real Form C2.4 figures already filled is unaffected")
    notes = ft.tender_check_notes("x", "x", [(3, "R.398", "YES", 1234567.89)])
    check("no note once real figures are present", notes == [], notes)


def test_multiple_bundles_each_checked_independently():
    print("tender_check_notes(): several bundled contracts are each checked on their own merits")
    notes = ft.tender_check_notes("x", "x", [
        (1, "R.396", "YES", 500000.0),   # clean - no note
        (2, "R.397", "NO", None),        # not YES
        (3, "R.398", "YES", None),       # YES but no figures yet
    ])
    check("exactly 2 notes - the clean bundle contributes nothing", len(notes) == 2, notes)
    check("the not-YES note and the no-figures note are both present, each naming its own tender number",
          any("TENDER 2" in n for n in notes) and any("TENDER 3" in n for n in notes), notes)


def main():
    test_closing_date_mismatch_is_noted()
    test_matching_closing_dates_produce_no_note()
    test_bundled_contract_not_yes_is_noted()
    test_bundled_contract_yes_but_no_c24_figures_is_noted()
    test_bundled_contract_yes_and_filled_produces_no_note()
    test_multiple_bundles_each_checked_independently()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
