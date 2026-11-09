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

/**
 * Whether a company's SARS Tax Compliance Status PIN is genuinely "on file"
 * - a document was uploaded, OR the PIN itself was captured, OR an expiry
 * date was captured (lib/dates.ts's own documentStatus() hasFile rule for
 * this field - never just "a document path exists", since the PIN is
 * usually typed in, not uploaded). Was duplicated inline, identically, in
 * app/app/company/_components/ComplianceDocumentsSection.tsx and
 * ReadOnlyView.tsx; centralised here (standing review, 2026-11-09, Finding
 * 240) so a third caller - the dashboard's own setup checklist, which used
 * to read lib/documentExpiry.ts's date-ONLY `status` field instead and so
 * called a PIN "not on file" whenever only its expiry date hadn't been
 * captured yet - uses the exact same real rule rather than a second,
 * independently-drifted guess at it.
 */
export function sarsTcsPinOnFile(company: {
  sars_tcs_pin_document_path: string | null;
  sars_tcs_pin: string | null;
  sars_tcs_pin_expiry: string | null;
}): boolean {
  return !!company.sars_tcs_pin_document_path || !!company.sars_tcs_pin || !!company.sars_tcs_pin_expiry;
}

/** The fields {@link vaultDocumentOnFile} needs, across all 7 VAULT_DOCUMENTS kinds. */
export type VaultDocumentOnFileInput = {
  coid_letter_document_path: string | null;
  cidb_document_path: string | null;
  cidb_grading: string | null;
  cidb_expiry: string | null;
  sars_tcs_pin_document_path: string | null;
  sars_tcs_pin: string | null;
  sars_tcs_pin_expiry: string | null;
  pi_insurance_document_path: string | null;
  pi_insurance_policy_number: string | null;
  iso_9001_document_path: string | null;
  iso_9001_certified: boolean | null;
  bank_confirmation_letter_path: string | null;
  bank_confirmation_letter_date: string | null;
  bee_proof_document_path: string | null;
  bee_level: number | null;
};

/**
 * Whether a given VAULT_DOCUMENTS kind is genuinely "on file" for a company -
 * a document was uploaded, OR (for the 5 kinds whose compliance fact is
 * sometimes typed in directly through EditForm.tsx instead of uploaded) the
 * matching text/level/date field was captured. Mirrors the per-kind hasFile
 * booleans app/app/company/_components/ComplianceDocumentsSection.tsx and
 * ReadOnlyView.tsx already compute inline for their own per-document status
 * chips - duplicated identically in both those files.
 *
 * Centralised here (standing review, 2026-11-09, Finding 249) because a
 * third site, this page's own VaultProgressSummary count
 * (app/app/company/page.tsx's `documentsOnFile`), used a path-only check for
 * all 7 kinds instead - so a company that had typed in (not uploaded) its
 * CIDB grading, SARS PIN, PI policy number, bank letter date or B-BBEE level
 * saw that count silently disagree with the compliance section rendered
 * directly below it on the exact same page: e.g. "0 of 7 on file - 7 still
 * missing, add them" right above a section correctly showing 5 of those same
 * 7 as valid. The identical "these surfaces can't quietly disagree" bug
 * class as Findings 240-243 (lib/readiness.ts), found independently here.
 */
export function vaultDocumentOnFile(kind: VaultDocumentKind, company: VaultDocumentOnFileInput): boolean {
  switch (kind) {
    case "coid":
      return company.coid_letter_document_path !== null;
    case "cidb":
      return company.cidb_document_path !== null || !!company.cidb_grading || !!company.cidb_expiry;
    case "sars_tcs_pin":
      return sarsTcsPinOnFile(company);
    case "pi_insurance":
      return company.pi_insurance_document_path !== null || !!company.pi_insurance_policy_number;
    case "iso_9001":
      // Matches isoStatus in ComplianceDocumentsSection.tsx/ReadOnlyView.tsx:
      // certified === false ("Not certified") and certified === null ("Not
      // stated") both render with the same muted "not on file" tone there,
      // so both are "not on file" here too - only a genuinely certified
      // company with its certificate actually uploaded counts.
      return company.iso_9001_certified === true && company.iso_9001_document_path !== null;
    case "bank_letter":
      return company.bank_confirmation_letter_path !== null || !!company.bank_confirmation_letter_date;
    case "bee_proof":
      return company.bee_proof_document_path !== null || !!company.bee_level;
  }
}
