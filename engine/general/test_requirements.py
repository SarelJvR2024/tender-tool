"""
Regression test for extract_requirements()'s MBD/SBD suite-decision logic
(Finding 29, QA-Edge-Case-Findings.md "thirty-fourth run", `4a2d20f`).

No dedicated test existed for this bug when it was found and fixed - the
fix's own commit only ran the 6 cases below by hand against the real CLI,
with nothing persisted to catch a future regression, and the commit itself
notes none of general_harness.py's 9 real samples exercise this mixed-suite
shape. This file closes that gap.

Each case is a real .txt document set run through the real extract_requirements()
(no LibreOffice needed - .txt is a supported format), asserting only on the
resulting suite label, matching Finding 29's own verification method.

Run: python3 engine/general/test_requirements.py
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import requirements as req  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _suite_for(text):
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "bundle.txt")
        with open(path, "w") as f:
            f.write(text)
        manifest = req.extract_requirements([path], work_dir=tempfile.mkdtemp(prefix="tt_req_test_"))
        return manifest["form_suite"]


# 10 real MBD mentions (municipal forms a bidder would actually see) plus one
# boilerplate cross-reference to the National Treasury SBD 4 guideline -
# exactly Finding 29's own adversarial fixture.
MBD_DOMINANT_WITH_STRAY_SBD = """
MBD 1 - INVITATION TO BID
MBD 4 - DECLARATION OF INTEREST
MBD 6.1 - PREFERENCE POINTS CLAIM FORM
MBD 7 - CONTRACT FORM
MBD 8 - DECLARATION OF BIDDER'S PAST SCM PRACTICES
MBD 9 - CERTIFICATE OF INDEPENDENT BID DETERMINATION
MBD 1 again referenced in the covering letter
MBD 4 referenced again in the checklist
MBD 6.1 referenced again in the scoring annexure
MBD 7 referenced again in the signature page

Annexure F - bidders may also consult the National Treasury's SBD 4
guideline on www.treasury.gov.za for reference purposes only.
"""

SBD_DOMINANT_WITH_STRAY_MBD = """
SBD 1 - INVITATION TO BID
SBD 4 - DECLARATION OF INTEREST
SBD 6.1 - PREFERENCE POINTS CLAIM FORM
SBD 7 - CONTRACT FORM
SBD 8 - DECLARATION OF BIDDER'S PAST SCM PRACTICES
SBD 9 - CERTIFICATE OF INDEPENDENT BID DETERMINATION
SBD 1 again referenced in the covering letter
SBD 4 referenced again in the checklist
SBD 6.1 referenced again in the scoring annexure
SBD 7 referenced again in the signature page

Annexure F - municipalities using the MFMA twin form set may also consult
MBD 4 for reference purposes only.
"""

MBD_ONLY = "MBD 1 - INVITATION TO BID\nMBD 4 - DECLARATION OF INTEREST\n"
SBD_ONLY = "SBD 1 - INVITATION TO BID\nSBD 4 - DECLARATION OF INTEREST\n"
NEITHER = "This is a plain cover letter with no standard bid documents named at all.\n"
TIE = "MBD 1 - INVITATION TO BID\nSBD 1 - INVITATION TO BID\n"


def main():
    print("Finding 29: MBD/SBD suite decided by majority of real mentions, not mere presence")
    check("10 real MBD mentions + 1 stray SBD reference -> MBD (the bug itself: this used to come back SBD)",
          _suite_for(MBD_DOMINANT_WITH_STRAY_SBD) == "MBD")
    check("mirror case: 10 real SBD mentions + 1 stray MBD reference -> still SBD",
          _suite_for(SBD_DOMINANT_WITH_STRAY_MBD) == "SBD")
    check("MBD-only bundle -> MBD", _suite_for(MBD_ONLY) == "MBD")
    check("SBD-only bundle -> SBD", _suite_for(SBD_ONLY) == "SBD")
    check("no standard forms mentioned at all -> None", _suite_for(NEITHER) is None)
    check("a genuine tie still defaults to SBD (unchanged from the old default)", _suite_for(TIE) == "SBD")
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
