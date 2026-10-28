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

// Real incident, 2026-10-28 (Reviewer Civils & Consulting): a file literally
// named "...BBBEE_Affidavit.docx" was uploaded into the 'coid' slot, and a
// real pack-generation run merged it into the pack labelled as the COID
// Letter of Good Standing. uploadVaultDocument() has no way to read a
// document's actual text (this app has no PDF/DOCX parser - that's
// engine/general/requirements.py's job, in Python, run async by the bridge
// worker, never synchronously inside a Server Action) - the filename is the
// one signal already on hand with zero new parsing infrastructure, and it
// would have caught this exact case. Each kind gets `reject` (filenames that
// clearly belong to a DIFFERENT compliance document) and/or `expect`
// (filenames a real document of this kind should actually contain) - coid
// only had a `reject` list in the original brief; `expect` keywords are
// added here for it too, by the same pattern bee_proof/sars_tcs_pin already
// use, not a weaker check than theirs.
const VAULT_MISMATCH_KEYWORDS: Partial<Record<VaultDocumentKind, { reject?: { words: string[]; looksLike: string }; expect?: string[] }>> = {
  coid: {
    reject: { words: ["bbbee", "b-bbee", "bee", "affidavit", "broad-based", "broadbased"], looksLike: "a B-BBEE Affidavit" },
    expect: ["coid", "compensation", "good standing", "letter of good standing"],
  },
  bee_proof: {
    expect: ["bee", "bbbee", "b-bbee", "affidavit", "sanas", "broad-based", "broadbased"],
  },
  sars_tcs_pin: {
    expect: ["tax", "sars", "pin", "tcs", "compliance"],
  },
};

/**
 * Filename-only heuristic (see VAULT_MISMATCH_KEYWORDS's own comment for
 * why) - a non-blocking warning, never a hard refusal: a real document can
 * be named anything, so this only ever prompts a human to double check, the
 * same "are you sure" pattern ConfirmSubmitButton already uses elsewhere in
 * this app, never a silent rejection of a correctly-chosen file.
 */
export function vaultDocumentMismatchWarning(kind: VaultDocumentKind, filename: string): string | null {
  const rule = VAULT_MISMATCH_KEYWORDS[kind];
  if (!rule) return null;
  const name = filename.toLowerCase();
  if (rule.reject && rule.reject.words.some((w) => name.includes(w))) {
    return `This document appears to be ${rule.reject.looksLike}, not ${VAULT_DOCUMENTS[kind].label}.`;
  }
  if (rule.expect && !rule.expect.some((w) => name.includes(w))) {
    return `This file's name doesn't look like ${VAULT_DOCUMENTS[kind].label} - check you picked the right file.`;
  }
  return null;
}

// The bank letter is "usable" for 3 months from its date (derived column
// bank_confirmation_letter_valid_until), so a 60-day "renew soon" window would
// turn it amber a month after issue. 30 days is used for it everywhere: the
// vault badge, and engine/compliance/watch_deadlines.py's per-field lead time.
export const BANK_LETTER_RENEW_SOON_DAYS = 30;
