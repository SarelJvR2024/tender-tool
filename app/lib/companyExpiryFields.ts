// Extracted out of lib/notifications.ts (2026-10-27) so a standalone script
// run via `node --experimental-strip-types` can import this constant
// without going through notifications.ts's own extensionless relative
// import ("./dates") - direct node execution can't resolve that (confirmed
// live: ERR_MODULE_NOT_FOUND), the exact limitation lib/deadlineReminders.ts's
// own header comment already documents and works around for the identical
// reason. Zero imports here on purpose, so this file is always safely
// importable from either context. notifications.ts re-exports this for its
// own existing callers - nobody needs to change their import.
//
// `kind`/`pathField`: added 2026-10-29 so the Document expiry overview
// (DocumentExpiryOverview.tsx) can turn each of these 7 rows into the same
// upload target lib/vaultDocuments.ts's VAULT_DOCUMENTS already defines for
// it, instead of only linking down to the vault section below. Written as
// plain string literals, matching VaultDocumentKind's own keys exactly - not
// `import type { VaultDocumentKind }`, to keep this file's zero-imports rule
// intact (a type-only import is erased by --experimental-strip-types, but
// the literals cost nothing and keep the guarantee unambiguous).
export const COMPANY_EXPIRY_FIELDS: { field: string; label: string; windowDays?: number; kind: string; pathField: string }[] = [
  { field: "coid_letter_of_good_standing_expiry", label: "COID Letter of Good Standing", kind: "coid", pathField: "coid_letter_document_path" },
  { field: "cidb_expiry", label: "CIDB grading", kind: "cidb", pathField: "cidb_document_path" },
  { field: "sars_tcs_pin_expiry", label: "SARS Tax Compliance PIN", kind: "sars_tcs_pin", pathField: "sars_tcs_pin_document_path" },
  { field: "pi_insurance_expiry", label: "Professional Indemnity insurance", kind: "pi_insurance", pathField: "pi_insurance_document_path" },
  { field: "iso_9001_expiry", label: "ISO 9001 certificate", kind: "iso_9001", pathField: "iso_9001_document_path" },
  // 30, not the other six fields' 60 - the letter is only valid 3 months
  // from its own date, so a 60-day "renew soon" window would flag it as
  // due before the vault itself (lib/vaultDocuments.ts's
  // BANK_LETTER_RENEW_SOON_DAYS, same 30) and the real compliance checks
  // (lib/tenderCompliance.ts, lib/generalTender.ts) call it due. A plain
  // literal, not an import of that constant - this file stays at zero
  // imports on purpose (see header comment) so a standalone script can
  // still import it directly; engine/compliance/watch_deadlines.py's own
  // TRACKED_EXPIRY_FIELDS carries the identical 30 for the same column,
  // with the identical cross-reference, for the same reason.
  { field: "bank_confirmation_letter_valid_until", label: "Bank confirmation letter", windowDays: 30, kind: "bank_letter", pathField: "bank_confirmation_letter_path" },
  { field: "bee_proof_expiry", label: "B-BBEE proof", kind: "bee_proof", pathField: "bee_proof_document_path" },
];
