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
import os
import sys

import docx

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fill_a_forms as fa  # noqa: E402
from provenance import ProvenanceLog  # noqa: E402

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


def main():
    test_undersigned_blank_with_an_ordinary_name_is_filled_as_before()
    test_a_name_with_a_literal_backslash_backreference_is_not_silently_corrupted()
    test_a_name_with_an_invalid_backslash_escape_does_not_crash_the_whole_fill()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
