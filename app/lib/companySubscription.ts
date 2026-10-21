import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanySubscriptionRow } from "./billing";

/**
 * Reads the signed-in user's own company_subscriptions row (RLS-scoped,
 * same as every other query in this app - see supabase/migrations/0078's
 * own select policy). null only when no row exists at all, which should
 * never happen for a real company (the companies_start_trial trigger
 * creates one the moment the company row is inserted) - callers still
 * handle null rather than assume the trigger always ran (e.g. a company
 * seeded before this migration existed).
 */
export async function fetchCompanySubscription(supabase: SupabaseClient): Promise<CompanySubscriptionRow | null> {
  const { data, error } = await supabase
    .from("company_subscriptions")
    .select("plan_tier, billing_interval, status, trial_ends_at")
    .maybeSingle();

  if (error) {
    console.error("company_subscriptions select failed", error);
    return null;
  }
  if (!data) return null;

  return {
    planTier: data.plan_tier,
    billingInterval: data.billing_interval,
    status: data.status,
    trialEndsAt: data.trial_ends_at,
  };
}
