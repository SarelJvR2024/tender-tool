import type { VaultDocumentKind } from "@/lib/vaultDocuments";

// Moved out of page.tsx unchanged so the extracted section components
// (app/company/_components/) can share the same shape without re-declaring
// it or importing the page module itself.
export type CompanyRow = {
  id: string;
  legal_name: string | null;
  csd_trading_name: string | null;
  cipc_registration_number: string | null;
  vat_number: string | null;
  income_tax_number: string | null;
  paye_number: string | null;
  csd_supplier_number: string | null;
  coid_registration_number: string | null;
  coid_letter_of_good_standing_number: string | null;
  coid_letter_of_good_standing_expiry: string | null;
  bee_level: number | null;
  black_ownership_pct: number | null;
  bee_procurement_recognition_pct: number | null;
  status: string | null;
  registered_address: string | null;
  postal_address: string | null;
  bank_name: string | null;
  bank_branch_code: string | null;
  // 0014_vault_compliance_documents.sql
  coid_letter_document_path: string | null;
  cidb_grading: string | null; // 0018_general_tender_preparation.sql
  // 0063_onboarding_document_scan.sql (completes the CIDB vault slot - see that migration's header)
  cidb_expiry: string | null;
  cidb_document_path: string | null;
  // 0069_onboarding_scan_orphaned_fields.sql - captured by the document scan review screen but, until
  // now, never selected/shown on this page (the write side was fixed in 0069; this closes the read side).
  cidb_registration_number: string | null;
  cidb_contractor_name: string | null;
  bee_entity_name: string | null;
  bank_confirmation_bank_name: string | null;
  bank_confirmation_account_holder: string | null;
  iso_9001_certified_entity_name: string | null;
  sars_tcs_pin: string | null;
  sars_tcs_pin_expiry: string | null;
  sars_tcs_pin_document_path: string | null;
  pi_insurance_insurer: string | null;
  pi_insurance_policy_number: string | null;
  pi_insurance_cover_zar: number | null;
  pi_insurance_expiry: string | null;
  pi_insurance_document_path: string | null;
  iso_9001_certified: boolean | null;
  iso_9001_certificate_number: string | null;
  iso_9001_expiry: string | null;
  iso_9001_document_path: string | null;
  bank_confirmation_letter_date: string | null;
  bank_confirmation_letter_valid_until: string | null; // generated: letter date + 3 months
  bank_confirmation_letter_path: string | null;
  bee_proof_type: string | null;
  bee_proof_expiry: string | null;
  bee_proof_document_path: string | null;
  // 0030_company_how_we_work.sql
  how_we_work: string | null;
  // 0001 columns the SANRAL pack writes into Form B3 / C.1.2.3 - editable here
  // since the 2026-10-18 form-field audit (before, only a seed could set them,
  // and a new company's DB default 0 went onto Form B3 as fact). Directors for
  // C.1.2.3 come from the directors register (/company/principals, 0050).
  head_office: string | null;
  other_offices: number | null;
  ecsa_registered_staff_count: number | null;
  sacpcmp_registered_staff_count: number | null;
  total_employees: number | null;
  typical_jv_share_pct: number | null;
  // 0085_savings_counter.sql - time/cost saved counter baseline (spec §9).
  // Not-null columns with real defaults (20/450), unlike every field above.
  savings_baseline_hours_per_tender: number;
  savings_baseline_hourly_cost_zar: number;
};

export type DocUrls = Partial<Record<VaultDocumentKind, string>>;
