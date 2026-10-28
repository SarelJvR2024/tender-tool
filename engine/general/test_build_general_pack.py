"""
Regression test for build_general_pack.py's vault_document_mismatch_warning() -
the content-sanity check added after a real incident (2026-10-28, Reviewer
Civils & Consulting): a file named "...BBBEE_Affidavit.docx" was uploaded
into the COID vault slot, and a real pack-generation run merged it into the
pack labelled as the COID Letter of Good Standing. See that function's own
comment in build_general_pack.py for the full reasoning. Mirrors
app/lib/vaultDocuments.test.ts's own coverage of the TypeScript twin of this
same check on the Company vault's upload path.

Run: python3 engine/general/test_build_general_pack.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_general_pack as pack  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def test_flags_the_real_misfiled_coid_case():
    w = pack.vault_document_mismatch_warning(
        "coid_letter_document_path", "/tmp/x/4b38b265-8ac8-4a8d-b115-bae49821d125-BBBEE_Affidavit.docx"
    )
    check("real incident filename is flagged", w is not None)
    check("message names the B-BBEE Affidavit", w and "B-BBEE Affidavit" in w, w)


def test_passes_a_correctly_named_document_for_its_own_slot():
    check("real COID filename passes", pack.vault_document_mismatch_warning(
        "coid_letter_document_path", "/tmp/x/abc-COID_Letter_of_Good_Standing.pdf") is None)
    check("real BEE filename passes", pack.vault_document_mismatch_warning(
        "bee_proof_document_path", "/tmp/x/abc-BBBEE_Sworn_Affidavit.pdf") is None)
    check("real SARS filename passes", pack.vault_document_mismatch_warning(
        "sars_tcs_pin_document_path", "/tmp/x/abc-SARS_Tax_Compliance_PIN.pdf") is None)


def test_flags_a_bee_or_tax_filename_with_no_matching_keyword_at_all():
    check("bee_proof with no BEE keyword is flagged", pack.vault_document_mismatch_warning(
        "bee_proof_document_path", "/tmp/x/abc-scan0042.pdf") is not None)
    check("sars_tcs_pin with no tax keyword is flagged", pack.vault_document_mismatch_warning(
        "sars_tcs_pin_document_path", "/tmp/x/abc-scan0042.pdf") is not None)


def test_no_rule_for_a_column_the_brief_did_not_ask_for():
    for column in ("pi_insurance_document_path", "iso_9001_document_path", "bank_confirmation_letter_path"):
        check(f"{column} has no rule", pack.vault_document_mismatch_warning(column, "anything_at_all.pdf") is None)


def test_no_local_path_is_a_no_op_not_a_crash():
    check("empty path never crashes", pack.vault_document_mismatch_warning("coid_letter_document_path", None) is None)


def main():
    test_flags_the_real_misfiled_coid_case()
    test_passes_a_correctly_named_document_for_its_own_slot()
    test_flags_a_bee_or_tax_filename_with_no_matching_keyword_at_all()
    test_no_rule_for_a_column_the_brief_did_not_ask_for()
    test_no_local_path_is_a_no_op_not_a_crash()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
