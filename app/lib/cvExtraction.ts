/**
 * Shapes and field metadata for the CV AI-extraction review step (migration
 * 0023, engine/cv/extract_cv_fields.py). The People page shows these as
 * "current vs proposed" and app/app/people/actions.ts applyCvExtraction()
 * writes only what the reviewer ticks.
 *
 * Keep the two option lists identical to ECSA_LEVELS / QUALIFICATION_LEVELS in
 * engine/cv/extract_cv_fields.py: they are SANRAL's own Form B2.1 dropdown
 * labels (read from the real R.396-010-2025/1F workbook), and
 * engine/fill_conventional.py refuses any other label when it fills a pack.
 */

export const ECSA_LEVELS = [
  "Professional Engineer",
  "Professional Engineering Technologist",
  "Professional Certificated Engineer",
  "Professional Engineering Technician",
  "Candidate Engineer",
  "Candidate Engineering Technologist",
  "Candidate Certificated Engineer",
  "Candidate Engineering Technician",
  "Unregistered",
] as const;

export const QUALIFICATION_LEVELS = [
  "Higher Certificates and Advanced National (vocational) Cert.",
  "Diploma and Advanced certificates",
  "Bachelors Degree and Advanced Diplomas",
  "Honours, Post Grad diploma and Professional Qualifications",
  "Masters Degree",
  "Doctoral Degree",
  "National Senior Certificate and National (vocational) Cert. level 4",
] as const;

export type ExtractedFieldKind = "text" | "date" | "select" | "secret";

export type ExtractedPersonField = {
  key: string;
  label: string;
  kind: ExtractedFieldKind;
  options?: readonly string[];
  group: "Identity" | "Registrations" | "Qualifications";
};

// people columns the extraction step may propose (0001_init_schema.sql).
export const EXTRACTED_PERSON_FIELDS: ExtractedPersonField[] = [
  { key: "name", label: "Full name", kind: "text", group: "Identity" },
  { key: "id_number", label: "ID number", kind: "secret", group: "Identity" },
  { key: "role", label: "Role / job title", kind: "text", group: "Identity" },
  { key: "phone", label: "Phone", kind: "text", group: "Identity" },
  { key: "email", label: "Email", kind: "text", group: "Identity" },
  { key: "ecsa_level", label: "ECSA level", kind: "select", options: ECSA_LEVELS, group: "Registrations" },
  { key: "ecsa_number", label: "ECSA number", kind: "text", group: "Registrations" },
  { key: "ecsa_date", label: "ECSA registration date", kind: "date", group: "Registrations" },
  { key: "sacpcmp_number", label: "SACPCMP number", kind: "text", group: "Registrations" },
  { key: "sacpcmp_date", label: "SACPCMP registration date", kind: "date", group: "Registrations" },
  { key: "highest_level", label: "Highest qualification level", kind: "select", options: QUALIFICATION_LEVELS, group: "Qualifications" },
  { key: "highest_description", label: "Highest qualification", kind: "text", group: "Qualifications" },
  { key: "highest_institution", label: "Institution (highest)", kind: "text", group: "Qualifications" },
  { key: "highest_graduated", label: "Date graduated (highest)", kind: "date", group: "Qualifications" },
  { key: "initial_description", label: "Initial qualification", kind: "text", group: "Qualifications" },
  { key: "initial_institution", label: "Institution (initial)", kind: "text", group: "Qualifications" },
  { key: "initial_graduated", label: "Date graduated (initial)", kind: "date", group: "Qualifications" },
];

export const EXTRACTED_PROJECT_FIELDS = [
  "client_and_number",
  "position_held",
  "value_rm",
  "start_date",
  "end_date",
  "contact_name",
  "contact_phone",
  "contact_email",
] as const;

export type ProposedValue = {
  value: string | null;
  evidence: string | null;
  verified: boolean;
  warnings: string[];
};

export type ProposedProject = {
  client_and_number: string;
  position_held: string | null;
  value_rm: number | null;
  start_date: string | null;
  end_date: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  evidence: string | null;
  verified: boolean;
  warnings: string[];
};

export type Proposal = {
  document_kind: string | null;
  person: Record<string, ProposedValue>;
  projects: ProposedProject[];
  other_registrations: { body: string; level: string | null; number: string | null; evidence: string; verified?: boolean }[];
};

export type CvExtractionResult = {
  id: string;
  cv_upload_id: string;
  proposed: Proposal;
  warnings: string[];
  text_method: string | null;
  source_pages: number | null;
  model: string | null;
  created_at: string;
};

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is a proposed project probably one already on file? Compares the contract /
 * project numbers (tokens with a digit, 4+ characters) and the whole client
 * line, letters and digits only. Used to leave a likely duplicate unticked on
 * a re-upload, never to hide it.
 */
export function looksLikeExistingProject(clientAndNumber: string, existing: string[]): boolean {
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const whole = squash(clientAndNumber);
  const numbers = clientAndNumber
    .split(/[\s,;:()]+/)
    .filter((t) => /\d/.test(t) && t.replace(/[^a-z0-9]/gi, "").length >= 4)
    .map(squash);
  return existing.some((e) => {
    const ex = squash(e);
    return ex === whole || numbers.some((n) => ex.includes(n));
  });
}
