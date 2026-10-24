"""
Regression test for fill_financial_hours.py - this module had NO dedicated
test at all before this pass (confirmed: no test_fill_financial_hours.py
existed anywhere in the repo), despite writing directly into the one part
of a real SANRAL Financial Submission workbook that feeds a scored
evaluation form (FORM C2.4 FIN / Workplan Appropriateness, 30 of 100 points)
and the tendered fee itself (SUMMARY TENDERED FEE rolls up from here).

Finding, 2026-10-24: fill()'s own "refuse while null" rule (see this
module's docstring) only ever checked `hours is None` - a capture.yaml value
that is anything else (a string typo like "40h", a stray YAML boolean, a
negative number) sailed straight into Workbook.set_value() with no
validation at all. Confirmed against the real fixture
(templates/samples/financial/R.334-030-2025.1F_Financial_Submission_ran.xlsm)
that this is not cosmetic: "Hours Roadworks"!E8 (Category A, PL) has no
formula (the real, intended input cell) but "Hours Roadworks"!G8 computes
`ROUND(F8*E8, 2)` - a plain arithmetic formula directly over whatever this
module writes to E8. A string value writes as an Excel inlineStr cell with
no error raised anywhere in the pipeline, corrupting that formula's input
on a document that gets submitted to SANRAL.

Run: python3 engine/test_fill_financial_hours.py
"""
import os
import sys
import tempfile

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
import fill_financial_hours as ffh  # noqa: E402
from sanral_fill import Workbook  # noqa: E402
import sanral_fill as sf  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


TPL = os.path.join(REPO, "templates", "samples", "financial", "R.334-030-2025.1F_Financial_Submission_ran.xlsm")
tmp = tempfile.mkdtemp(prefix="tt_ffh_test_")


def _fill(hours_a_pl, hours_a_ds1=20):
    capture_path = os.path.join(tmp, f"capture_{len(os.listdir(tmp))}.yaml")
    out_path = os.path.join(tmp, f"out_{len(os.listdir(tmp))}.xlsm")
    capture = {"contract": "R.334-030-2025.1F",
               "hours": {"Roadworks": {"A": {"PL": hours_a_pl, "DS1": hours_a_ds1}}}}
    yaml.safe_dump(capture, open(capture_path, "w"))
    return ffh.fill(TPL, capture_path, out_path), out_path


# --- the real workbook's own layout, confirmed directly (not assumed) -----

wb = Workbook(TPL)
e8 = wb._cell_el("Hours Roadworks", "E8")
g8 = wb._cell_el("Hours Roadworks", "G8")
check("E8 (Category A, PL) is the real unlocked input cell - no formula",
      e8.find("m:f", sf.N) is None)
check("G8 (Category A, PL amount) is a real formula reading E8 - confirms E8 isn't cosmetic",
      g8.find("m:f", sf.N) is not None and "E8" in g8.find("m:f", sf.N).text,
      g8.find("m:f", sf.N).text if g8.find("m:f", sf.N) is not None else None)

# --- the bug: a non-numeric/boolean/negative hours value used to sail ------
#     straight through with no error, silently corrupting a real formula ---
#     input on a real SANRAL financial submission -----------------------

for bad, label in [("40h", "a string typo"), (True, "a stray YAML boolean"), (-5, "a negative number")]:
    try:
        _fill(bad)
        check(f"a non-numeric/invalid hours value ({label}: {bad!r}) is refused, not silently written",
              False, f"fill() returned with no error for {bad!r}")
    except ValueError as e:
        check(f"a non-numeric/invalid hours value ({label}: {bad!r}) is refused, not silently written",
              True)
        check(f"...and the error names the field and the bad value, not a generic message ({label})",
              "Roadworks/A/PL" in str(e) and repr(bad) in str(e), str(e))

# --- valid values still work: real numbers, zero, and floats are not ------
#     caught by the new guard --------------------------------------------

log, out_path = _fill(40, 0)
check("a real positive int hours value is accepted and written", log is not None and len(log.entries) == 2)
wb2 = Workbook(out_path)
check("the written cell holds the real number, not a string",
      wb2.cached("Hours Roadworks", "E8") == 40, wb2.cached("Hours Roadworks", "E8"))
check("0 hours (explicitly tendered, distinct from null/not-yet-supplied) is accepted, not treated as missing",
      wb2.cached("Hours Roadworks", "E9") == 0, wb2.cached("Hours Roadworks", "E9"))

log, out_path = _fill(37.5)
check("a float hours value is accepted and written", log is not None and len(log.entries) == 2)

# --- null is still "not yet supplied", not a validation error -------------

try:
    _fill(None)
    check("a null hours value is refused as 'missing', not silently passed through", False)
except ValueError as e:
    check("a null hours value is refused as 'missing', not silently passed through",
          "still null" in str(e), str(e))

if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
    sys.exit(1)
print("\nALL PASSED")
