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

// Same shape, same reason, as `registrations.ts`'s `needsHolderFallbackOption()`
// (Finding 177) and `dealEconomics.ts`'s `needsCreditFallbackOption()`
// (Finding 175): `people/[id]/page.tsx`'s manual "edit this person" form
// rendered `ecsa_level`/`highest_level` as a free-text `<input>` with no
// constraint to ECSA_LEVELS/QUALIFICATION_LEVELS at all - unlike this exact
// field pair's two other real consumers, `people/[id]/cv-review.tsx` and
// `my-cv/page.tsx` (both CV-extraction-confirm screens, the latter fixed by
// Finding 432 specifically for this gap), which already render a real
// `<select>` constrained to the exact SANRAL Form B2.1 label
// `engine/fill_conventional.py` requires. Switching the manual edit form to
// the same `<select>` needs this helper first: any value already on file
// that predates the fix (a free-text guess, an abbreviation like "Pr Eng")
// would otherwise be absent from the `<select>`'s own option list, so its
// `defaultValue` matches no `<option>` and the browser silently selects the
// first real option instead - `savePerson()` always writes this field
// fresh from the submitted value on every save, so saving ANY OTHER field
// on this form (e.g. just a phone number) would silently overwrite a real
// stored value with a different, wrong one. Call this before building the
// `<select>`'s options, and add a synthetic option for the current value
// when it returns true.
//
// Caution for whoever reads the paragraph above next: "my-cv/page.tsx
// (fixed by Finding 432...)" means that page's CV-extraction-review card
// only (applyMyCvExtraction()'s form) - this same page ALSO has its own
// separate manual "My details" edit form (saveMyDetails()), which Finding
// 432 never touched and which had this exact same free-text gap until
// Finding 467 gave it the same `<select>` + this same fallback helper. Don't
// re-read "my-cv/page.tsx: fixed" as "every form on my-cv/page.tsx: fixed".
export function needsSelectFallbackOption(value: string | null, options: readonly string[]): boolean {
  return !!value && !options.includes(value);
}

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

/**
 * Whether a proposed person field should start TICKED for save, on every
 * screen that lets a human confirm an AI-extracted CV field - shared so
 * people/[id]/cv-review.tsx (the full People page) and app/app/my-cv/page.tsx
 * (the employee self-service page, which reviews the exact same
 * cv_extraction_results.proposed rows) can never independently drift on this
 * decision.
 *
 * Ticked by default only when the value was traced to the CV text
 * (`verified` - extract_cv_fields.py's own quote-verification step) AND it
 * would not replace a different, non-empty value already on file - an
 * unverified/low-confidence guess (OCR uncertainty, a quote that couldn't be
 * found, a value outside a known dropdown list) or one that would silently
 * overwrite existing data needs a human to look at it first, never a
 * default "yes" (Verify/Provide/Fix - app/AGENTS.md).
 */
export function personFieldDefaultTick(p: ProposedValue, currentValue: string | null | undefined): boolean {
  const now = currentValue ?? null;
  const proposed = p.value ?? "";
  const same = now != null && now === proposed;
  const replaces = now != null && now !== "" && !same;
  return p.verified && !replaces && !same && proposed !== "";
}

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

// A bare 4-digit token that is also a plausible calendar year (1900-2099) is
// too weak to use as a project/contract-number match on its own: two
// genuinely different projects completed in the same year (common - a
// company often finishes several projects a year) would otherwise match on
// nothing but that shared year. A real contract/project number embeds extra
// characters around a year (e.g. "2024/15", "GG2024-01") and squashes to
// something longer than 4 characters, so it's unaffected by this exclusion -
// only an isolated, year-shaped token is dropped.
const BARE_YEAR = /^(?:19|20)\d{2}$/;

/**
 * Is a proposed project probably one already on file? Compares the contract /
 * project numbers (tokens with a digit, 4+ characters, excluding a bare
 * calendar year - see BARE_YEAR) and the whole client line, letters and
 * digits only. Used to leave a likely duplicate unticked on a re-upload,
 * never to hide it - so a weak/ambiguous signal (a shared year alone) must
 * never be treated as a match: that would risk silently leaving a genuinely
 * new project unticked, not just a real duplicate.
 */
function projectNumberTokens(clientAndNumber: string): string[] {
  return clientAndNumber
    .split(/[\s,;:()]+/)
    .filter((t) => /\d/.test(t) && t.replace(/[^a-z0-9]/gi, "").length >= 4)
    .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((n) => !BARE_YEAR.test(n));
}

export function looksLikeExistingProject(clientAndNumber: string, existing: string[]): boolean {
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const whole = squash(clientAndNumber);
  const numbers = projectNumberTokens(clientAndNumber);
  return existing.some((e) => {
    // An EXACT match against the existing line's own number tokens, not
    // "is this proposed number a substring of the whole squashed existing
    // line" - squash() strips every separator, including the one between
    // two unrelated tokens, so e.g. "N1-234/2019" squashes to "n12342019",
    // which contains "1234" purely by the coincidence of "N1" running into
    // "234" when concatenated - a genuinely unrelated proposed project whose
    // own contract number happens to be "1234" then false-matched against
    // it. Comparing extracted number tokens to extracted number tokens
    // keeps each one's own boundaries intact, closing that gap while
    // leaving every already-covered case (bare years, a real shared
    // embedded-year number, an identical whole line) unaffected.
    return squash(e) === whole || projectNumberTokens(e).some((exN) => numbers.includes(exN));
  });
}
