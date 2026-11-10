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
from docx.oxml.ns import qn

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fill_a_forms as fa  # noqa: E402
from provenance import ProvenanceLog  # noqa: E402

REAL_TEMPLATES = sorted(glob.glob(os.path.join(HERE, "..", "templates", "forms", "*", "A_Forms.docx")))

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


def _popia_consent_table_cells(doc):
    """Locates the POPIA-consent table by its real, content-based context
    (the paragraph right above it saying 'consent below'), not by its
    header-cell text - that text is exactly what Finding 361's bug flips."""
    body = doc.element.body
    elems = list(body.iterchildren())
    tbl_idx = -1
    for i, child in enumerate(elems):
        if child.tag == qn("w:tbl"):
            tbl_idx += 1
            j = i - 1
            while j >= 0:
                c = elems[j]
                if c.tag == qn("w:p"):
                    txt = "".join(t.text or "" for t in c.iter(qn("w:t")))
                    if txt.strip():
                        if "consent below" in txt.lower():
                            return [cell.text.strip() for cell in doc.tables[tbl_idx].rows[0].cells]
                        break
                j -= 1
    return None


def _paragraph_containing(doc, needle):
    for p in doc.paragraphs:
        if needle.lower() in p.text.lower():
            return p.text
    return None


def test_mark_sbd4_no_answers_leaves_the_popia_consent_table_alone_and_the_real_a11_helpers_fill_the_right_things():
    """Finding 361 (standing review, 2026-11-10): mark_sbd4_no_answers() used
    to mark "No" into whatever table's header row looked like
    ["YES", "", "", "NO", ""], believing that shape meant Form A11's
    "employed by the state" yes/no answer. On every one of the 6 real
    SANRAL A_Forms.docx templates this pipeline actually ships
    (templates/forms/*/A_Forms.docx), that exact shape belongs to the POPIA
    personal-information-processing CONSENT table instead (nowhere near Form
    A11) - so every real SANRAL pack ever built got a "No" (not consenting)
    marked on a mandatory consent question, while Form A11's own real
    yes/no declarations (2.1 "employed by the state", 2.2 "relationship with
    a procuring-institution employee", 2.3 "interest in a related
    enterprise") - plain paragraphs ending in literal "YES/NO" text, not a
    table at all - were left completely blank, with no checklist item
    saying so either."""
    print("Finding 361: the POPIA consent table is left alone by mark_sbd4_no_answers(), "
          "and fill_popia_consent()/fill_a11_declaration_questions() answer the real questions")
    if not REAL_TEMPLATES:
        check("at least one real A_Forms.docx template is on file to test against", False)
        return
    for path in REAL_TEMPLATES:
        label = os.path.basename(os.path.dirname(path))

        d = docx.Document(path)
        before = _popia_consent_table_cells(d)
        if before is None:
            check(f"[{label}] POPIA consent table found", False)
            continue
        log = ProvenanceLog(source="test")
        fa.mark_sbd4_no_answers(d, "Acme (Pty) Ltd", log)
        after = _popia_consent_table_cells(d)
        check(f"[{label}] mark_sbd4_no_answers() does not touch the POPIA consent table",
              after == before, f"before={before!r} after={after!r}")
        check(f"[{label}] mark_sbd4_no_answers() does not log a_forms.A11.employed_by_state "
              "(it never actually reaches that question)",
              not any(e["field_key"] == "a_forms.A11.employed_by_state" for e in log.entries))

        d2 = docx.Document(path)
        log2 = ProvenanceLog(source="test")
        fa.fill_popia_consent(d2, log2)
        after2 = _popia_consent_table_cells(d2)
        yes_idx, no_idx = before.index("YES"), before.index("NO")
        check(f"[{label}] fill_popia_consent() marks the YES cell",
              after2 is not None and after2[yes_idx] == "X", repr(after2))
        check(f"[{label}] fill_popia_consent() leaves the NO cell alone",
              after2 is not None and after2[no_idx] == "NO", repr(after2))
        check(f"[{label}] fill_popia_consent() logs a_forms.popia_consent",
              any(e["field_key"] == "a_forms.popia_consent" for e in log2.entries))

        d3 = docx.Document(path)
        log3 = ProvenanceLog(source="test")
        fa.fill_a11_declaration_questions(d3, log3)
        employed = _paragraph_containing(d3, "employed by the state")
        procuring = _paragraph_containing(d3, "employed by the procuring institution")
        related = _paragraph_containing(d3, "interest in any other related enterprise")
        check(f"[{label}] Form A11's 'employed by the state' question (2.1) is answered",
              employed is not None and "(No)" in employed, repr(employed))
        check(f"[{label}] Form A11's procuring-institution-relationship question (2.2) is answered",
              procuring is not None and "(No)" in procuring, repr(procuring))
        check(f"[{label}] Form A11's related-enterprise-interest question (2.3) is answered",
              related is not None and "(No)" in related, repr(related))
        keys3 = {e["field_key"] for e in log3.entries}
        check(f"[{label}] all 3 real A11 declaration questions are logged with their own field key",
              {"a_forms.A11.employed_by_state", "a_forms.A11.procuring_institution_relationship",
               "a_forms.A11.related_enterprise_interest"} <= keys3, keys3)


def test_main_runs_end_to_end_against_every_real_template_with_no_crash():
    """Smoke test: fill_a_forms.main() against every real template on file,
    with a minimal-but-real profile - the new fill_popia_consent()/
    fill_a11_declaration_questions() calls must not crash main() on any
    edition, and the 4.1-4.4 table (mark_sbd4_no_answers()'s own real
    remaining job) must still be filled."""
    print("main() runs end-to-end, with no crash, against every real A_Forms.docx template on file")
    if not REAL_TEMPLATES:
        check("at least one real A_Forms.docx template is on file to test against", False)
        return
    import json
    import tempfile
    profile = {
        "company": {"legal_name": "Acme Roads (Pty) Ltd", "csd_supplier_number": "MAAA123456"},
        "key_people": [{"name": "Thandi Nkosi", "signatory_capacity": "Director"}],
    }
    for path in REAL_TEMPLATES:
        label = os.path.basename(os.path.dirname(path))
        with tempfile.TemporaryDirectory() as out_dir:
            profile_path = os.path.join(out_dir, "profile.json")
            with open(profile_path, "w") as f:
                json.dump(profile, f)
            try:
                out_path, log = fa.main(path, profile_path, out_dir, "Contract X", "NRA 2026/0001")
            except Exception as e:
                check(f"[{label}] main() does not raise", False, f"{type(e).__name__}: {e}")
                continue
            check(f"[{label}] main() does not raise", True)
            check(f"[{label}] main() wrote the filled docx", os.path.exists(out_path))
            check(f"[{label}] the 4.1-4.4 restricted-supplier table is still filled",
                  any(e["field_key"] == "a_forms.A11.restricted_supplier_register" for e in log.entries))
            check(f"[{label}] the POPIA consent table is marked (not the wrong employed_by_state key)",
                  any(e["field_key"] == "a_forms.popia_consent" for e in log.entries))


def main():
    test_undersigned_blank_with_an_ordinary_name_is_filled_as_before()
    test_a_name_with_a_literal_backslash_backreference_is_not_silently_corrupted()
    test_a_name_with_an_invalid_backslash_escape_does_not_crash_the_whole_fill()
    test_a_control_character_in_the_company_or_signatory_name_does_not_crash_the_whole_fill()
    test_mark_sbd4_no_answers_leaves_the_popia_consent_table_alone_and_the_real_a11_helpers_fill_the_right_things()
    test_main_runs_end_to_end_against_every_real_template_with_no_crash()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
