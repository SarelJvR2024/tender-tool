"""
Focused test for fill_docx_forms.py's C.1.2.3 key-person row handling - added
during this session's enterprise-readiness audit (Sarel, 2026-10-20: "make
sure it is designed and build to catch all ... scenarios"). No dedicated
test file existed for this module before this.

Finding: `_row_code(label)` returns None for two different reasons - a
genuinely optional "Alternate to ... (if applicable)" row, and a real
key-position row whose title simply doesn't match anything in
POSITION_TITLES (e.g. a future SANRAL tender using a title this project's
own dict doesn't recognise yet). fill_contract_data() used to treat both
identically - silently leaving the row blank with nothing in the
provenance report telling a human to fill it by hand. This would hit a
brand-new company's very first tender with no warning at all, since
admin_harness.py's own baseline-diff treats a first run as "clean,
baseline stored" unconditionally.

Run: python3 engine/test_fill_docx_forms.py
"""
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import docx  # noqa: E402
import fill_docx_forms as fdf  # noqa: E402
from provenance import ProvenanceLog  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _build_template(src_dir):
    """Minimal synthetic C.1.2.3_Contract_Data.docx: just enough structure
    for fill_contract_data() to run without erroring (3 tables - company
    info, key-persons, directors), not a full real-looking form."""
    d = docx.Document()
    t0 = d.add_table(rows=1, cols=1)
    t0.rows[0].cells[0].paragraphs[0].add_run("placeholder")

    t1 = d.add_table(rows=4, cols=2)
    t1.rows[0].cells[0].text = "Position"
    t1.rows[1].cells[0].text = "Project Leader"
    t1.rows[2].cells[0].text = "Alternate to Project Leader (if applicable)"
    t1.rows[3].cells[0].text = "Quantum Flux Coordinator"  # a bogus, unrecognized title

    d.add_table(rows=2, cols=4)  # directors table - header + one blank row

    d.save(os.path.join(src_dir, "C.1.2.3_Contract_Data.docx"))


def test_unrecognized_key_position_title_is_logged_not_silently_skipped():
    print("fill_contract_data: an unrecognized key-position title vs a genuinely optional 'Alternate' row")
    with tempfile.TemporaryDirectory() as src_dir, tempfile.TemporaryDirectory() as out_dir:
        _build_template(src_dir)
        comp = {"legal_name": "Test Co", "registered_address": "1 Test St"}
        signatory = {"name": "Jane Doe", "signatory_capacity": "Director"}
        log = ProvenanceLog(source="test")
        fdf.fill_contract_data(src_dir, out_dir, comp, signatory, key_persons=[], log=log)

        missing = {e["field_key"]: e["reason"] for e in log.entries if e["status"] == "missing"}
        check("a recognized title with no confirmed person is still logged missing (unchanged baseline)",
              "c123.key_person_row_1" in missing, missing)
        check("a genuinely optional 'Alternate to ...' row stays silently skipped - no log entry",
              "c123.key_person_row_2" not in missing, missing)
        check("an unrecognized title is NOW logged missing, with a clear, actionable reason (the fix)",
              "c123.key_person_row_3" in missing
              and "doesn't match any known SANRAL key-position title" in missing.get("c123.key_person_row_3", ""),
              missing)


# Standing review, 2026-11-06: fill_contract_data()/fill_form_of_offer() write
# real company/director/principal text straight into python-docx runs/cells -
# a stray control character (OCR'd text, a bad paste) makes python-docx/lxml
# raise ValueError("All strings must be XML compatible...") and crash the
# whole SANRAL pack build (assemble_pack.py's own call to this pipeline has
# no try/except, unlike the print_financial.export() call next to it). Fixed
# by routing every such write through generate_cv.py's shared _safe_text().
CONTROL_CHAR = "\x0b"  # vertical tab - rejected outright by python-docx/lxml


def _build_cd_template_for_director(src_dir):
    """Minimal C.1.2.3 template exercising the 'one director on file, no
    principals register' branch (fill_contract_data()'s `elif director:`)."""
    d = docx.Document()
    d.add_table(rows=1, cols=1)  # company-info table - unused by this test
    d.add_table(rows=1, cols=2)  # key-person table - header only, key_persons=[]
    d.add_table(rows=2, cols=4)  # directors table - header + one blank row
    d.save(os.path.join(src_dir, "C.1.2.3_Contract_Data.docx"))


def _build_cd_template_for_principals(src_dir):
    """Minimal C.1.2.3 template exercising the principals-register branch
    (fill_contract_data()'s `if principals:`), one directors-table row."""
    d = docx.Document()
    d.add_table(rows=1, cols=1)
    d.add_table(rows=1, cols=2)
    d.add_table(rows=2, cols=4)
    d.save(os.path.join(src_dir, "C.1.2.3_Contract_Data.docx"))


def _build_offer_template(src_dir):
    d = docx.Document()
    d.add_paragraph("NAME AND ADDRESS OF ORGANISATION:")
    d.add_paragraph("NAME (IN CAPITALS): ")
    d.add_paragraph("CAPACITY: ")
    d.save(os.path.join(src_dir, "C.1.1.1_Form_of_Offer.docx"))


def test_control_character_in_director_name_is_stripped_not_crashed():
    print("fill_contract_data: a control character in the company's one-director name must not crash python-docx")
    with tempfile.TemporaryDirectory() as src_dir, tempfile.TemporaryDirectory() as out_dir:
        _build_cd_template_for_director(src_dir)
        comp = {
            "legal_name": "Test Co", "registered_address": "1 Test St",
            "director": {"name": f"Jane{CONTROL_CHAR}Doe"},
        }
        signatory = {"name": "Jane Doe", "signatory_capacity": "Director"}
        log = ProvenanceLog(source="test")
        try:
            fdf.fill_contract_data(src_dir, out_dir, comp, signatory, key_persons=[], log=log)
            crashed = False
        except ValueError:
            crashed = True
        check("a control character in the director's name does not crash fill_contract_data", not crashed)
        if not crashed:
            out = docx.Document(os.path.join(out_dir, "C.1.2.3_Contract_Data_FILLED.docx"))
            written = out.tables[2].rows[1].cells[0].text
            check("the control character is stripped from the written director name, not just swallowed",
                  written == "JaneDoe", written)


def test_control_character_in_principal_designation_is_stripped_not_crashed():
    print("fill_contract_data: a control character in a principal's designation must not crash python-docx")
    with tempfile.TemporaryDirectory() as src_dir, tempfile.TemporaryDirectory() as out_dir:
        _build_cd_template_for_principals(src_dir)
        comp = {
            "legal_name": "Test Co", "registered_address": "1 Test St",
            "principals": [{"name": "Jane Doe", "designation": f"Managing{CONTROL_CHAR}Director",
                             "appointed_on": "2020-01-01"}],
        }
        signatory = {"name": "Jane Doe", "signatory_capacity": "Director"}
        log = ProvenanceLog(source="test")
        try:
            fdf.fill_contract_data(src_dir, out_dir, comp, signatory, key_persons=[], log=log)
            crashed = False
        except ValueError:
            crashed = True
        check("a control character in a principal's designation does not crash fill_contract_data", not crashed)
        if not crashed:
            out = docx.Document(os.path.join(out_dir, "C.1.2.3_Contract_Data_FILLED.docx"))
            written = out.tables[2].rows[1].cells[2].text
            check("the control character is stripped from the written designation, not just swallowed",
                  written == "ManagingDirector", written)


def test_control_character_in_organisation_name_is_stripped_not_crashed():
    print("fill_form_of_offer: a control character in the company's legal name must not crash python-docx")
    with tempfile.TemporaryDirectory() as src_dir, tempfile.TemporaryDirectory() as out_dir:
        _build_offer_template(src_dir)
        comp = {"legal_name": f"Acme{CONTROL_CHAR}Corp", "registered_address": "1 Test St"}
        signatory = {"name": "Jane Doe", "signatory_capacity": "Director"}
        log = ProvenanceLog(source="test")
        try:
            fdf.fill_form_of_offer(src_dir, out_dir, comp, signatory, log=log)
            crashed = False
        except ValueError:
            crashed = True
        check("a control character in the organisation name does not crash fill_form_of_offer", not crashed)
        if not crashed:
            out = docx.Document(os.path.join(out_dir, "C.1.1.1_Form_of_Offer_FILLED.docx"))
            written = out.paragraphs[0].text
            check("the control character is stripped from the written organisation name, not just swallowed",
                  written == "NAME AND ADDRESS OF ORGANISATION:  AcmeCorp, 1 Test St", written)


def main():
    test_unrecognized_key_position_title_is_logged_not_silently_skipped()
    test_control_character_in_director_name_is_stripped_not_crashed()
    test_control_character_in_principal_designation_is_stripped_not_crashed()
    test_control_character_in_organisation_name_is_stripped_not_crashed()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
