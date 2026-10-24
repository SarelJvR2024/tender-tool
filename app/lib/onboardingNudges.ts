// Tier 0 onboarding nudges - candidate selection only (notification engine
// brief addendum). Sarel's own ask: "event-driven / conditional triggers
// based on CSD and first tender progress" - these two triggers are exactly
// that: a company's real vault-document count and real pipeline state,
// never a guess or a second, parallel counter.
//
// Both suppression rules below are the brief's own "State & Suppression
// Requirements", carried out here as the actual filter rather than left for
// a caller to remember: "never nudge a vault already at 2+ documents",
// "never nudge-first-tender once a company has a pipeline". Pure functions,
// same shape as lib/complianceExpiryReminders.ts/lib/briefingReminders.ts -
// the sender script (scripts/send-onboarding-nudges.ts) does the querying
// and the actual send; this file only decides who qualifies.
import { VAULT_DOCUMENTS } from "./vaultDocuments.ts";

const VAULT_DOC_COLUMNS: string[] = Object.values(VAULT_DOCUMENTS).map((d) => d.column);

export type VaultKickstartCompanyRow = {
  id: string;
  legal_name: string | null;
  created_at: string;
} & Record<string, unknown>;

/** How many of the 7 vault documents (lib/vaultDocuments.ts's own VAULT_DOCUMENTS) this company has on file - the same definition the Company vault page itself uses, not a second count. */
export function vaultDocsOnFile(company: Record<string, unknown>): number {
  return VAULT_DOC_COLUMNS.filter((col) => !!company[col]).length;
}

// "A couple of minutes once you have the file" only makes sense once a
// company has had a little time to look around - nudging on day 0 would be
// noise, not help.
export const VAULT_KICKSTART_MIN_DAYS_SINCE_SIGNUP = 3;
// The email's own copy says "Two documents start your vault" - a company at
// 2+ is already past the cold-start problem this nudge exists to solve.
export const VAULT_KICKSTART_DOC_THRESHOLD = 2;

export type VaultKickstartCandidate = { company: VaultKickstartCompanyRow; vaultDocsOnFile: number };

export function vaultKickstartCandidates(companies: VaultKickstartCompanyRow[], now: Date = new Date()): VaultKickstartCandidate[] {
  const out: VaultKickstartCandidate[] = [];
  for (const company of companies) {
    const daysSinceSignup = (now.getTime() - new Date(company.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (!(daysSinceSignup >= VAULT_KICKSTART_MIN_DAYS_SINCE_SIGNUP)) continue;
    const docs = vaultDocsOnFile(company);
    if (docs >= VAULT_KICKSTART_DOC_THRESHOLD) continue;
    out.push({ company, vaultDocsOnFile: docs });
  }
  return out;
}

export type FirstTenderCompanyRow = { id: string; legal_name: string | null; created_at: string };

export const FIRST_TENDER_MIN_DAYS_SINCE_SIGNUP = 3;

/** companyIdsWithAPack: every company_id with at least one tender_packs row (any pipeline_stage) - "has a pipeline" at all, the brief's own suppression condition, not "has WON a tender". */
export function firstTenderCandidates(companies: FirstTenderCompanyRow[], companyIdsWithAPack: Set<string>, now: Date = new Date()): FirstTenderCompanyRow[] {
  return companies.filter((company) => {
    const daysSinceSignup = (now.getTime() - new Date(company.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (!(daysSinceSignup >= FIRST_TENDER_MIN_DAYS_SINCE_SIGNUP)) return false;
    return !companyIdsWithAPack.has(company.id);
  });
}
