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

for bad, label in [("40h", "a string typo"), (True, "a stray YAML boolean"), (-5, "a negative number"),
                   (float("nan"), "a YAML .nan literal"), (float("inf"), "a YAML .inf literal"),
                   (float("-inf"), "a YAML -.inf literal")]:
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

# --- Finding 417: a THIRD (or further) confirmed key person beyond PL/DS1 --
#     used to be silently dropped from suggest()'s own capture skeleton, and
#     outright refused by fill() even when added to the capture file by
#     hand - losing the WHOLE Hours capture for every discipline/category,
#     not just that one position's row, since fill() used to raise before
#     wb.save() ran. The real file's own rows base+1..base+20 are each a
#     live key-person slot (B8/B9 already confirmed above as live formulas
#     reading the tender's own key-person list); rows 10+ are the SAME kind
#     of cell, just empty on this 2-key-person sample - simulated here by
#     writing a real position code into one of those real-but-empty cells,
#     the same shape a tender with a 3rd key person produces on its own
#     shipped file. -----------------------------------------------------

CE_TPL = os.path.join(tmp, "ce_template.xlsm")
wb_ce_src = Workbook(TPL)
wb_ce_src.set_value("Hours Roadworks", "B10", "CE", allow_formula=True)  # category A's 3rd key-person row
wb_ce_src.save(CE_TPL)

check("row_for_position() still finds PL's own row (8) dynamically",
      ffh.row_for_position(Workbook(CE_TPL), "Hours Roadworks", 7, "PL") == 8)
check("row_for_position() still finds DS1's own row (9) dynamically",
      ffh.row_for_position(Workbook(CE_TPL), "Hours Roadworks", 7, "DS1") == 9)
check("row_for_position() finds a THIRD confirmed key person's (CE) own row (10) dynamically",
      ffh.row_for_position(Workbook(CE_TPL), "Hours Roadworks", 7, "CE") == 10)
check("row_for_position() returns None for a position genuinely not on this tender's own sheet",
      ffh.row_for_position(Workbook(CE_TPL), "Hours Roadworks", 7, "ZZ") is None)

pack_ce_path = os.path.join(tmp, "pack_ce.yaml")
yaml.safe_dump(
    {"_provenance": {"contract": "R.334-030-2025.1F"},
     "key_persons": [{"position": "PL", "person": "p1"}, {"position": "DS1", "person": "p2"},
                      {"position": "CE", "person": "p3"}]},
    open(pack_ce_path, "w"),
)
skeleton_ce_path = os.path.join(tmp, "skeleton_ce.yaml")
ffh.suggest(pack_ce_path, skeleton_ce_path)
skeleton = yaml.safe_load(open(skeleton_ce_path))
check("suggest()'s own capture skeleton lists a THIRD confirmed key person (CE), not only PL/DS1",
      "CE" in skeleton["hours"]["Roadworks"]["A"], sorted(skeleton["hours"]["Roadworks"]["A"]))

capture_ce_path = os.path.join(tmp, "capture_ce.yaml")
yaml.safe_dump({"contract": "R.334-030-2025.1F",
               "hours": {"Roadworks": {"A": {"PL": 10, "DS1": 20, "CE": 15}}}},
              open(capture_ce_path, "w"))
out_ce_path = os.path.join(tmp, "out_ce.xlsm")
try:
    log_ce = ffh.fill(CE_TPL, capture_ce_path, out_ce_path)
    check("fill() accepts a capture naming a THIRD confirmed key person (CE) instead of refusing the whole file",
          log_ce is not None and len(log_ce.entries) == 3, len(log_ce.entries) if log_ce else None)
    wb_ce_out = Workbook(out_ce_path)
    check("...and writes CE's hours into its own real row (10), not PL's/DS1's",
          wb_ce_out.cached("Hours Roadworks", "E10") == 15, wb_ce_out.cached("Hours Roadworks", "E10"))
    check("...PL's own row (8) is written correctly too, unaffected by the new CE row",
          wb_ce_out.cached("Hours Roadworks", "E8") == 10, wb_ce_out.cached("Hours Roadworks", "E8"))
    check("...DS1's own row (9) is written correctly too, unaffected by the new CE row",
          wb_ce_out.cached("Hours Roadworks", "E9") == 20, wb_ce_out.cached("Hours Roadworks", "E9"))
except ValueError as e:
    check("fill() accepts a capture naming a THIRD confirmed key person (CE) instead of refusing the whole file",
          False, str(e))

if FAILS:
    print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
    sys.exit(1)
print("\nALL PASSED")
