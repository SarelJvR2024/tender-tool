// Extracted out of lib/notifications.ts (2026-10-27) so a standalone script
// run via `node --experimental-strip-types` can import this constant
// without going through notifications.ts's own extensionless relative
// import ("./dates") - direct node execution can't resolve that (confirmed
// live: ERR_MODULE_NOT_FOUND), the exact limitation lib/deadlineReminders.ts's
// own header comment already documents and works around for the identical
// reason. Zero imports here on purpose, so this file is always safely
// importable from either context. notifications.ts re-exports this for its
// own existing callers - nobody needs to change their import.
export const COMPANY_EXPIRY_FIELDS: { field: string; label: string }[] = [
  { field: "coid_letter_of_good_standing_expiry", label: "COID Letter of Good Standing" },
  { field: "cidb_expiry", label: "CIDB grading" },
  { field: "sars_tcs_pin_expiry", label: "SARS Tax Compliance PIN" },
  { field: "pi_insurance_expiry", label: "Professional Indemnity insurance" },
  { field: "iso_9001_expiry", label: "ISO 9001 certificate" },
  { field: "bank_confirmation_letter_valid_until", label: "Bank confirmation letter" },
  { field: "bee_proof_expiry", label: "B-BBEE proof" },
];
