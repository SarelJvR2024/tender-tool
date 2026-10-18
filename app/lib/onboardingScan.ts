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
// ---------------------------------------------------------------------------

export const VAULT_FIELD_COLUMNS: Record<string, Record<string, string>> = {
  cidb_registration: { grade_class: "cidb_grading", expiry_date: "cidb_expiry" },
  bbbee_certificate: { proof_type: "bee_proof_type", expiry_date: "bee_proof_expiry" },
  sars_tax_clearance: { pin: "sars_tcs_pin", expiry_date: "sars_tcs_pin_expiry" },
  bank_confirmation_letter: { letter_date: "bank_confirmation_letter_date" },
  pi_insurance_certificate: {
    insurer: "pi_insurance_insurer", policy_number: "pi_insurance_policy_number",
    cover_zar: "pi_insurance_cover_zar", expiry_date: "pi_insurance_expiry",
  },
  iso_9001_certificate: { certificate_number: "iso_9001_certificate_number", expiry_date: "iso_9001_expiry" },
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

// Some KIND_FIELDS are read from the document but have no dedicated
// companies column to persist to (e.g. a CIDB certificate's registration
// number/contractor name, a B-BBEE certificate's entity name, a bank
// letter's bank name/account holder - there is no companies.cidb_
// registration_number etc.). actions.ts's confirmVaultDocument only ever
// writes a VAULT_FIELD_COLUMNS[kind] column, plus the one special case
// below (bee_level, applied separately because companies.bee_level is a
// plain int column, not part of the field-name-to-column map). Before this
// was tracked explicitly, the review screen showed every KIND_FIELDS entry
// with the same tick-box and "Confirm and file" button regardless of
// whether ticking it did anything - a reviewer had no way to tell that
// ticking "Registration number" and confirming silently filed the document
// but dropped that one value. review.tsx uses this to show the gap
// honestly: fields that are actually saved get a tick-box, fields that
// aren't are shown read-only with a "not saved" note.
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

export function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._ ()-]/g, "_").slice(0, 120) || "document";
}

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
