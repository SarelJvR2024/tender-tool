import { describe, expect, it } from "vitest";
import { complianceExpiryCandidates, COMPLIANCE_EXPIRY_FIELDS, COMPLIANCE_EXPIRY_THRESHOLD_DAYS, type ComplianceExpiryCompanyRow } from "./complianceExpiryReminders";

describe("COMPLIANCE_EXPIRY_FIELDS", () => {
  it("covers SARS PIN and COIDA - the two fields this schema actually stores an expiry date for, not CSD (no expiry column exists for it)", () => {
    expect(COMPLIANCE_EXPIRY_FIELDS.map((f) => f.field).sort()).toEqual(["coid_letter_of_good_standing_expiry", "sars_tcs_pin_expiry"]);
  });
});

describe("complianceExpiryCandidates", () => {
  const company: ComplianceExpiryCompanyRow = {
    id: "company-a",
    legal_name: "Klipcorp (Pty) Ltd",
    sars_tcs_pin_expiry: "2026-11-20",
    coid_letter_of_good_standing_expiry: "2027-01-01",
  };

  it("fires for a field exactly at the 14-day threshold", () => {
    const daysUntilFn = (d: string | null) => (d === company.sars_tcs_pin_expiry ? COMPLIANCE_EXPIRY_THRESHOLD_DAYS : 999);
    const candidates = complianceExpiryCandidates([company], daysUntilFn);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].field).toBe("sars_tcs_pin_expiry");
    expect(candidates[0].daysLeft).toBe(14);
  });

  it("both tracked fields can independently fire for the same company", () => {
    const candidates = complianceExpiryCandidates([company], () => 14);
    expect(candidates.map((c) => c.field).sort()).toEqual(["coid_letter_of_good_standing_expiry", "sars_tcs_pin_expiry"]);
  });

  it("off-threshold day counts yield nothing", () => {
    expect(complianceExpiryCandidates([company], () => 13)).toEqual([]);
    expect(complianceExpiryCandidates([company], () => 15)).toEqual([]);
    expect(complianceExpiryCandidates([company], () => null)).toEqual([]);
  });
});
