/**
 * Static allowlist naming the one seeded demo/trial company ("Mzansi Roads &
 * Civils (Pty) Ltd", engine/seed_demo_company.py) - a real `companies` row
 * with realistic sample data, shown with a small banner (DemoBanner) so
 * nobody mistakes it for their own vault. See app/AGENTS.md's "Demo company"
 * entry for the full reasoning.
 *
 * Deliberately a hardcoded id, not a new `companies` column: 0007 already
 * added `is_test_company`, but its own comment is explicit that it's for
 * Sarel's own internal test harness and must "never surface in any
 * customer-facing UI" - reusing it here for a customer-facing banner would
 * contradict its documented meaning. A real `companies.is_demo_company`
 * (or similar) flag would be the cleaner long-term answer once that's a
 * confirmed decision - flagged, not built, since it's schema work. Until
 * then this allowlist needs no migration and can't affect any other company.
 */
export const DEMO_COMPANY_ID = "26294b10-1a6e-43cc-968a-2cbe77ac5d4f";

export function isDemoCompany(companyId: string | null | undefined): boolean {
  return !!companyId && companyId === DEMO_COMPANY_ID;
}
