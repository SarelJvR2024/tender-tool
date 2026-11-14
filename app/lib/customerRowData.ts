import { computeBidReadiness } from "./readiness";
import { daysUntil } from "./dates";
import { effectiveSubscriptionStatus, type SubscriptionStatus } from "./billing";
import type { Customer, CustomerMember } from "@/app/admin/customers/CustomerRow";

export type CompanyOverviewRow = {
  id: string;
  legal_name: string;
  csd_trading_name: string | null;
  csd_supplier_number: string | null;
  is_test_company: boolean;
  created_at: string;
  member_count: number;
  people_count: number;
  tenders_pursued_count: number;
  active_tenders_count: number;
  last_activity_at: string | null;
  plan_tier: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
};

export type ReadinessDataRow = {
  legal_name: string | null;
  csd_supplier_number: string | null;
  sars_tcs_pin: string | null;
  sars_tcs_pin_expiry: string | null;
  bee_level: number | null;
  bee_proof_expiry: string | null;
  cidb_grading: string | null;
  cidb_expiry: string | null;
  bank_confirmation_letter_valid_until: string | null;
  principal_count: number;
  people_with_cv_count: number;
  experience_project_count: number;
};

/**
 * Builds one customer row's derived fields (readiness score, primary
 * contact, trial countdown) from the company-overview row plus its two
 * per-company RPC results. Pure function - `page.tsx` does the actual
 * Supabase calls and passes their raw `{ data, error }` results straight
 * through - same split as `fetchSavingsCounterSummary()`/
 * `computeBidReadiness()` (a DB-touching fetcher in the page, a
 * unit-tested pure builder here).
 *
 * Standing review finding: the page's own `platform_admin_companies()`
 * read already captures and `console.error()`s its error, but the two
 * PER-COMPANY RPCs this function receives (`platform_admin_company_members`,
 * `platform_admin_company_readiness_data`) never had their own errors
 * captured at all - a failed `platform_admin_company_members` call for one
 * company silently rendered identically to a genuine zero-member company
 * ("No members.", no primary contact) in `CustomerRow.tsx`, even though
 * that same row's header still shows the real, non-zero `member_count`
 * from the separate `platform_admin_companies()` read - a direct, visible
 * contradiction ("3 members" above, "No members." below) a platform admin
 * would notice. `membersError` now distinguishes the two cases so the row
 * can say "couldn't load" instead of falsely claiming zero members.
 * `readinessError` is captured and logged for the same reason, but not
 * separately surfaced in the UI: `readinessPercent`/`readinessCriteria`
 * being `null` on a failed read already renders identically to the
 * pre-existing, explicitly-documented "no readiness data row" case
 * (`CustomerRow.tsx`'s own `readinessPercent` comment) - both already mean
 * "couldn't be computed", so no behaviour changes there, only logging.
 */
export function buildCustomerRow(
  company: CompanyOverviewRow,
  membersResult: { data: CustomerMember[] | null; error: unknown },
  readinessResult: { data: ReadinessDataRow[] | null; error: unknown },
): Customer {
  if (membersResult.error) console.error("platform_admin_company_members rpc failed", membersResult.error, company.id);
  if (readinessResult.error) console.error("platform_admin_company_readiness_data rpc failed", readinessResult.error, company.id);

  const membersError = Boolean(membersResult.error);
  const members = membersResult.data ?? [];

  const r = readinessResult.data?.[0] ?? null;
  const readiness = r
    ? computeBidReadiness({
        legalName: r.legal_name,
        csdSupplierNumber: r.csd_supplier_number,
        taxPin: r.sars_tcs_pin,
        taxPinExpiry: r.sars_tcs_pin_expiry,
        // Standing review, 2026-11-09: taxPinDocumentPath/beeProofDocumentPath/
        // cidbDocumentPath (lib/readiness.ts's own sibling fix to Finding 240 -
        // same pass) are deliberately omitted here, not set to a value this
        // RPC doesn't have. platform_admin_company_readiness_data() (migration
        // 0098) doesn't return the 3 vault document-path columns, so this is
        // the one caller still scored by the OLD, stricter rule (text/level
        // presence only) until that RPC is widened in its own migration -
        // a schema change this track's own guardrails leave for a separate,
        // explicitly-approved pass, not this one. Omitting them only ever
        // makes this admin-only score as strict as it already was today,
        // never wrong in the OTHER direction (no false "satisfied") - so
        // /admin/customers staying temporarily narrower than the rest of the
        // app is a documented gap, not a regression.
        beeLevel: r.bee_level,
        beeProofExpiry: r.bee_proof_expiry,
        cidbGrading: r.cidb_grading,
        cidbExpiry: r.cidb_expiry,
        bankConfirmationValidUntil: r.bank_confirmation_letter_valid_until,
        principalCount: r.principal_count,
        peopleWithCvCount: r.people_with_cv_count,
        experienceProjectCount: r.experience_project_count,
      })
    : null;

  // Never claim a primary contact scraped from a members list we know
  // failed to load - same "don't let an error read as a real, specific
  // value" direction as the rest of this function.
  const primaryContact = membersError ? null : members.find((m) => m.role === "owner")?.email ?? members[0]?.email ?? null;
  const trialDaysRemaining = company.subscription_status === "trialing" ? daysUntil(company.trial_ends_at) : null;

  // Finding 317: `company.subscription_status` is the RAW, never-rewritten
  // `company_subscriptions.status` column (0098's own `platform_admin_companies()`
  // selects `cs.status` directly - see that migration) - exactly the same
  // "stays 'trialing' forever once lapsed" column Finding 316 already
  // established for admin/billing. `CustomerRow.tsx`'s own status chip used
  // to colour itself straight off that raw value, so a trial that lapsed
  // with no payment ever on file (negative `trialDaysRemaining`, shown as
  // "trial expired" in the SAME chip's own text) still rendered with the
  // ordinary in-progress-trial "warning" (yellow) tone, not the "past due"
  // (red) tone an admin scanning this list for who needs chasing would
  // expect - the chip's own text and colour visibly disagreeing for the
  // exact row most needing attention. `effectiveSubscriptionStatus()`
  // (lib/billing.ts) is this app's one canonical reconciliation of that -
  // computed here, once, rather than re-derived a second time inside
  // CustomerRow.tsx itself.
  const effectiveSubscriptionStatusValue: SubscriptionStatus | null = company.subscription_status
    ? effectiveSubscriptionStatus({ status: company.subscription_status as SubscriptionStatus, trialEndsAt: company.trial_ends_at })
    : null;

  return {
    ...company,
    members,
    membersError,
    readinessPercent: readiness?.percent ?? null,
    readinessCriteria: readiness?.criteria ?? null,
    primaryContact,
    trialDaysRemaining,
    effectiveSubscriptionStatus: effectiveSubscriptionStatusValue,
  };
}

/**
 * The 3 headline counts /admin/customers shows above the table (standing
 * review, 2026-11-12, a previously-missed sibling of Finding 317). `page.tsx`
 * used to compute `trialCount`/`payingCount` itself, straight off each
 * `Customer`'s own RAW `subscription_status` - the exact same "stays
 * 'trialing' forever once a trial lapses with no payment ever on file"
 * column Finding 317 already found and fixed for THIS SAME `Customer`
 * object's own status chip (`CustomerRow.tsx`), by switching that one
 * consumer to `effectiveSubscriptionStatus` instead. Finding 317's own fix
 * never touched this second, page-level consumer of the identical raw
 * field - confirmed by reading that finding's own write-up, which only
 * ever discusses the chip's tone - so a lapsed, non-paying trial still
 * counted toward "Active trials" here forever, inflating the one number on
 * this page a platform admin would actually use to judge the trial
 * pipeline's health (which accounts need chasing before they go stale).
 * `payingCount` is included here too for the same reason even though
 * `effectiveSubscriptionStatus()` never remaps a raw "active" row to
 * anything else today (so this one's current output is unchanged) - this
 * is the one canonical place that reads a `Customer`'s own subscription
 * state for a count, not a second, independently-drifting copy of the
 * same filter.
 */
export function customerCounts(
  customers: Pick<Customer, "is_test_company" | "effectiveSubscriptionStatus">[],
): { testCount: number; trialCount: number; payingCount: number } {
  const nonTest = customers.filter((c) => !c.is_test_company);
  return {
    testCount: customers.filter((c) => c.is_test_company).length,
    trialCount: nonTest.filter((c) => c.effectiveSubscriptionStatus === "trialing").length,
    payingCount: nonTest.filter((c) => c.effectiveSubscriptionStatus === "active").length,
  };
}
