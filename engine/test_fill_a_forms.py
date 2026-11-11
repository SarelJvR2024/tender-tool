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


REPO_ROOT = os.path.abspath(os.path.join(HERE, ".."))
A17_FORMS_SAMPLE = os.path.join(REPO_ROOT, "templates", "forms", "R.396-010-2025.1F", "A_Forms.docx")


def _a17_profile(professional_indemnity_insurance=None):
    company = {"legal_name": "Acme Roads (Pty) Ltd", "registered_address": "1 Main Road, Pretoria"}
    if professional_indemnity_insurance is not None:
        company["professional_indemnity_insurance"] = professional_indemnity_insurance
    return {
        "company": company,
        "key_people": [{"name": "Thandi Nkosi", "signatory_capacity": "Director"}],
    }


def test_a17_professional_indemnity_on_file_is_actually_written_into_the_real_document():
    """Finding 369: until this fix, a professional indemnity policy on file was
    only ever recorded as `confirmed` in field_provenance - it never wrote the
    policy into Form A17's own real "Period of Validity:"/"Company:"/"Value:"
    blanks (under "Professional Indemnity (for each and every case)"), unlike
    every other mechanical field in this module. The real submitted document
    stayed blank while the provenance record claimed otherwise - and because
    it's `confirmed`, not `missing`, ACTIONS_TO_SIGN.md never flagged it
    either. The identical shape of gap Finding 368 fixed one function away,
    for Form A9's SARS TCS PIN."""
    print("Form A17's own Professional Indemnity blanks are actually filled with the real "
          "policy on file, not just recorded as confirmed in field_provenance")
    if not os.path.exists(A17_FORMS_SAMPLE):
        check("real SANRAL A_Forms.docx sample is on disk", False, A17_FORMS_SAMPLE)
        return
    import json
    import tempfile
    pi = {"insurer": "Test Underwriters Ltd", "policy_number": "PI-TEST-00123",
          "limit_of_indemnity_zar": 5000000, "period_from": "2026-01-01", "period_to": "2026-12-31"}
    with tempfile.TemporaryDirectory() as tmp:
        profile_path = os.path.join(tmp, "profile.json")
        json.dump(_a17_profile(professional_indemnity_insurance=pi), open(profile_path, "w"))
        out_dir = os.path.join(tmp, "out")
        os.makedirs(out_dir)
        path, log = fa.main(A17_FORMS_SAMPLE, profile_path, out_dir, "SANRAL R.396-010-2025/1F", "2026/0071")
        d = docx.Document(path)
        period_paras = [p.text for p in d.paragraphs if p.text.strip().startswith("Period of Validity:")]
        company_paras = [p.text for p in d.paragraphs if p.text.strip().startswith("Company:")]
        value_paras = [p.text for p in d.paragraphs if p.text.strip().startswith("Value:")]
        check("exactly 1 'Period of Validity:' paragraph in the real sample", len(period_paras) == 1, period_paras)
        check("exactly 3 'Company:'/'Value:' pairs in the real sample (PI, public liability, third party)",
              len(company_paras) == 3 and len(value_paras) == 3, (company_paras, value_paras))
        check("the real validity period is written into 'Period of Validity:'",
              bool(period_paras) and "2026-01-01 to 2026-12-31" in period_paras[0], period_paras)
        check("the real insurer is written into the FIRST 'Company:' (Professional Indemnity)",
              bool(company_paras) and "Test Underwriters Ltd" in company_paras[0], company_paras)
        check("the real limit/policy number is written into the FIRST 'Value:' (Professional Indemnity)",
              bool(value_paras) and "5,000,000" in value_paras[0] and "PI-TEST-00123" in value_paras[0], value_paras)
        check("the OTHER two 'Company:'/'Value:' pairs (public liability, third party) are left untouched",
              company_paras[1:] == ["Company:\t", "Company:\t"] and value_paras[1:] == ["Value:\t", "Value:\t"],
              (company_paras[1:], value_paras[1:]))
        entries = {e["field_key"]: e for e in log.entries}
        check("field_provenance still records it as confirmed (unchanged behaviour)",
              entries.get("a_forms.A17.professional_indemnity_value", {}).get("status") == "confirmed")


def test_a17_with_no_professional_indemnity_on_file_leaves_the_blanks_untouched():
    print("with no professional indemnity policy on file, Form A17's own Professional "
          "Indemnity blanks are left exactly as the template shipped them (control case)")
    if not os.path.exists(A17_FORMS_SAMPLE):
        check("real SANRAL A_Forms.docx sample is on disk", False, A17_FORMS_SAMPLE)
        return
    import json
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        profile_path = os.path.join(tmp, "profile.json")
        json.dump(_a17_profile(), open(profile_path, "w"))
        out_dir = os.path.join(tmp, "out")
        os.makedirs(out_dir)
        path, log = fa.main(A17_FORMS_SAMPLE, profile_path, out_dir, "SANRAL R.396-010-2025/1F", "2026/0071")
        d = docx.Document(path)
        period_paras = [p.text for p in d.paragraphs if p.text.strip().startswith("Period of Validity:")]
        company_paras = [p.text for p in d.paragraphs if p.text.strip().startswith("Company:")]
        value_paras = [p.text for p in d.paragraphs if p.text.strip().startswith("Value:")]
        check("'Period of Validity:' is untouched", period_paras == ["Period of Validity:\t"], period_paras)
        check("all 3 'Company:' blanks are untouched", company_paras == ["Company:\t"] * 3, company_paras)
        check("all 3 'Value:' blanks are untouched", value_paras == ["Value:\t"] * 3, value_paras)
        entries = {e["field_key"]: e for e in log.entries}
        check("field_provenance records it as missing, as before",
              entries.get("a_forms.A17.professional_indemnity_value", {}).get("status") == "missing")


def main():
    test_undersigned_blank_with_an_ordinary_name_is_filled_as_before()
    test_a_name_with_a_literal_backslash_backreference_is_not_silently_corrupted()
    test_a_name_with_an_invalid_backslash_escape_does_not_crash_the_whole_fill()
    test_a_control_character_in_the_company_or_signatory_name_does_not_crash_the_whole_fill()
    test_a17_professional_indemnity_on_file_is_actually_written_into_the_real_document()
    test_a17_with_no_professional_indemnity_on_file_leaves_the_blanks_untouched()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
