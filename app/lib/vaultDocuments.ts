// Document Vault uploads (migration 0014_vault_compliance_documents.sql).
// One uploaded copy per compliance document, stored in the private
// 'company-documents' bucket at "<company_id>/vault/<kind>/<uuid>-<filename>",
// with the path kept in the matching companies.*_path column - same
// "store the path, never the file" rule as experience_items.storage_path.

export const VAULT_BUCKET = "company-documents";

export const VAULT_DOCUMENTS = {
  coid: { column: "coid_letter_document_path", label: "COID Letter of Good Standing" },
  sars_tcs_pin: { column: "sars_tcs_pin_document_path", label: "SARS Tax Compliance Status PIN letter" },
  pi_insurance: { column: "pi_insurance_document_path", label: "Professional indemnity insurance schedule" },
  iso_9001: { column: "iso_9001_document_path", label: "ISO 9001 certificate" },
  bank_letter: { column: "bank_confirmation_letter_path", label: "Bank confirmation letter" },
  bee_proof: { column: "bee_proof_document_path", label: "B-BBEE certificate or sworn affidavit" },
} as const;

export type VaultDocumentKind = keyof typeof VAULT_DOCUMENTS;

export function isVaultDocumentKind(v: string | null): v is VaultDocumentKind {
  return !!v && Object.prototype.hasOwnProperty.call(VAULT_DOCUMENTS, v);
}

// Largest file the vault upload accepts. Server Actions run as a Vercel
// Function, whose request body is hard-capped at 4.5 MB (413
// FUNCTION_PAYLOAD_TOO_LARGE); next.config.ts sets bodySizeLimit to that cap,
// and this leaves room for the multipart overhead around the file.
export const MAX_UPLOAD_BYTES = 4.4 * 1024 * 1024;

export const BEE_PROOF_TYPES = [
  { value: "certificate", label: "B-BBEE verification certificate (SANAS)" },
  { value: "qse_affidavit", label: "QSE sworn affidavit" },
  { value: "eme_affidavit", label: "EME sworn affidavit" },
] as const;
export type BeeProofType = (typeof BEE_PROOF_TYPES)[number]["value"];

export function beeProofLabel(v: string | null): string | null {
  return BEE_PROOF_TYPES.find((t) => t.value === v)?.label ?? null;
}

/** "<company>/vault/<kind>/<uuid>-<name>" -> "<name>" */
export function filenameFromPath(path: string | null): string | null {
  if (!path) return null;
  const last = path.split("/").pop() ?? path;
  return last.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}

// The bank letter is "usable" for 3 months from its date (derived column
// bank_confirmation_letter_valid_until), so a 60-day "renew soon" window would
// turn it amber a month after issue. 30 days is used for it everywhere: the
// vault badge, and engine/compliance/watch_deadlines.py's per-field lead time.
export const BANK_LETTER_RENEW_SOON_DAYS = 30;
