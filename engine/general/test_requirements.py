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


def check_confidence_scoring():
    """score_confidence() (per-item confidence, Sarel 2026-10-20: "indicate
    the confidence level"). Pure function, no document I/O - checked
    directly against the signals it's documented to use."""
    print("\nscore_confidence(): per-item confidence scoring")

    hi, _ = req.score_confidence("form_edition", 1)
    lo, _ = req.score_confidence("weak_context", 1)
    check("a matched document file (form_edition) scores higher than a vague/weak-context mention",
          hi > lo, f"{hi} vs {lo}")

    exact, _ = req.score_confidence("form_code", 1)
    anchored, _ = req.score_confidence("anchored_regex", 1)
    vague, _ = req.score_confidence("weak_context", 1)
    check("an exact form-number match (form_code) and an anchored-regex match (CIDB/briefing) "
          "both outscore a vague context-only match",
          exact > vague and anchored > vague, f"{exact}/{anchored} vs {vague}")

    one, _ = req.score_confidence("strong_context", 1)
    many, _ = req.score_confidence("strong_context", 5)
    check("several consistent mentions score at least as high as a single ambiguous one",
          many >= one, f"{many} vs {one}")

    clean, _ = req.score_confidence("form_code", 1)
    scanned, reason = req.score_confidence("form_code", 1, ocr_confidence=40)
    check("text read from a poorly-OCR'd page (low mean_confidence) scores lower than the same clean text",
          scanned < clean, f"{scanned} vs {clean}")
    check("the OCR reduction is recorded in the reason string", "OCR" in reason, reason)

    scanned_good, _ = req.score_confidence("form_code", 1, ocr_confidence=95)
    scanned_bad, _ = req.score_confidence("form_code", 1, ocr_confidence=20)
    check("a near-perfect OCR read is discounted less than a poor one",
          scanned_good > scanned_bad, f"{scanned_good} vs {scanned_bad}")

    for kind in req.CONFIDENCE_BASE:
        s, r = req.score_confidence(kind, 1)
        check(f"score_confidence({kind!r}) stays within 0-100", 0 <= s <= 100, str(s))
        check(f"score_confidence({kind!r}) always returns a non-empty reason", bool(r))


def check_manifest_items_carry_confidence():
    """Every extracted item that carries a 'quote' also carries a 0-100
    'confidence' and a non-empty 'confidence_reason' - run against a real,
    varied bundle (a mix of SBD forms, returnables, roles and CIDB/briefing
    text) through the real extract_requirements()."""
    text = """
MBD 1 - INVITATION TO BID
NAME OF BIDDER: ______ VAT REGISTRATION NUMBER: ______ TCS PIN: ______
POSTAL ADDRESS: ______

The bidder must submit a valid CIDB registration, grading 6CE, and a current
tax compliance status (TCS PIN) with this bid. A contracts manager with
relevant experience must be appointed for this project. Attendance of the
compulsory briefing session is mandatory - a certificate of attendance must
be enclosed.
"""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "bundle.txt")
        with open(path, "w") as f:
            f.write(text)
        manifest = req.extract_requirements([path], work_dir=tempfile.mkdtemp(prefix="tt_req_test_"))

    checked_any = False
    for section in ("forms", "returnables", "roles", "person_registrations", "buyer_forms"):
        for item in manifest.get(section) or []:
            if "quote" not in item:
                continue
            checked_any = True
            check(f"{section} item {item.get('key') or item.get('code') or item.get('role_code')} "
                  f"carries a 0-100 confidence", 0 <= item.get("confidence", -1) <= 100, str(item.get("confidence")))
            check(f"{section} item {item.get('key') or item.get('code') or item.get('role_code')} "
                  f"carries a confidence_reason", bool(item.get("confidence_reason")))
    check("at least one quote-carrying item was actually checked above (the fixture produced real items)", checked_any)

    for section in ("cidb", "briefing"):
        item = manifest.get(section)
        if item is None:
            continue
        checked_any = True
        check(f"{section} carries a 0-100 confidence", 0 <= item.get("confidence", -1) <= 100, str(item.get("confidence")))
        check(f"{section} carries a confidence_reason", bool(item.get("confidence_reason")))


def check_past_corrections_feedback():
    """extract_requirements(past_corrections=...) - the honest, non-LLM
    feedback mechanism (see requirements.py's own comment above
    _apply_past_corrections_to_manifest: this module has no LLM call, so a
    past correction nudges a matching item's confidence down with a note;
    it never changes what gets extracted)."""
    print("\npast_corrections: a past admin verdict nudges a matching item's confidence")
    text = "MBD 1 - INVITATION TO BID\nNAME OF BIDDER: ______ VAT REGISTRATION NUMBER: ______\n"

    def _forms_for(past_corrections):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "bundle.txt")
            with open(path, "w") as f:
                f.write(text)
            m = req.extract_requirements([path], work_dir=tempfile.mkdtemp(prefix="tt_req_test_"),
                                         past_corrections=past_corrections)
            return next(f for f in m["forms"] if f["code"] == "1")

    baseline = _forms_for(None)
    false_positive = _forms_for([{"item_type": "forms", "item_snapshot": {"code": "1"}, "verdict": "false_positive"}])
    corrected = _forms_for([{"item_type": "forms", "item_snapshot": {"code": "1"}, "verdict": "corrected"}])
    unrelated = _forms_for([{"item_type": "forms", "item_snapshot": {"code": "9"}, "verdict": "false_positive"}])

    check("a past false_positive verdict on the SAME form code lowers confidence",
          false_positive["confidence"] < baseline["confidence"],
          f"{false_positive['confidence']} vs {baseline['confidence']}")
    check("a past corrected verdict on the SAME form code also lowers confidence, less harshly than a false_positive",
          corrected["confidence"] < baseline["confidence"] and corrected["confidence"] > false_positive["confidence"],
          f"corrected={corrected['confidence']} false_positive={false_positive['confidence']} baseline={baseline['confidence']}")
    check("a past verdict on a DIFFERENT form code does not affect this item",
          unrelated["confidence"] == baseline["confidence"], f"{unrelated['confidence']} vs {baseline['confidence']}")
    check("the nudge is explained in confidence_reason", "platform admin" in false_positive["confidence_reason"])


# --- Finding 44 (2026-10-21, phase-2 real-tender sampling): a contract-
# administration clause ("5. Change Key Personnel on the Service" - one item
# in a list of things needing the buyer's written consent to change DURING
# the contract) was read as a bid-time ask for key personnel. Real document:
# a Passenger Rail Agency tender whose only other text near "key personnel"
# was this same false-positive clause - _key_personnel_gap() used to return
# it as the tender's own gap message, wrongly.

CONTRACT_ADMIN_CLAUSE_ONLY = """
The Service Provider shall not, without the prior written consent of the Employer:
1.   Amend the travel and subsistence arrangements and tariffs of charges;
2.   Deviate from the final programme as per the programme above;
3.   Deviate from the programme (delayed or earlier);
4.   Deviate from or change the Scope of Services;
5.   Change Key Personnel on the Service.
"""

GENUINE_KEY_PERSONNEL_ASK = """
Bidders must submit CVs of key personnel to be assigned to this contract,
showing relevant qualifications and experience.
"""

BOTH = CONTRACT_ADMIN_CLAUSE_ONLY + GENUINE_KEY_PERSONNEL_ASK


def _key_personnel_gap_for(text):
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "bundle.txt")
        with open(path, "w") as f:
            f.write(text)
        m = req.extract_requirements([path], work_dir=tempfile.mkdtemp(prefix="tt_req_test_"))
        return m["gaps"]


def check_key_personnel_false_positive():
    print("Finding 44: 'change key personnel' (contract administration) is not a bid-time ask")
    contract_admin_gaps = _key_personnel_gap_for(CONTRACT_ADMIN_CLAUSE_ONLY)
    check("a document whose ONLY 'key personnel' mention is a change/consent clause gets no key-personnel gap",
          not any("asks for key personnel" in g for g in contract_admin_gaps), contract_admin_gaps)

    both_gaps = _key_personnel_gap_for(BOTH)
    check("a document with BOTH the false-positive clause and a real ask still surfaces the real one",
          any("asks for key personnel" in g and "CVs of key personnel" in g for g in both_gaps), both_gaps)


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

    check_confidence_scoring()
    check_manifest_items_carry_confidence()
    check_past_corrections_feedback()
    check_key_personnel_false_positive()

    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
