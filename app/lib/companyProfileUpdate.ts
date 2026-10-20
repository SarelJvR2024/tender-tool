import { BEE_PROOF_TYPES } from "./vaultDocuments";

/**
 * Fields the company edit form (app/company/page.tsx) and the onboarding
 * wizard's compliance step (app/onboarding, step 2) are both allowed to
 * write. Deliberately excludes any bank account number field - account
 * numbers live only in the restricted bank_accounts table (0050,
 * owners/admins only; 0001's own instruction), never on companies, and this
 * must not add one here. bank_confirmation_letter_valid_until is a generated
 * column (0014) and must never be written either.
 *
 * Shared, not duplicated: both callers import buildCompanyUpdate() so the
 * two places a company's own profile can be edited can never quietly drift
 * on which fields are allowed or how each is validated.
 */
export const COMPANY_TEXT_FIELDS = [
  "legal_name",
  "csd_trading_name",
  "cipc_registration_number",
  "vat_number",
  "income_tax_number",
  "paye_number",
  "csd_supplier_number",
  "coid_registration_number",
  "coid_letter_of_good_standing_number",
  "registered_address",
  "postal_address",
  "bank_name",
  "bank_branch_code",
  "status",
  "sars_tcs_pin",
  "pi_insurance_insurer",
  "pi_insurance_policy_number",
  "iso_9001_certificate_number",
  // SANRAL Form B3 head office (form-field audit 2026-10-18)
  "head_office",
] as const;

export const COMPANY_DATE_FIELDS = [
  "coid_letter_of_good_standing_expiry",
  "sars_tcs_pin_expiry",
  "pi_insurance_expiry",
  "iso_9001_expiry",
  "bank_confirmation_letter_date",
  "bee_proof_expiry",
] as const;

export const COMPANY_NUMERIC_FIELDS = [
  "bee_level",
  "black_ownership_pct",
  "bee_procurement_recognition_pct",
  "pi_insurance_cover_zar",
  // Form B3 counts: blank = null (not recorded), never 0 - see 0057.
  "other_offices",
  "ecsa_registered_staff_count",
  "sacpcmp_registered_staff_count",
  "total_employees",
  "typical_jv_share_pct",
] as const;

// Integer columns: a fractional count is refused rather than sent to Postgres.
const INTEGER_FIELDS = new Set(["other_offices", "ecsa_registered_staff_count", "sacpcmp_registered_staff_count", "total_employees", "bee_level"]);

const BEE_PROOF_VALUES = BEE_PROOF_TYPES.map((t) => t.value) as string[];

// Matches companies_how_we_work_length (0030).
export const HOW_WE_WORK_MAX_CHARS = 10000;

export type CompanyUpdate = Record<string, string | number | boolean | null>;

/**
 * Validates and shapes a `companies` update from form data - no Supabase
 * call, no redirect. Only fields actually present in the FormData are
 * touched (so a caller that only sends step-2's fields, like the onboarding
 * wizard, never nulls out everything else on the row). Returns `error` on
 * the first validation failure; the caller decides where that error is
 * shown (the company edit form redirects to /company, the wizard stays on
 * /onboarding).
 */
export function buildCompanyUpdate(formData: FormData): { update: CompanyUpdate; error: string | null } {
  const update: CompanyUpdate = {};

  for (const field of COMPANY_TEXT_FIELDS) {
    const raw = formData.get(field);
    if (raw === null) continue;
    const trimmed = (raw as string).trim();
    update[field] = trimmed === "" ? null : trimmed;
  }

  for (const field of COMPANY_DATE_FIELDS) {
    const raw = formData.get(field);
    if (raw === null) continue;
    const trimmed = (raw as string).trim();
    update[field] = trimmed === "" ? null : trimmed;
  }

  for (const field of COMPANY_NUMERIC_FIELDS) {
    const raw = formData.get(field);
    if (raw === null) continue;
    const trimmed = (raw as string).trim();
    const n = trimmed === "" ? null : Number(trimmed);
    if (n !== null && (!Number.isFinite(n) || n < 0 || (INTEGER_FIELDS.has(field) && !Number.isInteger(n)))) {
      return { update, error: `"${field.replace(/_/g, " ")}" must be a ${INTEGER_FIELDS.has(field) ? "whole " : ""}number of 0 or more.` };
    }
    update[field] = n;
  }

  // "How we work" (0030): the company's own words, stored as typed - only the
  // browser's CRLF line endings are normalised and the ends trimmed. Never
  // rewritten or summarised (docs/specs/Company-Voice-Audit.md).
  const howWeWork = formData.get("how_we_work");
  if (howWeWork !== null) {
    const text = (howWeWork as string).replace(/\r\n?/g, "\n").trim();
    if (text.length > HOW_WE_WORK_MAX_CHARS) {
      return { update, error: `"How we work" is ${text.length} characters - keep it under ${HOW_WE_WORK_MAX_CHARS}.` };
    }
    update.how_we_work = text === "" ? null : text;
  }

  // Tri-state: "" = not stated (null), never silently "not certified".
  const iso = formData.get("iso_9001_certified");
  if (iso !== null) update.iso_9001_certified = iso === "yes" ? true : iso === "no" ? false : null;

  const proof = formData.get("bee_proof_type");
  if (proof !== null) update.bee_proof_type = BEE_PROOF_VALUES.includes(proof as string) ? (proof as string) : null;

  return { update, error: null };
}
