"""
Form B7 (Targeted Enterprise subcontracting) - engine/sanral_b7.py against the
committed real SANRAL templates (templates/samples/). No network, no DB.

1. read_setup() reads each sample's own category and SANRAL's matrix from its
   SETUP sheet (R.334-030-2025/1F is category 2; the other five category 3).
2. applicability() follows that matrix for every tenderer size, and asks
   (status "unknown", needs a plan) when the category or size is missing.
3. fill_b7() writes a plan into the real template exactly the way Klipcorp's
   own completed SANRAL submission holds it (percentages as fractions, the
   "Number of Targeted Enterprise" form control moved to the right option),
   across all four Targeted Enterprise blocks, and refuses an invalid plan.

Usage: python3 engine/test_sanral_b7.py
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sanral_b7  # noqa: E402
from sanral_fill import Workbook  # noqa: E402

SAMPLES = os.path.join(HERE, "..", "templates", "samples")
EXPECTED_CATEGORY = {"R.334-030-2025.1F": 2, "R.343-020-2025.1F": 3, "R.352-020-2025.1F": 3,
                     "R.352-030-2025.1F": 3, "R.394-010-2025.1F": 3, "R.396-010-2025.1F": 3}
POLICY = {1: {"EME": False, "QSE": True, "GENERIC": True},
          2: {"EME": False, "QSE": False, "GENERIC": True},
          3: {"EME": True, "QSE": True, "GENERIC": True}}

fails = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        fails.append(msg)


print("1. category + matrix from each sample's SETUP sheet")
for slug, cat in EXPECTED_CATEGORY.items():
    setup = sanral_b7.read_setup(Workbook(os.path.join(SAMPLES, f"{slug}_ran.xlsm")))
    check(setup["category"] == cat and setup["required_by_size"] == POLICY[cat],
          f"{slug}: category {setup['category']}, by size {setup['required_by_size']}")

print("2. applicability")
for cat, rules in POLICY.items():
    setup = {"category": cat, "required_by_size": rules}
    for size, req in rules.items():
        a = sanral_b7.applicability(setup, size.title() if size == "GENERIC" else size)
        check(a["status"] == ("required" if req else "not_required") and a["needs_plan"] == req,
              f"category {cat}, {size}: {a['status']}")
check(sanral_b7.applicability(None, "QSE")["status"] == "unknown", "workbook not read -> unknown, needs a plan")
check(sanral_b7.applicability({"category": 3, "required_by_size": POLICY[3]}, "")["needs_plan"],
      "company size not recorded -> needs a plan")
w = sanral_b7.applicability({"category": 3, "required_by_size": POLICY[3]}, "QSE",
                            {"mode": "waived_by_tender", "waiver_quote": "No sub-contracting requirement"})
check(w["status"] == "waived" and not w["needs_plan"] and "No sub-contracting requirement" in w["reason"],
      "Book 1 waiver recorded by the company -> waived, quote in the reason")

print("3. fill_b7 into the real R.334 template")
# Klipcorp's real completed RRM submission (WCP V2 Batch 2B, templates/incoming/
# completed_sample, not committed): 1 TE "Will be identified ... after tender
# award", EME, 30% / 30%, 100% black owned, level 1 -> D3904=2, M3906=0.3,
# D3908=1, H3908=1, M3908=0.3. Same plan here, plus three named TEs.
te = lambda **k: dict({"name": "Named TE", "to_be_identified": False, "size": "EME", "pct_of_contract": 10,
                       "pct_excl_provisional": 10, "black_ownership_pct": 100, "bee_level": 1,
                       "head_office": None, "in_project_province": None, "consulting_engineering_firm": None,
                       "tax_reference": None}, **k)
tpl = os.path.join(SAMPLES, "R.334-030-2025.1F_ran.xlsm")
with tempfile.TemporaryDirectory() as tmp:
    wb = Workbook(tpl)
    plan = {"mode": "subcontract", "comments": "Scope: drainage design support",
            "targeted_enterprises": [te(to_be_identified=True, pct_of_contract=30, pct_excl_provisional=30),
                                     te(name="Mpilo Consulting (Pty) Ltd", size="QSE", black_ownership_pct=51,
                                        bee_level=2, head_office="12 Main Rd, Ladysmith, 036 000 0000",
                                        in_project_province="YES", consulting_engineering_firm="YES",
                                        tax_reference="9000000000"),
                                     te(name="TE Three"), te(name="TE Four", in_project_province="NO")]}
    n = sanral_b7.fill_b7(wb, plan)
    out = os.path.join(tmp, "filled.xlsm")
    wb.save(out)
    r = Workbook(out)
    T = "TEND 1X"
    check(n == 4 and r.cached(T, "D3904") == 5, f"count control D3904 = {r.cached(T, 'D3904')} ('4 Targeted Enterprise')")
    ctrl = r.controls[T]["D3904"][0][0]
    check(' sel="5"' in r.files[ctrl].decode(), "form control's own selection moved to option 5")
    check(r.cached(T, "C3906") == sanral_b7.TBC_NAME and r.cached(T, "J3906") == "EME"
          and r.cached(T, "M3906") == 0.3 and r.cached(T, "D3908") == 1 and r.cached(T, "H3908") == 1
          and r.cached(T, "M3908") == 0.3, "TE 1 written exactly as Klipcorp's real filled workbook holds it")
    check(r.cached(T, "C3914") == "Mpilo Consulting (Pty) Ltd" and r.cached(T, "J3914") == "QSE"
          and r.cached(T, "D3916") == 0.51 and r.cached(T, "H3916") == 2 and r.cached(T, "M3916") == 0.1
          and r.cached(T, "G3918") == "YES" and r.cached(T, "J3918") == "YES" and r.cached(T, "M3918") == "9000000000"
          and r.cached(T, "C3918").startswith("12 Main Rd"), "TE 2 block (rows 3914-3918) incl. province / firm / tax")
    check(r.cached(T, "C3922") == "TE Three" and r.cached(T, "C3930") == "TE Four" and r.cached(T, "G3934") == "NO",
          "TE 3 and 4 blocks (rows 3922, 3930)")
    check(r.cached(T, "B3940") == "Scope: drainage design support", "comments B3940")
    check(r.cached(T, "G3937") is not None, "the template's own local-share formula is untouched")

    errors, warnings = sanral_b7.check_plan(plan, {"needs_plan": True})
    check(not errors and any("not named yet" in x for x in warnings), "TBC Targeted Enterprise -> warning, not error")
    for bad, why in ((dict(plan, targeted_enterprises=[]), "no TE"),
                     (dict(plan, targeted_enterprises=[te()] * 5), "five TEs"),
                     (dict(plan, targeted_enterprises=[te(size="GENERIC")]), "a Generic TE"),
                     (dict(plan, targeted_enterprises=[te(pct_excl_provisional=0)]), "0%"),
                     (dict(plan, targeted_enterprises=[te(bee_level=9)]), "level 9")):
        try:
            sanral_b7.fill_b7(Workbook(tpl), bad)
            check(False, f"invalid plan ({why}) refused")
        except ValueError:
            check(True, f"invalid plan ({why}) refused")
    e, w = sanral_b7.check_plan({"mode": "subcontract", "targeted_enterprises": [te(name="A", pct_excl_provisional=20, pct_of_contract=20)]},
                                {"needs_plan": True})
    check(not e and any("below SANRAL's 30% minimum" in x for x in w), "20% total -> below-minimum warning")

print("ALL PASSED" if not fails else f"{len(fails)} FAILED")
sys.exit(1 if fails else 0)
