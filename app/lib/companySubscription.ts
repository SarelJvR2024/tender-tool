import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanySubscriptionRow } from "./billing";

/**
 * Reads the signed-in user's own company_subscriptions row (RLS-scoped,
 * same as every other query in this app - see supabase/migrations/0078's
 * own select policy). `subscription` is null either on the genuine "no row
 * exists at all" case (which should never happen for a real company - the
 * companies_start_trial trigger creates one the moment the company row is
 * inserted - but callers still handle it rather than assume the trigger
 * always ran, e.g. a company seeded before this migration existed) or on a
 * real read failure.
 *
 * Standing solution-architect review, 2026-11-06: those two null cases used
 * to be indistinguishable - a failed read returned a bare `null`, same as
 * the genuine no-row case, so `billing/page.tsx` rendered "No subscription
 * found for your company yet." on a real Supabase failure, and callers had
 * no way to tell the difference. `error` makes that explicit: `true` only
 * when the read itself failed, never set for the genuine no-row case.
 */
export async function fetchCompanySubscription(
  supabase: SupabaseClient,
): Promise<{ subscription: CompanySubscriptionRow | null; error: boolean }> {
  const { data, error } = await supabase
    .from("company_subscriptions")
    .select("plan_tier, billing_interval, status, trial_ends_at, max_users, max_packs_per_month")
    .maybeSingle();

  if (error) {
    console.error("company_subscriptions select failed", error);
    return { subscription: null, error: true };
  }
  if (!data) return { subscription: null, error: false };

  return {
    subscription: {
      planTier: data.plan_tier,
      billingInterval: data.billing_interval,
      status: data.status,
      trialEndsAt: data.trial_ends_at,
      maxUsers: data.max_users,
      maxPacksPerMonth: data.max_packs_per_month,
    },
    error: false,
  };
}
