"""
Focused tests for classify_tender.py's classify_documents() - specifically its
.docx branch, which had no dedicated test file before this (test_manual_intake.py
needs Postgres so it isn't in CI; it also only covers the happy path end to end).

Finding (2026-10-20, thirty-fifth run, docs/specs/QA-Edge-Case-Findings.md): the
.xlsm branch already logs a note when a workbook can't be opened ("unreadable" ->
notes.append(...)), but the parallel .docx branch's `except Exception: continue`
silently dropped a corrupt/mislabeled SANRAL .docx form with no trace at all. The
downstream "missing documents" message then told the user the document was simply
"not found" even though they HAD uploaded it - it just couldn't be read. Fixed by
logging a note in the .docx branch's exception handler too, mirroring the .xlsm
branch's existing pattern.

Run: python3 engine/intake/test_classify_tender.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import classify_tender as ct  # noqa: E402
import docx  # noqa: E402

FAILS = []

# A real Technical Submission workbook, so classify_documents() actually
# routes "sanral" (the route the .docx tests below need to exercise
# sanral_files/sanral_documents - those are deliberately {}/[] on the
# general route, by design, when no workbook is present at all).
TECH_WORKBOOK = os.path.join(os.path.dirname(HERE), "..", "templates", "samples", "R.352-020-2025.1F_ran.xlsm")


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _doc_entry(name, local, fmt="docx"):
    return {"name": name, "format": fmt, "_local": local, "unreadable": None}


def test_corrupt_docx_is_noted_not_silently_dropped(tmp_path="/tmp"):
    print("classify_documents: a corrupt/garbage .docx SANRAL form")
    path = os.path.join(tmp_path, "C.1.1.1 Form of Offer (corrupt).docx")
    with open(path, "wb") as f:
        f.write(b"not really a docx, just garbage bytes")
    decision = ct.classify_documents([_doc_entry("C.1.1.1 Form of Offer (corrupt).docx", path)],
                                      buyer="SANRAL", all_text="SANRAL tender")
    check("a note is logged for the unreadable .docx (not silently dropped)",
          any("C.1.1.1 Form of Offer (corrupt).docx" in n and "could not be opened" in n
              for n in decision["notes"]), decision["notes"])
    check("it is not registered as a found SANRAL file",
          "c111_form_of_offer" not in decision["sanral_files"])
    os.remove(path)


def test_valid_docx_is_classified_with_no_spurious_note(tmp_path="/tmp"):
    print("classify_documents: a real, readable C.1.1.1 Form of Offer .docx")
    path = os.path.join(tmp_path, "C.1.1.1 Form of Offer.docx")
    d = docx.Document()
    d.add_paragraph("C1.1.1 FORM OF OFFER (Incorporating SBD7)")
    d.save(path)
    decision = ct.classify_documents([_doc_entry("C.1.1.1 Form of Offer.docx", path)],
                                      buyer="SANRAL", all_text="SANRAL tender")
    check("no note is logged for a readable docx that matched", decision["notes"] == [], decision["notes"])
    os.remove(path)


def test_period_after_the_form_letter_is_also_recognized(tmp_path="/tmp"):
    print("classify_documents: a real C.1.1.1 Form of Offer whose IN-DOCUMENT heading has a "
          "period after the letter (\"C.1.1.1\", not \"C1.1.1\")")
    # QA audit 2026-10-20 ("enterprise readiness" pass): the two tests above
    # both use "C.1.1.1" in the FILENAME but "C1.1.1" (no period) in the
    # in-document heading text - the exact mismatch that let the period-in-
    # heading case go untested while SANRAL_DOCX's regexes silently failed
    # on it. This test exercises the heading text itself, not just the name.
    path = os.path.join(tmp_path, "Form of Offer - period heading.docx")
    d = docx.Document()
    d.add_paragraph("C.1.1.1 FORM OF OFFER (Incorporating SBD7)")
    d.save(path)
    entries = [_doc_entry("Form of Offer - period heading.docx", path),
               _doc_entry("Technical Submission.xlsm", TECH_WORKBOOK, fmt="xlsm")]
    decision = ct.classify_documents(entries, buyer="SANRAL", all_text="SANRAL tender")
    check("route is sanral (the workbook alone already guarantees this)", decision["route"] == "sanral", decision)
    check("a period after the form letter in the heading text is still recognized",
          "c111_form_of_offer" in decision["sanral_files"], decision)
    # Other notes are expected here (C.1.2.3/A-Forms/Financial workbook
    # genuinely weren't supplied in this fixture) - the only thing this
    # check cares about is that the period-heading document ITSELF isn't
    # flagged as unread/ambiguous/corrupt.
    check("the period-heading document itself is never named in a note (a clean match, not flagged)",
          not any("period heading" in n or "could not be opened" in n or "AMBIGUOUS" in n for n in decision["notes"]),
          decision["notes"])
    os.remove(path)


def test_duplicate_candidates_prefer_the_more_recently_modified_file(tmp_path="/tmp"):
    print("classify_documents: two files both match c111_form_of_offer - the more recently "
          "modified one should win, not whichever sorts first alphabetically")
    import time
    old_path = os.path.join(tmp_path, "Old_Draft_Form_Offer.docx")
    new_path = os.path.join(tmp_path, "Zfinal_Form_Offer.docx")
    d1 = docx.Document(); d1.add_paragraph("C1.1.1 FORM OF OFFER (Incorporating SBD7) - DRAFT")
    d1.save(old_path)
    time.sleep(1.1)
    d2 = docx.Document(); d2.add_paragraph("C1.1.1 FORM OF OFFER (Incorporating SBD7) - FINAL")
    d2.save(new_path)
    entries = [_doc_entry("Old_Draft_Form_Offer.docx", old_path), _doc_entry("Zfinal_Form_Offer.docx", new_path),
               _doc_entry("Technical Submission.xlsm", TECH_WORKBOOK, fmt="xlsm")]
    decision = ct.classify_documents(entries, buyer="SANRAL", all_text="SANRAL tender")
    check("the more recently modified file (Zfinal, alphabetically LAST) is the one actually used",
          decision["sanral_files"].get("c111_form_of_offer") == new_path, decision)
    check("the note names it as AMBIGUOUS and tells a person to check, not a soft 'remove the others if wrong'",
          any(n.startswith("AMBIGUOUS") and "must check" in n for n in decision["notes"]), decision["notes"])
    os.remove(old_path)
    os.remove(new_path)


def test_docx_already_marked_unreadable_is_skipped_without_a_note():
    print("classify_documents: a doc_entry already flagged unreadable upstream")
    entry = _doc_entry("whatever.docx", "/tmp/does-not-matter.docx")
    entry["unreadable"] = "already flagged by requirements.py"
    entry["_local"] = None  # not even checked since _local is falsy anyway, but exercises the real shape
    decision = ct.classify_documents([entry], buyer="SANRAL", all_text="SANRAL tender")
    check("no note is added for a doc_entry with no _local path at all", decision["notes"] == [])


def test_assess_fit_from_text_categorized_tender_no_disciplines_not_duplicated():
    print("assess_fit_from_text: categorized tender, company has no disciplines on file - "
          "the actionable message appears once, not duplicated")
    # Sarel's own live feedback, 2026-10-23: the live Discovery feed showed a
    # generic, unhelpful version of this message. Fixed at the root
    # (assess_tender.assess_fit()) so assess_fit_from_text()'s own call site
    # - which already had a correct, duplicate-ANY-other-reason workaround -
    # doesn't double it up now that the root supplies the same wording.
    title = "APPOINTMENT OF EXTERNAL SECURITY SERVICES AT THE EILAND HOLIDAY RESORT, ROSE PARK & REITZPARK"
    result = ct.assess_fit_from_text(title, "", "", {"disciplines": [], "has_cidb_grading": False})
    check("verdict is needs_review, not rejected", result["verdict"] == "needs_review", result["verdict"])
    hits = [r for r in result["reasons"] if "Experience Library tags" in r]
    check("the actionable message appears exactly once (assess_fit() supplied it; "
          "assess_fit_from_text() must not add a second copy)", len(hits) == 1, result["reasons"])


def test_assess_fit_from_text_uncategorized_tender_no_disciplines_still_appends():
    print("assess_fit_from_text: uncategorized tender AND no disciplines on file - both facts "
          "are true and both are worth telling the user, so the no-disciplines note is still appended")
    # Here assess_fit() itself takes the "uncategorized" branch first (a
    # different primary reason), which never mentions disciplines at all -
    # this is the one case assess_fit_from_text()'s own extra check exists
    # for, and it must keep firing.
    title = "Appointment of a service provider ref ABC123-XYZ"
    result = ct.assess_fit_from_text(title, "", "", {"disciplines": [], "has_cidb_grading": False})
    check("verdict is needs_review", result["verdict"] == "needs_review", result["verdict"])
    check("the uncategorized reason is present",
          any("Could not determine discipline" in r for r in result["reasons"]), result["reasons"])
    hits = [r for r in result["reasons"] if "Experience Library tags" in r]
    check("the no-disciplines note is still appended exactly once, even though a different "
          "reason fired first", len(hits) == 1, result["reasons"])


def main():
    test_corrupt_docx_is_noted_not_silently_dropped()
    test_valid_docx_is_classified_with_no_spurious_note()
    test_period_after_the_form_letter_is_also_recognized()
    test_duplicate_candidates_prefer_the_more_recently_modified_file()
    test_docx_already_marked_unreadable_is_skipped_without_a_note()
    test_assess_fit_from_text_categorized_tender_no_disciplines_not_duplicated()
    test_assess_fit_from_text_uncategorized_tender_no_disciplines_still_appends()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
