"use server";

import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

// Subscription billing (0078: subscription_plans/company_subscriptions/
// payfast_checkouts). Owner/admin only, enforced both here and by RLS
// (payfast_checkouts: admins create for their own company) - same
// belt-and-suspenders pattern as app/app/company/bank-accounts/actions.ts.
//
// v1 deliberately uses a once-off PayFast payment per billing period, not
// PayFast's native recurring-subscription fields (subscription_type/
// frequency/billing_date/cycles) - their exact codes couldn't be
// independently confirmed from PayFast's own (JS-rendered, unfetchable)
// docs or from corroborating third-party sources, and guessing wrong on a
// real payment integration risks a silent double-charge or a subscription
// that never renews. record_payfast_itn() already reactivates a
// subscription on ANY completed checkout for that company, so renewing is
// just paying again via "Renew now" on the billing page - safe to build
// native recurring on top of this later, once the frequency codes are
// confirmed against a real sandbox subscription.

const BACK = "/company/billing";

function fail(message: string): never {
  redirect(`${BACK}?error=${encodeURIComponent(message)}`);
}

async function requireCompanyAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: membership } = await supabase.from("company_members").select("company_id, role").eq("user_id", user.id).maybeSingle();
  if (!membership) redirect("/onboarding");
  if (membership.role !== "owner" && membership.role !== "admin") fail("Only an owner or admin of the company can manage billing.");
  return { companyId: membership.company_id as string, userId: user.id };
}

async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function createCheckoutSession(formData: FormData) {
  const { companyId } = await requireCompanyAdmin();
  const supabase = await createClient();

  const planCode = formData.get("plan_code") as string | null;
  const billingCycle = formData.get("billing_cycle") === "annual" ? "annual" : "monthly";
  if (!planCode) fail("Choose a plan.");

  const { data: plan, error: planError } = await supabase
    .from("subscription_plans")
    .select("code, name, monthly_price_zar, annual_price_zar, is_custom")
    .eq("code", planCode)
    .maybeSingle();
  if (planError || !plan) fail("That plan doesn't exist.");
  if (plan.is_custom) fail("Enterprise is priced on request - contact us to set up your plan.");

  const amount = billingCycle === "annual" ? plan.annual_price_zar : plan.monthly_price_zar;
  if (amount === null) fail("That plan has no self-serve price.");

  const { data: checkout, error: checkoutError } = await supabase
    .from("payfast_checkouts")
    .insert({ company_id: companyId, plan_code: plan.code, billing_cycle: billingCycle, expected_amount_zar: amount })
    .select("m_payment_id")
    .single();
  if (checkoutError || !checkout) fail(checkoutError?.message ?? "Could not start checkout.");

  redirect(`${BACK}/pay/${checkout.m_payment_id}`);
}

export async function setCancelAtPeriodEnd(formData: FormData) {
  const { companyId } = await requireCompanyAdmin();
  const supabase = await createClient();
  const cancel = formData.get("cancel") === "true";
  const { error } = await supabase.from("company_subscriptions").update({ cancel_at_period_end: cancel }).eq("company_id", companyId);
  if (error) fail(error.message);
  redirect(`${BACK}?saved=${cancel ? "cancel_scheduled" : "cancel_undone"}`);
}

export { baseUrl };
