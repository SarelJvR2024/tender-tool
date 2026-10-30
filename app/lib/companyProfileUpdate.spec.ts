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
});
