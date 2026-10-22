// Document Vault uploads (migration 0014_vault_compliance_documents.sql).
// One uploaded copy per compliance document, stored in the private
// 'company-documents' bucket at "<company_id>/vault/<kind>/<uuid>-<filename>",
// with the path kept in the matching companies.*_path column - same
// "store the path, never the file" rule as experience_items.storage_path.

export const VAULT_BUCKET = "company-documents";

export const VAULT_DOCUMENTS = {
  coid: { column: "coid_letter_document_path", label: "COID Letter of Good Standing" },
  cidb: { column: "cidb_document_path", label: "CIDB registration/grading certificate" },
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

// Spec v3 Batch 2: which of these a row can upload through the shared
// AI-classify-and-review pipeline (onboardingScan.ts's DocumentKind) instead
// of a blind direct-to-column overwrite. Deliberately 6 of 7, not all 7:
// 'coid' (COID Letter of Good Standing) has no DOCUMENT_KINDS entry in
// onboardingScan.ts/classify_documents.py at all - adding one means teaching
// the Python classifier a new kind plus a new document_kind check-constraint
// value (migration 0063), which is exactly the schema/engine change this
// batch's own ground rules leave for a separate, explicitly-approved pass.
// 'coid' keeps its original direct-upload form (DocumentRow.tsx) unchanged;
// everything else routes through VaultDocumentUploader instead.
export const VAULT_KIND_TO_DOCUMENT_KIND: Partial<Record<VaultDocumentKind, string>> = {
  cidb: "cidb_registration",
  sars_tcs_pin: "sars_tax_clearance",
  pi_insurance: "pi_insurance_certificate",
  iso_9001: "iso_9001_certificate",
  bank_letter: "bank_confirmation_letter",
  bee_proof: "bbbee_certificate",
};

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
