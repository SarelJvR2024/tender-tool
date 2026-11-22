/**
 * First test file for buildCompanyUpdate() (none existed before this).
 * Added alongside the real fix, 2026-10-29: CIDB registration (grading,
 * expiry, registration number, contractor name) existed on `companies` and
 * was already read everywhere (ComplianceDocumentsSection, BeeCidbSection)
 * but had no manual-entry path at all - unlike every sibling document type
 * on this page (COID/SARS/PI/ISO/BEE), which were all already editable.
 *
 * Run: npx vitest run lib/companyProfileUpdate.spec.ts
 */
import { describe, expect, it } from "vitest";
import { buildCompanyUpdate, COMPANY_DATE_FIELDS, COMPANY_TEXT_FIELDS } from "./companyProfileUpdate";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("buildCompanyUpdate", () => {
  it("CIDB fields are now accepted - real gap this pass closed (previously not in either allowlist)", () => {
    expect(COMPANY_TEXT_FIELDS).toContain("cidb_grading");
    expect(COMPANY_TEXT_FIELDS).toContain("cidb_registration_number");
    expect(COMPANY_TEXT_FIELDS).toContain("cidb_contractor_name");
    expect(COMPANY_DATE_FIELDS).toContain("cidb_expiry");
  });

  it("writes CIDB grading/registration number/contractor name/expiry straight through, same shape as every other text/date field", () => {
    const { update, error } = buildCompanyUpdate(
      form({
        cidb_grading: "7CE",
        cidb_registration_number: "123456",
        cidb_contractor_name: "Mzansi Roads & Civils (Pty) Ltd",
        cidb_expiry: "2027-06-30",
      }),
    );
    expect(error).toBeNull();
    expect(update.cidb_grading).toBe("7CE");
    expect(update.cidb_registration_number).toBe("123456");
    expect(update.cidb_contractor_name).toBe("Mzansi Roads & Civils (Pty) Ltd");
    expect(update.cidb_expiry).toBe("2027-06-30");
  });

  it("a blank CIDB field is written as null, not an empty string, same as every other optional field", () => {
    const { update, error } = buildCompanyUpdate(form({ cidb_grading: "  " }));
    expect(error).toBeNull();
    expect(update.cidb_grading).toBeNull();
  });

  it("a field not present in the submitted FormData at all is left untouched (never nulls out the rest of the row)", () => {
    const { update, error } = buildCompanyUpdate(form({ legal_name: "Mzansi Roads & Civils (Pty) Ltd" }));
    expect(error).toBeNull();
    expect(update.legal_name).toBe("Mzansi Roads & Civils (Pty) Ltd");
    expect("cidb_grading" in update).toBe(false);
  });

  // Finding 505 (standing QA/robustness review, 2026-11-22): every one of
  // the 7 COMPANY_DATE_FIELDS (this file's own EditForm.tsx and the
  // onboarding wizard's compliance step both submit these as real `type=
  // "date"` inputs) had NO server-side format check at all, unlike the
  // identical-shaped `type="date"` fields `people/actions.ts`/`my-cv/
  // actions.ts` already guard (Findings 466/478-483) - a Server Action must
  // never trust the browser's own constraint alone. A non-ISO value
  // bypassing the browser reached Postgres's own `date`-typed column
  // unchecked, which then fails the write with a raw DB error the real
  // Server Action (updateCompanyProfile()) shows as "Your company profile
  // is no longer there - refresh and try again" - the exact "fails, but
  // late and unhelpfully" shape this whole lineage already treats as worth
  // fixing, not merely cosmetic.
  describe("COMPANY_DATE_FIELDS format check (Finding 505)", () => {
    it("refuses a malformed cidb_expiry instead of letting it reach the database unchecked", () => {
      const { update, error } = buildCompanyUpdate(form({ cidb_expiry: "31/12/2027" }));
      expect(error).toBe('CIDB registration expiry: "31/12/2027" isn\'t a date (yyyy-mm-dd).');
      expect("cidb_expiry" in update).toBe(false);
    });

    it("refuses a malformed value on EVERY one of the 7 date fields, not just one", () => {
      for (const field of COMPANY_DATE_FIELDS) {
        const { error } = buildCompanyUpdate(form({ [field]: "not-a-date" }));
        expect(error, `${field} should be refused`).toContain('isn\'t a date (yyyy-mm-dd)');
      }
    });

    it("still accepts a genuinely valid yyyy-mm-dd date on every one of the 7 fields", () => {
      for (const field of COMPANY_DATE_FIELDS) {
        const { update, error } = buildCompanyUpdate(form({ [field]: "2027-06-30" }));
        expect(error, `${field} should not be refused`).toBeNull();
        expect(update[field]).toBe("2027-06-30");
      }
    });

    it("still allows leaving a date field blank (written as null, same as before this fix)", () => {
      const { update, error } = buildCompanyUpdate(form({ bank_confirmation_letter_date: "  " }));
      expect(error).toBeNull();
      expect(update.bank_confirmation_letter_date).toBeNull();
    });
  });
});
