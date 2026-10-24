// Pure threshold logic for the compliance-document expiry alert
// (Operational Notification Engine) - "14 days before SARS PIN or CSD
// expiry". Company-scoped, not tender-scoped (these are Company vault
// fields, checked once per company, not once per tender).
//
// Honest scoping note: CSD is tracked in this schema ONLY as
// companies.csd_supplier_number (a presence/absence field - see
// lib/tenderCompliance.ts's own "csd" compliance item) - there is no
// csd_expiry/csd_registration_expiry column anywhere (confirmed by reading
// every migration). South Africa's CSD registration isn't itself a fixed-
// term certificate the way a SARS Tax Compliance PIN or a COID Letter of
// Good Standing is, and this app has never captured one. Rather than invent
// a field that doesn't exist, this alert covers the two fields that
// genuinely ARE tracked with a real expiry date and map to what was asked:
// SARS PIN and COIDA. If CSD ever gets a real expiry field, add it here.
export const COMPLIANCE_EXPIRY_THRESHOLD_DAYS = 14;

export const COMPLIANCE_EXPIRY_FIELDS: { field: "sars_tcs_pin_expiry" | "coid_letter_of_good_standing_expiry"; label: string }[] = [
  { field: "sars_tcs_pin_expiry", label: "SARS Tax Compliance PIN" },
  { field: "coid_letter_of_good_standing_expiry", label: "COID Letter of Good Standing" },
];

export type ComplianceExpiryCompanyRow = {
  id: string;
  legal_name: string | null;
  sars_tcs_pin_expiry: string | null;
  coid_letter_of_good_standing_expiry: string | null;
};

export type ComplianceExpiryCandidate = {
  company: ComplianceExpiryCompanyRow;
  field: (typeof COMPLIANCE_EXPIRY_FIELDS)[number]["field"];
  label: string;
  daysLeft: number;
};

export function complianceExpiryCandidates(
  companies: ComplianceExpiryCompanyRow[],
  daysUntilFn: (dateStr: string | null) => number | null
): ComplianceExpiryCandidate[] {
  const out: ComplianceExpiryCandidate[] = [];
  for (const company of companies) {
    for (const { field, label } of COMPLIANCE_EXPIRY_FIELDS) {
      const daysLeft = daysUntilFn(company[field]);
      if (daysLeft === COMPLIANCE_EXPIRY_THRESHOLD_DAYS) out.push({ company, field, label, daysLeft });
    }
  }
  return out;
}
