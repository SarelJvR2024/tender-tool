"""
Filename-only content-sanity check for a company vault document that is
about to be bound into a real submission pack, shared by BOTH pack builders.

Real incident, 2026-10-28 (Reviewer Civils & Consulting): a file named
"...BBBEE_Affidavit.docx" was uploaded into the COID vault slot, and a real
pack-generation run merged it into the pack labelled as the COID Letter of
Good Standing. Same filename-only heuristic as lib/vaultDocuments.ts's own
vaultDocumentMismatchWarning() on the app side (that file's own comment
explains why filename, not real text extraction: neither pack builder reads
a vault document's own content before it's already bound into the pack - too
late to ask the vault page's own upload-time check to run again, and that
upload-time check is only ever run once, at upload, so a file swapped in
later - or a vault document set up before this check even existed - is only
ever actually caught here, at pack-build time). Keyed by the companies.*_path
column (the one name every caller agrees on), not a builder-specific key.

Originally lived only in engine/general/build_general_pack.py (the general,
non-SANRAL pack) - engine/pack/assemble_pack.py (the SANRAL pack) binds the
exact SAME companies.*_path vault documents (sars_tcs_pin_document_path,
bee_proof_document_path, coid_letter_document_path - see its own VAULT_ORDER)
into a real, signed submission, so a misfiled document is exactly as real a
risk there, but it never got this check at all until this module was pulled
out and wired into both (QA pass, 2026-11-10, Finding 341).
"""
import os

VAULT_MISMATCH_KEYWORDS = {
    "coid_letter_document_path": {
        "reject": (["bbbee", "b-bbee", "bee", "affidavit", "broad-based", "broadbased"], "a B-BBEE Affidavit"),
        "expect": ["coid", "compensation", "good standing", "letter of good standing"],
    },
    "bee_proof_document_path": {
        "expect": ["bee", "bbbee", "b-bbee", "affidavit", "sanas", "broad-based", "broadbased"],
    },
    "sars_tcs_pin_document_path": {
        "expect": ["tax", "sars", "pin", "tcs", "compliance"],
    },
}

# Same wording lib/vaultDocuments.ts's VAULT_DOCUMENTS gives each column on
# the app side.
VAULT_LABEL_FOR = {
    "coid_letter_document_path": "COID Letter of Good Standing",
    "bee_proof_document_path": "a B-BBEE certificate or sworn affidavit",
    "sars_tcs_pin_document_path": "a SARS Tax Compliance Status PIN letter",
}


def vault_document_mismatch_warning(column, local_path):
    """Non-blocking content-sanity warning for one vault document already
    downloaded to `local_path` - filename only, see this module's own
    docstring. Returns None for a column with no rule, or for a filename
    that passes its rule."""
    rule = VAULT_MISMATCH_KEYWORDS.get(column)
    if not rule or not local_path:
        return None
    name = os.path.basename(local_path).lower()
    reject = rule.get("reject")
    if reject:
        words, looks_like = reject
        if any(w in name for w in words):
            return f"This document appears to be {looks_like}, not {VAULT_LABEL_FOR.get(column, 'this compliance document')}."
    expect = rule.get("expect")
    if expect and not any(w in name for w in expect):
        return f"This file's name doesn't look like {VAULT_LABEL_FOR.get(column, 'this compliance document')} - check the right file was uploaded."
    return None
