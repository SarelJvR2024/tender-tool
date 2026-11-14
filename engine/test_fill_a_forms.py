"""
fill_a_forms.py (the full A2-A23 SANRAL A-Forms bundle filler) had no
dedicated test file at all before this pass - confirmed by a repo-wide
search before writing this.

QA Finding, 2026-10-31: fill_declaration_blanks()'s "I, the undersigned,
...." substitution passed an f-string straight to re.subn() as the
REPLACEMENT argument. re.sub()/re.subn() treat a STRING replacement's own
backslashes specially (\\1 is a backreference to a captured group, \\9/
\\g<bad> raise re.error outright) - a signatory's name containing a
literal backslash (a pasted Windows path fragment, an OCR artefact from
the CV-extraction pipeline, a plain typo) either silently spliced this
regex's own matched "I, the undersigned," text into the middle of the
name (when the backslash was followed by an existing group number) or
crashed the whole A-Forms fill outright (any other backslash escape) -
with no error in the first case, and a raw, uncaught re.error in the
second, aborting this company's whole SANRAL pack build.

Fix: the replacement is now a callable (`lambda m: f"..."`), matching the
convention fill_footer() in this same file already uses for the identical
name/position/company values - a callable's return value is used
verbatim, with no backslash processing at all.

Run: python3 engine/test_fill_a_forms.py
"""
import glob
import os
import sys

import docx

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fill_a_forms as fa  # noqa: E402
from provenance import ProvenanceLog  # noqa: E402

REPO_ROOT = os.path.dirname(HERE)
REAL_TEMPLATES = sorted(glob.glob(os.path.join(REPO_ROOT, "templates", "forms", "*", "A_Forms.docx")))

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def test_undersigned_blank_with_an_ordinary_name_is_filled_as_before():
    print("control: an ordinary name (no backslash) fills exactly as before")
    d = docx.Document()
    d.add_paragraph("I, the undersigned, .................... hereby declare")
    log = ProvenanceLog(source="test")
    fa.fill_declaration_blanks(d, "Thandi Nkosi", "Director", "Mzansi Roads (Pty) Ltd", log)
    check("the name is placed, upper-cased, with the dots removed",
          d.paragraphs[0].text == "I, the undersigned, THANDI NKOSI hereby declare", repr(d.paragraphs[0].text))


def test_a_name_with_a_literal_backslash_backreference_is_not_silently_corrupted():
    print("a name containing a literal backslash followed by a digit ('\\1') is placed verbatim, "
          "not silently spliced with this regex's own matched text via re.sub()'s backreference syntax")
    d = docx.Document()
    d.add_paragraph("I, the undersigned, .................... hereby declare")
    log = ProvenanceLog(source="test")
    name = "JOHN\\1 DOE"
    fa.fill_declaration_blanks(d, name, "Director", "Acme (Pty) Ltd", log)
    check("the real name (including its literal backslash) appears verbatim",
          name.upper() in d.paragraphs[0].text, repr(d.paragraphs[0].text))
    check("the regex's own matched label text was NOT spliced into the middle of the name "
          "(the old bug: '\\1' backreferenced the match's own captured group 1)",
          "undersignedI, the undersigned" not in d.paragraphs[0].text.replace(" ", ""), repr(d.paragraphs[0].text))


def test_a_name_with_an_invalid_backslash_escape_does_not_crash_the_whole_fill():
    print("a name containing a backslash the regex engine can't resolve as a backreference "
          "('\\9', no such group) does not raise re.error and abort the fill")
    d = docx.Document()
    d.add_paragraph("I, the undersigned, .................... hereby declare")
    log = ProvenanceLog(source="test")
    name = "JOHN\\9 DOE"
    try:
        fa.fill_declaration_blanks(d, name, "Director", "Acme (Pty) Ltd", log)
    except Exception as e:
        check("fill_declaration_blanks() does not raise", False, f"{type(e).__name__}: {e}")
        return
    check("fill_declaration_blanks() completed without raising", True)
    check("the real name (including its literal backslash) appears verbatim",
          name.upper() in d.paragraphs[0].text, repr(d.paragraphs[0].text))


def test_a_control_character_in_the_company_or_signatory_name_does_not_crash_the_whole_fill():
    """Standing review, 2026-11-07: python-docx (via lxml) raises ValueError("All
    strings must be XML compatible...") on a control character/NULL byte - already
    fixed 7 times elsewhere in this codebase (generate_cv.py, make_envelope_covers.py,
    pdf_merge.py, build_general_pack.py, sanral_fill.py, company_documents.py,
    fill_docx_forms.py) but still reachable here, in every function that writes
    real company/signatory text: confirmed by reproducing the raw crash against
    this module before this fix, then fixing it by routing every real-text write
    through generate_cv.py's shared _safe_text(), same as the other 7. Worse here
    than fill_docx_forms.py's own case: assemble_pack.py's call to
    run_forms_pipeline.main() (which runs this file right after fill_docx_forms.py)
    has no try/except at all, so one bad character anywhere in this data crashed
    the WHOLE SANRAL pack build, not just the A-Forms bundle."""
    print("a control character in the company/signatory name does not raise ValueError "
          "out of fill_declaration_blanks / fill_footer / fill_a8_litigation_table / "
          "fill_a3_not_applicable / fill_a10_no_deviations / append_after_label")
    bad_name, bad_company = "Bad\x07Name", "Bad\x01Corp (Pty) Ltd"

    d1 = docx.Document()
    d1.add_paragraph("I, .................... (name), the undersigned in my capacity as "
                     ".................... (position), on behalf of .................... "
                     "(name of company), herewith grant consent")
    try:
        fa.fill_declaration_blanks(d1, bad_name, "Director", bad_company, ProvenanceLog(source="test"))
        check("fill_declaration_blanks() does not raise on a control character", True)
        check("the control character itself was stripped, not just tolerated",
              "\x07" not in d1.paragraphs[0].text and bad_name.replace("\x07", "").upper() in d1.paragraphs[0].text,
              repr(d1.paragraphs[0].text))
    except Exception as e:
        check("fill_declaration_blanks() does not raise on a control character", False, f"{type(e).__name__}: {e}")

    d2 = docx.Document()
    d2.add_paragraph("Name: ....................")
    try:
        fa.fill_footer(d2, bad_name, "Director", bad_company, ProvenanceLog(source="test"))
        check("fill_footer() does not raise on a control character", True)
    except Exception as e:
        check("fill_footer() does not raise on a control character", False, f"{type(e).__name__}: {e}")

    d3 = docx.Document()
    t = d3.add_table(rows=2, cols=5)
    for i, h in enumerate(["Client", "Other litigating party", "Dispute", "Award value", "Date resolved"]):
        t.rows[0].cells[i].text = h
    try:
        fa.fill_a8_litigation_table(d3, bad_company, ProvenanceLog(source="test"))
        check("fill_a8_litigation_table() does not raise on a control character", True)
    except Exception as e:
        check("fill_a8_litigation_table() does not raise on a control character", False, f"{type(e).__name__}: {e}")

    d4 = docx.Document()
    d4.add_paragraph("In the event of a Joint Venture, attach the agreement")
    try:
        fa.fill_a3_not_applicable(d4, bad_company, ProvenanceLog(source="test"))
        check("fill_a3_not_applicable() does not raise on a control character", True)
    except Exception as e:
        check("fill_a3_not_applicable() does not raise on a control character", False, f"{type(e).__name__}: {e}")

    d5 = docx.Document()
    d5.add_paragraph("FORM A10")
    d5.add_paragraph("NRA reference line")
    d5.add_paragraph("")
    try:
        fa.fill_a10_no_deviations(d5, bad_company, ProvenanceLog(source="test"))
        check("fill_a10_no_deviations() does not raise on a control character", True)
    except Exception as e:
        check("fill_a10_no_deviations() does not raise on a control character", False, f"{type(e).__name__}: {e}")

    d6 = docx.Document()
    d6.add_paragraph("Bank name: ")
    try:
        fa.append_after_label(d6, "Bank name:", "Bad\x02Bank", ProvenanceLog(source="test"), "test.key")
        check("append_after_label() does not raise on a control character", True)
    except Exception as e:
        check("append_after_label() does not raise on a control character", False, f"{type(e).__name__}: {e}")


def test_fill_footer_position_regex_does_not_match_position_as_a_substring_of_another_word():
    """Finding 362, 2026-11-10: position_re's trailing colon in fill_footer() is
    deliberately optional (the real "Position" footer label has no colon in any
    of the 6 real SANRAL templates on file, just dotted blanks right after the
    bare word) - but with no colon required and no word boundary, "Position"
    (case-insensitive) matched as a bare SUBSTRING of any unrelated word
    containing it too, e.g. "positions". Reproduced directly against a
    synthetic fixture first (no real template needed to show the mechanism),
    then confirmed as live-reachable against every real template below."""
    print("fill_footer() does not splice the signatory's position into the middle of an "
          "unrelated word that merely contains 'position' as a substring (e.g. 'positions')")
    d = docx.Document()
    d.add_paragraph("Tenderers shall note that signatures appended to each returnable form "
                     "represents a declaration for the specified key positions.")
    log = ProvenanceLog(source="test")
    fa.fill_footer(d, "Jane Signatory", "Managing Director", "Acme (Pty) Ltd", log)
    text = d.paragraphs[0].text
    check("the unrelated sentence is untouched byte-for-byte",
          text == "Tenderers shall note that signatures appended to each returnable form "
                  "represents a declaration for the specified key positions.", repr(text))
    check("the signatory's capacity was NOT spliced into the middle of 'positions'",
          "Managing Director" not in text, repr(text))

    # Control: the real "Name:...Position..." footer shape (no colon, dots
    # directly after the bare word) must still be filled exactly as before -
    # the fix must not make position_re stop matching the real label.
    d2 = docx.Document()
    d2.add_paragraph("Name:……………………….……………Position……………………………………………….")
    log2 = ProvenanceLog(source="test")
    fa.fill_footer(d2, "Jane Signatory", "Managing Director", "Acme (Pty) Ltd", log2)
    check("the real, colon-less 'Position' footer label is still filled",
          "Managing Director" in d2.paragraphs[0].text, repr(d2.paragraphs[0].text))


def test_fill_footer_does_not_corrupt_the_real_boilerplate_sentences_on_every_real_template():
    """Finding 362 (continued): confirmed live-reachable, not just a synthetic
    fixture - every one of the 6 real SANRAL A_Forms.docx templates on file
    contains "...for the specified key positions." at least once, and
    R.352-020 additionally has "...the individual positions of the key
    personnel...". Before the fix, fill_footer() spliced the signatory's
    capacity into the middle of 'positions' in both sentences, on every
    template on file."""
    check("at least the 6 known real A_Forms.docx templates are present to test against",
          len(REAL_TEMPLATES) >= 6, f"found {len(REAL_TEMPLATES)}: {REAL_TEMPLATES}")
    for path in REAL_TEMPLATES:
        rel = os.path.relpath(path, REPO_ROOT)
        d = docx.Document(path)
        log = ProvenanceLog(source="test")
        fa.fill_footer(d, "Jane Signatory", "Managing Director", "Acme (Pty) Ltd", log)
        corrupted = [p.text for p in d.paragraphs
                     if "Managing Director" in p.text
                     and ("specified key position" in p.text or "individual position" in p.text)]
        check(f"{rel}: no boilerplate 'position(s)' sentence corrupted",
              not corrupted, corrupted)


def main():
    test_undersigned_blank_with_an_ordinary_name_is_filled_as_before()
    test_a_name_with_a_literal_backslash_backreference_is_not_silently_corrupted()
    test_a_name_with_an_invalid_backslash_escape_does_not_crash_the_whole_fill()
    test_a_control_character_in_the_company_or_signatory_name_does_not_crash_the_whole_fill()
    test_fill_footer_position_regex_does_not_match_position_as_a_substring_of_another_word()
    test_fill_footer_does_not_corrupt_the_real_boilerplate_sentences_on_every_real_template()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
