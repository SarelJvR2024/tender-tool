// Bulk onboarding document scan (migration 0063): shared constants/types for
// the upload page, the review screen and their server actions.
//
// v1 document kinds and where a confirmed one is actually routed - the
// single most important list in this feature, since the whole point is
// "no new generic document-type storage model": every kind below writes to
// an EXISTING table/column. The two kinds NOT in ROUTABLE_KINDS are
// deliberately never auto-filed (see each action's own comment for why).
export const ONBOARDING_BUCKET = "onboarding-documents";

export const DOCUMENT_KINDS = [
  "cidb_registration", "bbbee_certificate", "sars_tax_clearance", "id_document", "cv",
  "bank_confirmation_letter", "pi_insurance_certificate", "iso_9001_certificate",
  "experience_reference_letter", "professional_registration_other", "unknown",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const KIND_LABELS: Record<DocumentKind, string> = {
  cidb_registration: "CIDB registration / grading certificate",
  bbbee_certificate: "B-BBEE certificate or sworn affidavit",
  sars_tax_clearance: "SARS tax compliance status (TCS) PIN letter",
  id_document: "Identity document / certified ID copy",
  cv: "CV (curriculum vitae)",
  bank_confirmation_letter: "Bank confirmation letter",
  pi_insurance_certificate: "Professional indemnity insurance",
  iso_9001_certificate: "ISO 9001 certificate",
  experience_reference_letter: "Project / experience reference letter",
  professional_registration_other: "Other professional registration (ECSA, SACPCMP, PSIRA, ...)",
  unknown: "Not recognised",
};

// Routes to companies.cidb_grading/cidb_expiry/cidb_document_path - NOT
// held_registrations (0050's own seed row for 'cidb' sets stored_in, which
// the held_registrations trigger refuses - see migration 0063's header).
export const ROUTABLE_KINDS: DocumentKind[] = [
  "cidb_registration", "bbbee_certificate", "sars_tax_clearance", "id_document", "cv",
  "bank_confirmation_letter", "pi_insurance_certificate", "iso_9001_certificate",
  "experience_reference_letter",
];

// Deliberately never auto-filed (task scope + ECSA/SACPCMP/PSIRA etc. have
// dedicated, higher-stakes per-person UI). Shown as "needs manual review".
export const UNROUTED_KINDS: DocumentKind[] = ["professional_registration_other", "unknown"];

export const MANUAL_REVIEW_LINK: Partial<Record<DocumentKind, { href: string; label: string }>> = {
  professional_registration_other: { href: "/company/registrations", label: "Add it on Registrations, licences & accreditations" },
  unknown: { href: "/company", label: "Review the Company profile pages" },
};

// id_document and cv both need the reviewer to pick WHO the document
// belongs to before it can be filed - there is no way to know which
// director or which person's CV this is from the document alone.
export const NEEDS_TARGET_PICKER: DocumentKind[] = ["id_document", "cv"];

export type FieldProposal = { value: string | number | null; evidence: string | null; verified: boolean; warnings: string[] };
export type OnboardingFields = Record<string, FieldProposal>;

// Mirrors engine/onboarding/classify_documents.py's KIND_FIELDS/DATE_FIELDS/
// NUMBER_FIELDS exactly - kept here too (not imported, Python/TS can't
// share a module) so the review screen knows how to render/edit each field
// without re-deriving it from the proposal alone.
export const KIND_FIELDS: Record<DocumentKind, string[]> = {
  cidb_registration: ["registration_number", "grade_class", "expiry_date", "contractor_name"],
  bbbee_certificate: ["bee_level", "proof_type", "expiry_date", "entity_name"],
  sars_tax_clearance: ["pin", "expiry_date"],
  id_document: ["full_name", "id_number"],
  cv: [],
  bank_confirmation_letter: ["bank_name", "account_holder", "letter_date"],
  pi_insurance_certificate: ["insurer", "policy_number", "cover_zar", "expiry_date"],
  iso_9001_certificate: ["certificate_number", "expiry_date", "certified_entity_name"],
  experience_reference_letter: [
    "client_name", "project_name", "contract_number", "project_value_rm",
    "completion_date", "referee_name", "referee_phone", "referee_email",
  ],
  professional_registration_other: ["body", "holder_name", "registration_number", "expiry_date"],
  unknown: [],
};
export const FIELD_LABELS: Record<string, string> = {
  registration_number: "Registration number", grade_class: "Grade / class", expiry_date: "Expiry date",
  contractor_name: "Contractor name", bee_level: "B-BBEE status level", proof_type: "Proof type",
  entity_name: "Entity name", pin: "SARS TCS PIN", full_name: "Full name", id_number: "ID number",
  bank_name: "Bank", account_holder: "Account holder", letter_date: "Letter date", insurer: "Insurer",
  policy_number: "Policy number", cover_zar: "Cover (R)", certificate_number: "Certificate number",
  certified_entity_name: "Certified entity", client_name: "Client", project_name: "Project name",
  contract_number: "Contract number", project_value_rm: "Value (R million)", completion_date: "Completion date",
  referee_name: "Referee name", referee_phone: "Referee phone", referee_email: "Referee email",
  body: "Professional body", holder_name: "Holder name",
};
export const DATE_FIELDS = new Set(["expiry_date", "letter_date", "completion_date"]);
export const NUMBER_FIELDS = new Set(["cover_zar", "project_value_rm"]);
// id_number is matched locally (never written to/edited via the model's
// fields) - shown read-only on the review screen, not as an editable row.
export const READ_ONLY_FIELDS = new Set(["id_number"]);

// ---------------------------------------------------------------------------
// Routing-to-existing-table mapping for the "vault column" kinds
// (confirmVaultDocument in actions.ts; see that file for the other three
// routed kinds - experience_reference_letter/id_document/cv, each with its
// own table and its own shape, not a column map). Pure data/functions so
// the mapping itself (not the Supabase/redirect plumbing around it) is
// unit-testable - see onboardingScan.test.ts.
//
// cidb_registration routes to companies.cidb_* (NOT held_registrations - a
// correction from the task's own v1 mapping; see migration 0063's header
// for why held_registrations refuses a CIDB row outright).
//
// registration_number/contractor_name (cidb_registration), entity_name
// (bbbee_certificate), bank_name/account_holder (bank_confirmation_letter)
// and certified_entity_name (iso_9001_certificate) used to have no column
// at all (QA-Edge-Case-Findings.md, thirteenth run / commit 2d4c124) - they
// were read from the document but silently dropped on confirm. Migration
// 0069 added the six columns below so they now actually persist.
// ---------------------------------------------------------------------------

export const VAULT_FIELD_COLUMNS: Record<string, Record<string, string>> = {
  cidb_registration: {
    grade_class: "cidb_grading", expiry_date: "cidb_expiry",
    registration_number: "cidb_registration_number", contractor_name: "cidb_contractor_name",
  },
  bbbee_certificate: {
    proof_type: "bee_proof_type", expiry_date: "bee_proof_expiry", entity_name: "bee_entity_name",
  },
  sars_tax_clearance: { pin: "sars_tcs_pin", expiry_date: "sars_tcs_pin_expiry" },
  bank_confirmation_letter: {
    letter_date: "bank_confirmation_letter_date",
    bank_name: "bank_confirmation_bank_name", account_holder: "bank_confirmation_account_holder",
  },
  pi_insurance_certificate: {
    insurer: "pi_insurance_insurer", policy_number: "pi_insurance_policy_number",
    cover_zar: "pi_insurance_cover_zar", expiry_date: "pi_insurance_expiry",
  },
  iso_9001_certificate: {
    certificate_number: "iso_9001_certificate_number", expiry_date: "iso_9001_expiry",
    certified_entity_name: "iso_9001_certified_entity_name",
  },
};
export const VAULT_DOCUMENT_COLUMN: Record<string, string> = {
  cidb_registration: "cidb_document_path",
  bbbee_certificate: "bee_proof_document_path",
  sars_tax_clearance: "sars_tcs_pin_document_path",
  bank_confirmation_letter: "bank_confirmation_letter_path",
  pi_insurance_certificate: "pi_insurance_document_path",
  iso_9001_certificate: "iso_9001_document_path",
};
export const VAULT_SUBFOLDER: Record<string, string> = {
  cidb_registration: "cidb", bbbee_certificate: "bee_proof", sars_tax_clearance: "sars_tcs_pin",
  bank_confirmation_letter: "bank_letter", pi_insurance_certificate: "pi_insurance", iso_9001_certificate: "iso_9001",
};
export const VAULT_KINDS = Object.keys(VAULT_FIELD_COLUMNS) as DocumentKind[];

// Every KIND_FIELDS entry for a vault kind now has a real column (migration
// 0069 closed the last gap - see VAULT_FIELD_COLUMNS's own comment above).
// actions.ts's confirmVaultDocument only ever writes a VAULT_FIELD_COLUMNS[kind]
// column, plus the one special case below (bee_level, applied separately
// because companies.bee_level is a plain int column, not part of the
// field-name-to-column map). isFieldPersisted() stays as the single source
// of truth review.tsx uses to split tick-able/saved fields from anything
// not in this map - kept so a future field the model is asked for but that
// still has nowhere to go (or a column later removed) fails this check
// honestly instead of silently.
const PERSISTED_EXTRA_FIELDS: Partial<Record<DocumentKind, string[]>> = {
  bbbee_certificate: ["bee_level"],
};

export function isFieldPersisted(kind: DocumentKind, field: string): boolean {
  if (VAULT_FIELD_COLUMNS[kind] && field in VAULT_FIELD_COLUMNS[kind]) return true;
  return (PERSISTED_EXTRA_FIELDS[kind] ?? []).includes(field);
}

/** bee_level comes back from the model as text ("Level 2"); companies.bee_level is an int. */
export function parseBeeLevel(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(/\d+/);
  return m ? Number(m[0]) : null;
}

// ---------------------------------------------------------------------------
// CIDB contractor-name mismatch signal (QA-Edge-Case-Findings.md, thirteenth
// run / commit 2d4c124: "a mismatched contractor_name on a CIDB certificate
// is a real compliance signal, not just metadata"). A company could have
// uploaded someone else's certificate, or its registered name could have
// changed since the certificate was issued - either way, worth surfacing on
// the review screen, never blocking: a trading name or a recent, legitimate
// rename are both plausible innocent explanations, so this is a warning for
// a human to weigh, not a validation error.
//
// Comparison is deliberately not byte-exact: legal-suffix formatting
// ("(Pty) Ltd" vs "Pty Ltd" vs missing entirely, "CC", punctuation,
// capitalisation) varies constantly between a certificate and a company's
// own records without meaning anything. Strip that noise, then compare; if
// the names still share no real overlap, warn.
// ---------------------------------------------------------------------------

const LEGAL_SUFFIX_WORDS = new Set([
  "pty", "proprietary", "ltd", "limited", "cc", "close", "corporation",
  "inc", "incorporated", "co", "company",
]);

function normalizeCompanyName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[().,]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !LEGAL_SUFFIX_WORDS.has(w))
    .join(" ")
    .trim();
}

/**
 * Returns a human-readable warning when a CIDB certificate's contractor
 * name looks substantially different from the company's own registered
 * legal_name, or null when they match closely enough (including a
 * formatting-only difference such as a missing/extra "(Pty) Ltd"). Never
 * throws, never warns on missing input (nothing to compare).
 */
export function cidbNameMismatchWarning(contractorName: string | null, legalName: string | null): string | null {
  const a = normalizeCompanyName(contractorName ?? "");
  const b = normalizeCompanyName(legalName ?? "");
  if (!a || !b) return null;
  if (a === b) return null;

  const aWords = new Set(a.split(" ").filter(Boolean));
  const bWords = new Set(b.split(" ").filter(Boolean));
  const shared = [...aWords].filter((w) => bWords.has(w)).length;
  const union = new Set([...aWords, ...bWords]).size;
  const overlap = union === 0 ? 1 : shared / union;
  if (overlap >= 0.6) return null; // close enough - formatting / word-order / minor difference

  return `The CIDB certificate's contractor name ("${contractorName}") doesn't closely match your company's registered legal name ("${legalName}"). This could mean the certificate belongs to a different entity, or your registered name has changed since it was issued - check before confirming (a trading name is also a valid reason).`;
}

export { safeFileName } from "./safeFileName";

export function uploadPrefix(companyId: string): string {
  return `${companyId}/`;
}

// Supabase Storage's default per-file limit on the direct-upload path (same
// as app/lib/manualTender.ts's MAX_TENDER_FILE_BYTES) - these go straight
// from the browser to Storage, never through a Server Action, so the
// Vercel 4.5 MB body cap (app/lib/vaultDocuments.ts's MAX_UPLOAD_BYTES)
// doesn't apply here.
export const MAX_ONBOARDING_FILE_BYTES = 25 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = [".pdf", ".docx", ".doc", ".png", ".jpg", ".jpeg"];

export function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
