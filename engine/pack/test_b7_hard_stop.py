"""
Regression test for Finding 362 (standing QA/robustness review, 2026-11-10):
build_submission_pack() - its own header docstring, and process_pack_jobs.py's
("a pack job hard-stops when Form B7 applies and the company hasn't answered
it") - both documented a hard stop that didn't exist. The `if b7_plan:` guard
around the Form B7 check meant a company that gave NO answer at all (as
opposed to one that gave an invalid answer) sailed straight through: the pack
still built to "ready", fired the "Bid Pack Compilation Complete" email, and
the only trace was one line buried in manifest["warnings"].

Live-reproduced (pre-fix) against the real committed R.343-020-2025.1F sample
(category 3, Form B7 required for every tenderer size per its own SETUP
sheet) and complete_co (QSE, config/test_companies/complete_co.json) with no
subcontracting plan at all: outcome was "built", not "refused". Confirmed via
harness_pack.run_pack_one(), the same real SANRAL chain a production pack job
drives (suggest_pack -> confirm_pack -> generate_cv -> build_submission_pack).

Run: python3 engine/pack/test_b7_hard_stop.py
"""
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import harness_pack  # noqa: E402

COMPLETE_CO = os.path.join(REPO, "config", "test_companies", "complete_co.json")

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def main():
    work = tempfile.mkdtemp(prefix="b7_hard_stop_")
    try:
        # Category 3 (R.343-020-2025.1F): required for EME/QSE/Generic alike.
        # complete_co (QSE) gives no subcontracting plan at all (the harness's
        # own TENDER_B7 dict only answers for R.396-010-2025.1F) - Form B7
        # applies and is unanswered.
        result = harness_pack.run_pack_one(COMPLETE_CO, "R.343-020-2025.1F", os.path.join(work, "required"))
        check("a required-but-unanswered Form B7 refuses the pack, not builds it",
              result["outcome"] == "refused", result)
        if result["outcome"] == "refused":
            check("...naming build_submission_pack as the stage", result["stage"] == "build_submission_pack", result)
            check("...naming the real reason (applies, unanswered)",
                  "Form B7" in result["reason"] and "hasn't been answered" in result["reason"], result["reason"])

        # Category 2 (R.334-030-2025.1F): NOT required for a QSE tenderer
        # (required_by_size: QSE False) - no plan needed, must still build.
        # Same company as above (complete_co) so a real, unrelated data gap
        # (e.g. a missing ECSA registration on a different test company)
        # can't be mistaken for this fix over-blocking.
        result2 = harness_pack.run_pack_one(COMPLETE_CO, "R.334-030-2025.1F", os.path.join(work, "not_required"))
        check("a not-required tender with no Form B7 answer still builds (no over-blocking regression)",
              result2["outcome"] == "built", result2 if result2["outcome"] != "built" else "")
    finally:
        shutil.rmtree(work, ignore_errors=True)

    if FAILS:
        print(f"\n{len(FAILS)} failure(s): {FAILS}")
        sys.exit(1)
    print("\n0 failure(s)")


if __name__ == "__main__":
    main()
