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


def test_still_to_write_includes_a_genuinely_missing_field_with_no_value_on_file():
    print("Finding 394: a 'missing' field (label on this edition, no value on "
          "file at all) must still show up in the 'still to write' note, not "
          "just a 'not_placed' field that happens to have a value")
    fields = {
        "sbd1.name_of_bidder": {"status": "placed", "value": "Acme (Pty) Ltd"},
        # Genuinely missing: no CSD number on file at all - this is the shape
        # place_text_fields()/place_captions() ALWAYS produce for status
        # "missing" (vals.get(...) is the same falsy value that made it
        # "missing" in the first place).
        "sbd1.csd_number": {"status": "missing", "value": None, "reason": "not on file"},
        # not_placed WITH a value (too long for the cell) - already worked
        # before this fix; must keep working.
        "sbd1.total_bid_price": {"status": "not_placed", "value": "R 12 345 678.90", "reason": "too long for the cell on the form"},
        # Genuinely not on this edition - never belongs in "still to write".
        "sbd1.facsimile_number": {"status": "not_found", "value": None, "reason": "label not on this edition"},
        # Already handled by the buyer - never belongs either.
        "sbd9.name_of_institution": {"status": "prefilled", "value": None, "reason": "already printed on the form by the buyer"},
    }
    left_keys = {k for k, _ in pack._still_to_write(fields)}
    check("the missing, no-value CSD field IS included", "sbd1.csd_number" in left_keys, left_keys)
    check("the not_placed, has-a-value field is still included", "sbd1.total_bid_price" in left_keys, left_keys)
    check("a placed field is not included", "sbd1.name_of_bidder" not in left_keys, left_keys)
    check("a genuinely not_found field is not included", "sbd1.facsimile_number" not in left_keys, left_keys)
    check("a buyer-prefilled field is not included", "sbd9.name_of_institution" not in left_keys, left_keys)
    check("exactly the two real gaps are reported, nothing more", left_keys == {"sbd1.csd_number", "sbd1.total_bid_price"}, left_keys)


def test_buyer_form_note_includes_a_genuinely_missing_field_with_no_value_on_file():
    print("Finding 395: the buyer_forms loop's own overlay note (CEQ / Form "
          "of Offer) must also surface a genuinely missing field - the same "
          "sibling gap Finding 394 fixed for the manifest-forms loop, but "
          "this loop never picked up at all: it only ever reported the "
          "STATIC fills/by_hand promise from requirements.OVERLAY_BUYER_FORMS, "
          "never fill_flat_pdf.py's own per-company, per-field report")
    ov = {"page": 3, "document": "CEQ.pdf",
          "by_hand": "the CIDB number, partner/principal particulars, banking account number and the signature"}
    orep = {"fields": {
        "ceq.name_of_enterprise": {"status": "placed", "value": "Acme (Pty) Ltd"},
        # Genuinely missing: no tax reference number on file at all - this
        # field is part of the STATIC "fills" promise (requirements.py:
        # "name, VAT, CSD, company registration and tax numbers..."), so the
        # old code told the company it was typed on when it was not.
        "ceq.tax_reference_number": {"status": "missing", "value": None, "reason": "not on file"},
        # Genuinely not on this edition - never belongs in the note.
        "ceq.bank_name_and_branch": {"status": "not_found", "value": None, "reason": "label not on this edition"},
    }}
    note = pack._buyer_overlay_note(ov, orep)
    check("mentions the genuinely missing tax reference number", "tax reference number" in note, note)
    check("still names the static by-hand list too", "CIDB number" in note, note)
    check("does not claim a not_found field is still to write", "bank name and branch" not in note, note)


def test_buyer_form_note_with_nothing_missing_has_no_extra_clause():
    print("Finding 395: when every field the overlay attempted was actually "
          "placed, the note must stay exactly as before - no false positive")
    ov = {"page": 1, "document": "FORM_OF_OFFER.pdf", "by_hand": "the offered price, the signature and the witnesses"}
    orep = {"fields": {"form_of_offer.tenderer": {"status": "placed", "value": "Acme (Pty) Ltd"}}}
    note = pack._buyer_overlay_note(ov, orep)
    check("no 'still to write' clause when nothing is missing", "still to write" not in note, note)
    check("the static by-hand promise is still there", "offered price" in note, note)


def main():
    test_flags_the_real_misfiled_coid_case()
    test_passes_a_correctly_named_document_for_its_own_slot()
    test_flags_a_bee_or_tax_filename_with_no_matching_keyword_at_all()
    test_no_rule_for_a_column_the_brief_did_not_ask_for()
    test_no_local_path_is_a_no_op_not_a_crash()
    test_cidb_vault_document_is_now_reachable_from_a_general_pack()
    test_still_to_write_includes_a_genuinely_missing_field_with_no_value_on_file()
    test_buyer_form_note_includes_a_genuinely_missing_field_with_no_value_on_file()
    test_buyer_form_note_with_nothing_missing_has_no_extra_clause()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
