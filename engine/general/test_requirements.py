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


# --- Finding 47 (2026-10-21, phase-2 real-tender sampling): "Contract
# Manager"/"Project Manager" preceded by the TENDER'S OWN BUYER NAME is the
# buyer's own named administrator, not a bidder role. Real document: a
# Transnet SOC Ltd tender (ocds-9t57fa-175017, PPA-170758 ELECTRICAL
# SERVICES & MAINTENANCE 1.pdf) - the sentence below is verbatim from that
# real PDF (appears twice there, near-identically), read by hand before this
# fix. The earlier fix attempt (removing "must/shall/required" from the
# shared ROLE_CONTEXT_RE) was tried and rejected first - it silently deleted
# 3 other genuine, already-regression-tested detections elsewhere in this
# corpus - so this is a narrower, buyer-name-aware exclusion instead; see
# docs/specs/QA-Edge-Case-Findings.md for the full evidence trail.

BUYER_OWN_MANAGER_REAL_TEXT = """
Prior to mobilisation, the Contractor shall submit a Project Safety
Compliance File for review and acceptance by the Transnet Contract Manager
and SHEQ Department.
"""

GENUINE_CONTRACT_MANAGER_ASK = """
Bidders must submit the CV and qualifications of their proposed Contract
Manager for this project, showing relevant experience.
"""

BUYER_TEXT_WITH_GENUINE_ASK_TOO = BUYER_OWN_MANAGER_REAL_TEXT + GENUINE_CONTRACT_MANAGER_ASK


def _roles_for(text, buyer=None):
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "bundle.txt")
        with open(path, "w") as f:
            f.write(text)
        m = req.extract_requirements([path], work_dir=tempfile.mkdtemp(prefix="tt_req_test_"), buyer=buyer)
        return [r["role_code"] for r in m["roles"]]


def check_buyers_own_manager_excluded():
    print("Finding 47: '<buyer name> Contract/Project Manager' is the buyer's own agent, not a bidder role")
    check("without a buyer name passed, the real Transnet sentence still matches (unchanged default behaviour)",
          "contractor.contract_manager" in _roles_for(BUYER_OWN_MANAGER_REAL_TEXT))
    check("with the tender's own buyer name passed, the buyer's own 'Transnet Contract Manager' is excluded",
          "contractor.contract_manager" not in _roles_for(BUYER_OWN_MANAGER_REAL_TEXT, buyer="Transnet SOC Ltd"))
    check("a document with BOTH the buyer's-own-agent mention and a genuine ask still surfaces the real one",
          "contractor.contract_manager" in _roles_for(BUYER_TEXT_WITH_GENUINE_ASK_TOO, buyer="Transnet SOC Ltd"))
    check("an unrelated buyer name doesn't coincidentally exclude a genuine ask (negative control)",
          "contractor.contract_manager" in _roles_for(GENUINE_CONTRACT_MANAGER_ASK, buyer="Transnet SOC Ltd"))


def check_unrecognized_format_is_flagged_not_silently_blank():
    print("Finding 112: a document whose saved file has no recognized extension "
          "used to come back silently blank (0 chars, unreadable=None) instead of flagged")
    with tempfile.TemporaryDirectory() as d:
        # download_tender_documents()'s own ".pdf"-if-no-dot-in-last-6-chars
        # heuristic leaves a title like this one saved AS-IS - the trailing
        # ".1" is mistaken for a real extension, same shape as a buyer's own
        # "SBD Forms Part A.1" or "Addendum No.1".
        path = os.path.join(d, "SBD Forms Part A.1")
        with open(path, "wb") as f:
            f.write(b"this would actually be real, readable document bytes in production")
        doc = req.read_document(req.collect_documents([path], d)[0], d)
        check("format is the bogus trailing fragment, not a known type", doc["format"] == "1", doc["format"])
        check("text stays empty", doc["text"] == "")
        check("unreadable is set with a reason naming the format (not left None/silent)",
              bool(doc.get("unreadable")) and "1" in doc["unreadable"], doc.get("unreadable"))

        # A raw image uploaded directly (not wrapped in a .pdf) hits the same
        # fallback branch and must be flagged the same way.
        jpg = os.path.join(d, "scanned_notice.jpg")
        with open(jpg, "wb") as f:
            f.write(b"\xff\xd8\xff\xe0 not real jpeg bytes, format is all that matters here")
        doc2 = req.read_document(req.collect_documents([jpg], d)[0], d)
        check("a raw .jpg is flagged unreadable too", bool(doc2.get("unreadable")), doc2.get("unreadable"))

        # Still the ONLY document -> extract_requirements() must fail loudly
        # (JobRefusal-equivalent at the manifest level: zero readable docs),
        # never silently claim "no standard forms used".
        manifest = req.extract_requirements([path], work_dir=tempfile.mkdtemp(prefix="tt_req_test_"))
        readable = [x for x in manifest["documents"] if x["chars"] > 0 and not x["unreadable"]]
        check("the manifest carries zero readable documents for this case", readable == [])
        check("the manifest's own document entry says why, not just 'no text found'",
              "not a format this can read" in (manifest["documents"][0].get("unreadable") or ""),
              manifest["documents"][0].get("unreadable"))


# Finding 42's own is_combined_bulletin()/BULLETIN_ROW_RE/find_person_registrations()
# never had a single dedicated test anywhere in the repo (confirmed by grep before
# writing this) despite both being real, confirmed-important fixes with real-world
# evidence cited in their own code comments. QA pass, 2026-11-06: re-checked both
# against every real sample document in templates/general_samples/ directly - zero
# false positives/negatives found there, so these are coverage additions using real,
# verbatim-quoted text from that same corpus, not new bug fixes.

# Verbatim (row 1-3, trimmed) from the real combined bulletin this detection exists
# for - templates/general_samples/tshwane_gpm08_bulletin/Notice 6 of 2026-27.pdf.
REAL_BULLETIN_EXCERPT = """
1.    HD 03 -          Tender for the supply of      30 November     Not applicable      Not applicable           80/20


2.    HD 06 -          Tender for the supply,        30 November     Not applicable      Not applicable           80/


3.   GFS 04 -         Tender for the                27 November                         Compulsory briefing           8
"""


def check_combined_bulletin_detection():
    print("Finding 42: is_combined_bulletin() - a real multi-tender bulletin is detected, a single tender's own text is not")
    check("the real bulletin excerpt (3 rows) is detected as a combined bulletin",
          req.is_combined_bulletin(REAL_BULLETIN_EXCERPT))
    # Boundary: BULLETIN_MIN_ROWS is 3 - exactly 2 of the same real rows must NOT trigger it.
    two_rows = "\n".join(REAL_BULLETIN_EXCERPT.strip().split("\n\n\n")[:1]) + "\n2.    HD 06 -  Tender for the supply, 30 November"
    check("only 2 bulletin-shaped rows (below the threshold of 3) is not flagged",
          not req.is_combined_bulletin(two_rows), req.BULLETIN_ROW_RE.findall(two_rows))
    check("an empty/None text is not flagged (no crash either)", not req.is_combined_bulletin(None))
    check("a real single tender's own ordinary text (TN051's PSIRA clause) is not flagged",
          not req.is_combined_bulletin(PSIRA_REAL_TEXT))


# Verbatim from the real tender this registration check exists for - a Dawid
# Kruiper Municipality security-services tender (templates/general_samples/
# dawid_kruiper_tn051/TN051.pdf).
PSIRA_REAL_TEXT = (
    "5.1 The Security Company who render the Security Services must be registered with "
    "PSIRA (Private Security Industry Regulation). Proof of registration must be "
    "submitted with the tender (Copy of PSIRA Certificate). If no proof"
)
# GLOSSARY_LINE_RE's own documented example shape (Treasury RT83's abbreviations list) -
# a body named only in a glossary, nobody is actually asked to hold it.
GLOSSARY_ONLY_TEXT = "Pr.CPM   Professional Construction Project Manager\nPSIRA    Private Security Industry Regulatory Authority"


def check_person_registration_detection():
    print("find_person_registrations(): a real registration requirement is detected; a glossary-only mention is not")
    out = req.find_person_registrations([{"name": "TN051.pdf", "text": PSIRA_REAL_TEXT}])
    bodies = [o["body"] for o in out]
    check("the real PSIRA requirement is detected", "PSIRA" in bodies, bodies)
    out2 = req.find_person_registrations([{"name": "glossary.pdf", "text": GLOSSARY_ONLY_TEXT}])
    check("a body named only in a glossary/abbreviations list is not reported as a real requirement",
          out2 == [], out2)
    # Both in the same document: the real ask must still surface despite the glossary noise.
    combined = GLOSSARY_ONLY_TEXT + "\n\n" + PSIRA_REAL_TEXT
    out3 = req.find_person_registrations([{"name": "both.pdf", "text": combined}])
    check("a real ask elsewhere in the same document still surfaces despite nearby glossary noise",
          "PSIRA" in [o["body"] for o in out3], out3)


def check_zip_decompression_bomb_is_capped():
    print("Standing review (2026-11-03): a zip whose own header lies about how much it "
          "decompresses to must not be trusted - collect_documents() must cap extraction, "
          "not fill the worker's disk")
    import zipfile
    with tempfile.TemporaryDirectory() as d:
        # Per-member cap: a single entry that decompresses past the 300MB guard.
        big_zip = os.path.join(d, "big.zip")
        with zipfile.ZipFile(big_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            zi = zipfile.ZipInfo("evil.docx")
            zi.compress_type = zipfile.ZIP_DEFLATED
            with z.open(zi, "w") as f:
                chunk = b"\x00" * (1024 * 1024)
                for _ in range(301):  # 301MB, 1MB over the per-member cap
                    f.write(chunk)
        extract_dir = os.path.join(d, "extract1")
        os.makedirs(extract_dir)
        docs = req.collect_documents([big_zip], extract_dir)
        check("the oversized member is not extracted - zip comes back as one 'unreadable' entry",
              len(docs) == 1 and docs[0]["format"] == "zip" and bool(docs[0].get("unreadable")), docs)
        written = sum(os.path.getsize(os.path.join(r, f))
                      for r, _, fs in os.walk(extract_dir) for f in fs)
        check("nothing from the oversized member was left on disk", written == 0, written)

        # Total-across-members cap: many entries, each under the per-member cap on
        # its own, that together exceed the 1GB total guard - the "many small
        # entries" bomb shape, not just one giant one.
        many_zip = os.path.join(d, "many.zip")
        with zipfile.ZipFile(many_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            chunk = b"\x00" * (1024 * 1024)
            for i in range(9):  # 9 x 150MB = 1.35GB total, each well under the per-member cap
                zi = zipfile.ZipInfo(f"part{i}.bin")
                zi.compress_type = zipfile.ZIP_DEFLATED
                with z.open(zi, "w") as f:
                    for _ in range(150):
                        f.write(chunk)
        extract_dir2 = os.path.join(d, "extract2")
        os.makedirs(extract_dir2)
        docs2 = req.collect_documents([many_zip], extract_dir2)
        written2 = sum(os.path.getsize(os.path.join(r, f))
                       for r, _, fs in os.walk(extract_dir2) for f in fs)
        check("the total guard stops extraction before the full 1.35GB lands on disk",
              written2 < 1024 * 1024 * 1024, written2)
        check("the zip itself is flagged unreadable once the total guard trips",
              any(x.get("format") == "zip" and x.get("unreadable") for x in docs2), docs2)

        # A genuinely small, ordinary zip must still extract normally - the guard
        # must not false-positive on a real document.
        small_zip = os.path.join(d, "small.zip")
        with zipfile.ZipFile(small_zip, "w") as z:
            z.writestr("notice.txt", "a perfectly ordinary tender notice")
        extract_dir3 = os.path.join(d, "extract3")
        os.makedirs(extract_dir3)
        docs3 = req.collect_documents([small_zip], extract_dir3)
        check("an ordinary small zip still extracts its real member, unaffected by the guard",
              len(docs3) == 1 and docs3[0]["format"] == "txt" and not docs3[0].get("unreadable"), docs3)


def check_cidb_grade_phrasing_is_detected_not_just_grading():
    """Finding 143 (2026-11-07): assess_tender.CIDB_RE's own "GRADING?" only
    ever made the trailing "G" optional ("GRADIN"/"GRADING") - it could never
    match the equally common "CIDB Grade X" phrasing (confirmed live:
    standard South African procurement wording, used interchangeably with
    "CIDB Grading of X"). A tender naming its requirement this way read as
    having none at all - requirements.py's own manifest never set "cidb",
    so the non-SANRAL pack's submission plan never raised the CIDB
    returnable step either."""
    print("\nCIDB requirement detection: 'CIDB Grade X' is caught, not just 'CIDB Grading of X'")
    for phrasing in ("The bidder must hold a CIDB Grading of at least 6CE for this contract.",
                     "The bidder must hold a CIDB Grade 6CE for this contract.",
                     "A CIDB Contractor Grading of 9CE is required.",
                     "A CIDB Contractor Grade 9CE is required."):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "bundle.txt")
            with open(path, "w") as f:
                f.write(phrasing)
            manifest = req.extract_requirements([path], work_dir=tempfile.mkdtemp(prefix="tt_req_test_"))
        cidb = manifest.get("cidb")
        check(f"{phrasing!r} -> manifest['cidb'] is set", cidb is not None, manifest.get("cidb"))
        if cidb:
            check(f"{phrasing!r} -> the right grading was read",
                  cidb["grading"] in ("6CE", "9CE"), cidb["grading"])


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
    check_buyers_own_manager_excluded()
    check_unrecognized_format_is_flagged_not_silently_blank()
    check_combined_bulletin_detection()
    check_person_registration_detection()
    check_zip_decompression_bomb_is_capped()
    check_cidb_grade_phrasing_is_detected_not_just_grading()

    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
