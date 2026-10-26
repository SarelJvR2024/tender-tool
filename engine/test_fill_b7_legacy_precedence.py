"""
Regression test for fill_tender.py's and fill_conventional.py's Form B7
precedence: an EXPLICIT subcontracting_plan (sanral_b7.py, Tender Workspace)
must always win over the legacy, hand-written `targeted_enterprise` block a
pre-Tender-Workspace pack.yaml can still carry - whatever the plan's own
mode, not just "subcontract".

Finding 81 (2026-10-26): both fillers only checked `mode == "subcontract"`
before falling back to the legacy block (`elif te:`), so a company that
later captured an explicit "waived_by_tender" answer (Book 1 says B7 isn't
required) still got the STALE legacy Targeted Enterprise written into the
real submitted workbook - a false subcontracting declaration contradicting
the company's own, more authoritative answer. assemble_pack.py's own
b7_filled bookkeeping already assumed the correct precedence
(`bool(legacy_te) and not b7_plan`); the fillers' actual cell-writing code
didn't enforce it. No dedicated test existed for either filler's Form B7
branch before this (confirmed by grep).

Drives fill_conventional.py directly against a real committed SANRAL sample
(templates/samples/R.334-030-2025.1F_ran.xlsm) - no RRM-family sample
workbook is committed to this repo to drive fill_tender.py the same way, so
its identical fix is covered by direct code inspection + the same manual
repro used to confirm this one, not a second end-to-end test.

Run: python3 engine/test_fill_b7_legacy_precedence.py
"""
import os
import sys
import tempfile

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
import fill_conventional  # noqa: E402
from sanral_fill import Workbook  # noqa: E402

TECH = os.path.join(REPO, "templates", "samples", "R.334-030-2025.1F_ran.xlsm")
BASE_PACK = os.path.join(REPO, "packs", "r334-030-2025-1f.yaml")

LEGACY_TE = {"name": "Stale Legacy TE (Pty) Ltd", "status": "EME", "pct_of_contract": 0.3,
             "black_ownership": 1.0, "bee_level": 1, "pct_excl_provisional": 0.3}
WAIVED_PLAN = {"mode": "waived_by_tender", "waiver_quote": "Book 1 says B7 not required", "targeted_enterprises": []}
SUBCONTRACT_PLAN = {"mode": "subcontract", "waiver_quote": None, "targeted_enterprises": [
    {"name": "New Co", "size": "EME", "pct_of_contract": 30, "pct_excl_provisional": 30,
     "black_ownership_pct": 100, "bee_level": 1, "in_project_province": "YES"}]}

fails = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        fails.append(name)


def _te_name_cell(tender):
    base = yaml.safe_load(open(BASE_PACK))
    pack = dict(base, tender=tender)
    work = tempfile.mkdtemp(prefix="b7_precedence_test_")
    pack_path = os.path.join(work, "pack.yaml")
    yaml.safe_dump(pack, open(pack_path, "w"))
    out = os.path.join(work, "out.xlsm")
    fill_conventional.main(TECH, pack_path, out, log=None)
    return Workbook(out).cached("TEND 1X", "C3906")


def test_explicit_waiver_overrides_the_stale_legacy_block():
    print("fill_conventional: a legacy targeted_enterprise block AND an explicit "
          "waived_by_tender plan both present - the explicit waiver must win")
    cell = _te_name_cell({"targeted_enterprise": LEGACY_TE, "subcontracting_plan": WAIVED_PLAN})
    check("TEND 1X!C3906 (Targeted Enterprise name) stays blank, not the stale legacy name",
          cell is None, cell)


def test_legacy_block_still_fills_when_there_is_no_explicit_plan_at_all():
    print("fill_conventional: a legacy targeted_enterprise block with no subcontracting_plan "
          "at all - back-compat for an old, pre-Tender-Workspace pack.yaml")
    cell = _te_name_cell({"targeted_enterprise": LEGACY_TE})
    check("TEND 1X!C3906 is filled from the legacy block", cell == LEGACY_TE["name"], cell)


def test_explicit_subcontract_plan_still_fills_normally():
    print("fill_conventional: an explicit subcontract plan with no legacy block at all - "
          "the ordinary, current-day path")
    cell = _te_name_cell({"subcontracting_plan": SUBCONTRACT_PLAN})
    check("TEND 1X!C3906 is filled from the new plan's own Targeted Enterprise",
          cell == "New Co", cell)


def test_neither_present_stays_blank():
    print("fill_conventional: no legacy block and no plan - Form B7 stays exactly as SANRAL shipped it")
    cell = _te_name_cell({})
    check("TEND 1X!C3906 stays blank", cell is None, cell)


def main():
    test_explicit_waiver_overrides_the_stale_legacy_block()
    test_legacy_block_still_fills_when_there_is_no_explicit_plan_at_all()
    test_explicit_subcontract_plan_still_fills_normally()
    test_neither_present_stays_blank()
    print(f"\n{len(fails)} failure(s)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
