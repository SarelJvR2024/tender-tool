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
import process_general_jobs as pgj  # noqa: E402
import requirements as req  # noqa: E402

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


def test_cidb_vault_document_is_now_reachable_from_a_general_pack():
    print("VAULT_FILE_FOR/VAULT_EXPIRY_FOR/VAULT_COLUMNS: a company's own uploaded CIDB "
          "certificate (migration 0063) is actually reachable, not silently dropped")
    # Finding 119 (2026-11-03, non-SANRAL pack rotation): "cidb" is a real
    # requirements.RETURNABLES key (manifest["returnables"]), and
    # companies.cidb_document_path/cidb_expiry are real columns (migration
    # 0063) - but VAULT_FILE_FOR/VAULT_EXPIRY_FOR here never mapped the
    # key to the column, AND process_general_jobs.py's own VAULT_COLUMNS
    # never downloaded the file from storage in the first place, so a
    # company's genuine CIDB registration/grading certificate could never
    # reach a general (non-SANRAL) pack's own "CIDB registration / grading"
    # returnable - it always read "not uploaded for this tender" instead,
    # same shape as the sibling's own watch_deadlines.py cidb_expiry fix
    # found the same day for the identical migration-0063 column.
    returnable_keys = {r["key"] for r in req.RETURNABLES}
    check("'cidb' really is a real returnables catalog key (not a typo in this fix)",
          "cidb" in returnable_keys, returnable_keys)
    check("VAULT_FILE_FOR now maps 'cidb' to the real company column",
          pack.VAULT_FILE_FOR.get("cidb") == "cidb_document_path", pack.VAULT_FILE_FOR)
    check("VAULT_EXPIRY_FOR now maps 'cidb' to the real expiry column",
          pack.VAULT_EXPIRY_FOR.get("cidb") == "cidb_expiry", pack.VAULT_EXPIRY_FOR)
    check("process_general_jobs.VAULT_COLUMNS now downloads it too - otherwise the mapping "
          "above would still find nothing, since the file was never fetched from storage",
          "cidb_document_path" in pgj.VAULT_COLUMNS, pgj.VAULT_COLUMNS)

    # The exact lookup build_general_pack() itself runs (its own returnables
    # loop, step 4) - a company WITH a real vault file and no per-tender
    # upload must resolve to that vault file, not silently stay None.
    files = {"vault:cidb_document_path": "/work/files/vault/cidb-cert.pdf"}
    r = {"key": "cidb", "label": "CIDB registration / grading", "strength": "required"}
    path = files.get("upload:" + r["key"])
    col = pack.VAULT_FILE_FOR.get(r["key"])
    if not path and col:
        path = files.get("vault:" + col)
    check("the real pack-build lookup now actually finds the vault file", path == "/work/files/vault/cidb-cert.pdf", path)


def main():
    test_flags_the_real_misfiled_coid_case()
    test_passes_a_correctly_named_document_for_its_own_slot()
    test_flags_a_bee_or_tax_filename_with_no_matching_keyword_at_all()
    test_no_rule_for_a_column_the_brief_did_not_ask_for()
    test_no_local_path_is_a_no_op_not_a_crash()
    test_cidb_vault_document_is_now_reachable_from_a_general_pack()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
