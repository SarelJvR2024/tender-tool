// Extracted out of lib/notifications.ts (2026-10-27) so a standalone script
// run via `node --experimental-strip-types` can import this constant
// without going through notifications.ts's own extensionless relative
// import ("./dates") - direct node execution can't resolve that (confirmed
// live: ERR_MODULE_NOT_FOUND), the exact limitation lib/deadlineReminders.ts's
// own header comment already documents and works around for the identical
// reason. Zero imports here on purpose, so this file is always safely
// importable from either context. notifications.ts re-exports this for its
// own existing callers - nobody needs to change their import.
export const COMPANY_EXPIRY_FIELDS: { field: string; label: string; windowDays?: number }[] = [
  { field: "coid_letter_of_good_standing_expiry", label: "COID Letter of Good Standing" },
  { field: "cidb_expiry", label: "CIDB grading" },
  { field: "sars_tcs_pin_expiry", label: "SARS Tax Compliance PIN" },
  { field: "pi_insurance_expiry", label: "Professional Indemnity insurance" },
  { field: "iso_9001_expiry", label: "ISO 9001 certificate" },
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
  { field: "bank_confirmation_letter_valid_until", label: "Bank confirmation letter", windowDays: 30 },
  { field: "bee_proof_expiry", label: "B-BBEE proof" },
];
