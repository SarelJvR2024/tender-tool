"""
Regression test for fill_conventional.py's b7_closing_date_note() - Form
B7's own pre-filled closing date (TEND 1X!F125) vs the SETUP sheet's own
closing date (SETUP!C3).

Finding 383 (2026-11-11, standing solution-architect review): fill_tender.py
(the RRM Consultant Tender family) already warns when these two disagree -
tender_check_notes(), Finding 114, 2026-11-01 - but fill_conventional.py
(the Conventional Consultant Tender family) never got the matching check,
even though this file's own docstring states the Form B3/B7 cells "turned
out to be IDENTICAL to the RRM template" - confirmed directly against the
real committed sample below (TEND 1X!F125 holds the same "Tender Closing
date:" serial SETUP!C3 does). A Conventional-family pack where SANRAL's own
two closing-date pre-fills disagree was silently unwarned.

Covers both ends: the pure function in isolation (no Workbook needed, same
convention as test_fill_tender.py's own tender_check_notes() test - no
crafted-mismatch sample is committed either, since both closing dates come
from the template itself, not from pack.yaml), and a real end-to-end run of
fill_conventional.main() against the real committed Conventional sample
(templates/samples/R.334-030-2025.1F_ran.xlsm, the same one
test_fill_b7_legacy_precedence.py drives) confirming today's real template -
where the two dates already agree - produces no spurious warning and the
real cell layout assumed by the fix (F125) is exactly what's read.

Run: python3 engine/test_fill_conventional.py
"""
import os
import sys
import tempfile

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
import fill_conventional as fc  # noqa: E402
from sanral_fill import Workbook  # noqa: E402

TECH = os.path.join(REPO, "templates", "samples", "R.334-030-2025.1F_ran.xlsm")
BASE_PACK = os.path.join(REPO, "packs", "r334-030-2025-1f.yaml")

fails = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        fails.append(name)


def test_mismatched_closing_dates_are_reported():
    print("b7_closing_date_note(): Form B7's own closing date differing from SETUP's is reported")
    notes = fc.b7_closing_date_note("2026-10-29", "2026-11-05")
    check("one note is returned", len(notes) == 1, notes)
    check("the note names both dates", notes and "2026-10-29" in notes[0] and "2026-11-05" in notes[0], notes)


def test_matching_closing_dates_produce_nothing():
    print("b7_closing_date_note(): matching closing dates produce nothing")
    notes = fc.b7_closing_date_note("2026-10-29", "2026-10-29")
    check("no note is returned", notes == [], notes)


def test_real_sample_template_has_the_assumed_f125_cell_and_agrees_with_setup():
    print("fill_conventional: the real committed Conventional sample's own TEND 1X!F125 "
          "is the same closing date SETUP!C3 already holds (the cell this fix assumes exists)")
    wb = Workbook(TECH)
    close = wb.cached("SETUP", "C3")
    b7 = wb.cached(fc.T, "F125")
    check("TEND 1X!F125 holds a real value, not blank", b7 is not None, b7)
    check("today's real sample has no mismatch (both read the same SANRAL-shipped serial)",
          close == b7, (close, b7))


def test_end_to_end_run_against_the_real_sample_produces_no_spurious_warning():
    print("fill_conventional.main(): a real run against the committed sample returns no "
          "Form B7 closing-date note, since the two dates agree on this real template")
    base = yaml.safe_load(open(BASE_PACK))
    work = tempfile.mkdtemp(prefix="b7_closing_date_test_")
    pack_path = os.path.join(work, "pack.yaml")
    yaml.safe_dump(base, open(pack_path, "w"))
    out = os.path.join(work, "out.xlsm")
    notes = fc.main(TECH, pack_path, out, log=None)
    check("no 'Form B7 closing date' note in the real run's own notes",
          not any("Form B7 closing date" in n for n in notes), notes)


def main():
    test_mismatched_closing_dates_are_reported()
    test_matching_closing_dates_produce_nothing()
    test_real_sample_template_has_the_assumed_f125_cell_and_agrees_with_setup()
    test_end_to_end_run_against_the_real_sample_produces_no_spurious_warning()
    print(f"\n{len(fails)} failure(s)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
