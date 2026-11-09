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
import tempfile

import docx

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


def test_edition_mismatches_flags_an_answered_field_the_buyers_edition_did_not_accept():
    print("_edition_mismatches(): QA pass 2026-11-09 - an answered field fill_sbd_docx.py could not "
          "actually place in THIS buyer's edition is a real risk (the pack shows 'filled' but the real "
          ".docx doesn't have it); a field with no data on file at all is not re-flagged here (already "
          "visible elsewhere) - distinguished purely from fill_sbd_docx.py's own existing reason wording, "
          "with no new provenance status or schema change.")
    log = pack.ProvenanceLog(source="test")
    # Confirmed real placement - never flagged.
    log.confirmed("sbd4.employed_by_state", "No")
    # Real buyer-edition mismatch despite a real answer - exactly fill_sbd_docx.py's own
    # SBD4_QUESTIONS wording for "if not n: log.missing(...)".
    log.missing("sbd4.interest_in_related_enterprise", "Declaration not found in this edition - answer by hand.")
    # A true data gap (no company value at all) - never flagged, even though it is also "missing".
    log.missing("sbd1.vat_registration_number", "No vat registration number on file - add it on the Tender Workspace (saved to the company).")
    # A deliberately-always-missing sentinel (never auto-typed, by design) - never flagged.
    log.missing("sbd4.signature_and_date", "Needs a real signature and date - never typed in advance.")
    # SBD1's own "couldn't find" phrasing for the same bug class - different wording, same class.
    log.missing("sbd1.bee_proof_ticked", "Couldn't find the B-BBEE certificate/affidavit tick boxes in this edition - tick by hand.")

    out = pack._edition_mismatches(log.entries)
    flagged_keys = [k for ks in out.values() for k in ks]
    check("flags the real SBD4 mismatch", out.get("4") == ["sbd4.interest_in_related_enterprise"], out)
    check("flags the SBD1 'couldn't find' mismatch under code 1", out.get("1") == ["sbd1.bee_proof_ticked"], out)
    check("does not flag the true data gap", "sbd1.vat_registration_number" not in flagged_keys, out)
    check("does not flag the always-missing signature sentinel", "sbd4.signature_and_date" not in flagged_keys, out)
    check("does not flag the confirmed field", "sbd4.employed_by_state" not in flagged_keys, out)


def test_write_guide_flags_an_edition_mismatch_loudly_and_only_when_present():
    print("write_guide(): the printed Completion Guide must warn, in the one place a company would "
          "actually read it, when a field it shows as answered was never really typed into the real "
          ".docx - otherwise 'filled' is a silent false pass for exactly the field most likely to matter "
          "(a legal declaration).")
    manifest = {"forms": [{"code": "4", "label": "SBD 4", "title": "Bidder's Disclosure", "status": "auto"}]}
    ctx = {"company": {"legal_name": "Klipcorp Civil (Pty) Ltd"}, "signatory": {"name": "Henning Visser", "capacity": "Director"},
           "answers": {"sbd4.employed_by_state": "no", "sbd4.relationship_with_employee": "no",
                       "sbd4.interest_in_related_enterprise": "yes"},
           "tender": {"contract_no": "KLIP-001", "buyer": "Test Municipality"}}

    with tempfile.TemporaryDirectory() as td:
        # With a real mismatch.
        path_bad = os.path.join(td, "guide_bad.docx")
        form_results_bad = {"4": {"status": "filled", "edition_mismatches": ["sbd4.interest_in_related_enterprise"]}}
        pack.write_guide(path_bad, manifest, ctx, form_results_bad, [])
        text_bad = "\n".join(p.text for p in docx.Document(path_bad).paragraphs)
        check("warns about the exact field that was not actually typed in",
              "NOT ACTUALLY TYPED IN" in text_bad and "interest in related enterprise" in text_bad, text_bad)

        # Same form, no mismatch - the warning paragraph must not appear at all.
        path_good = os.path.join(td, "guide_good.docx")
        form_results_good = {"4": {"status": "filled", "edition_mismatches": []}}
        pack.write_guide(path_good, manifest, ctx, form_results_good, [])
        text_good = "\n".join(p.text for p in docx.Document(path_good).paragraphs)
        check("says nothing when there is no mismatch", "NOT ACTUALLY TYPED IN" not in text_good, text_good)

        # A form_results entry with no "edition_mismatches" key at all (every call site before this
        # fix, and the by-hand/exception branch) must not crash write_guide().
        path_missing_key = os.path.join(td, "guide_missing_key.docx")
        pack.write_guide(path_missing_key, manifest, ctx, {"4": {"status": "filled"}}, [])
        check("a form_results entry with no edition_mismatches key at all does not crash", True)


def main():
    test_flags_the_real_misfiled_coid_case()
    test_passes_a_correctly_named_document_for_its_own_slot()
    test_flags_a_bee_or_tax_filename_with_no_matching_keyword_at_all()
    test_no_rule_for_a_column_the_brief_did_not_ask_for()
    test_no_local_path_is_a_no_op_not_a_crash()
    test_cidb_vault_document_is_now_reachable_from_a_general_pack()
    test_edition_mismatches_flags_an_answered_field_the_buyers_edition_did_not_accept()
    test_write_guide_flags_an_edition_mismatch_loudly_and_only_when_present()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
