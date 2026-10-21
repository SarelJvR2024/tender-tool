import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession, setCancelAtPeriodEnd } from "./actions";
import { Card, FAINT, MUTED, NAVY, SubPage, Submit, fmtDate } from "../_components/ui";

export const instant = false;

const SAVED: Record<string, string> = {
  cancel_scheduled: "Your plan will not renew after the current period ends.",
  cancel_undone: "Cancellation withdrawn - your plan will keep renewing.",
};

type Plan = {
  code: string;
  name: string;
  monthly_price_zar: number | null;
  annual_price_zar: number | null;
  max_users: number | null;
  max_packs_per_month: number | null;
  is_custom: boolean;
};

type Subscription = {
  plan_code: string;
  billing_cycle: "monthly" | "annual";
  status: "trialing" | "active" | "past_due" | "cancelled" | "incomplete";
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
};

const STATUS_LABEL: Record<Subscription["status"], { label: string; bg: string; color: string }> = {
  trialing: { label: "Free trial", bg: "#DBEAFE", color: "#1D4ED8" },
  active: { label: "Active", bg: "#DCFCE7", color: "#15803D" },
  past_due: { label: "Payment failed", bg: "#FEE2E2", color: "#B91C1C" },
  cancelled: { label: "Cancelled", bg: "#F3F4F6", color: "#4B5563" },
  incomplete: { label: "Incomplete", bg: "#FEF3C7", color: "#B45309" },
};

function zar(amount: number | null): string {
  return amount === null ? "Custom" : `R${amount.toLocaleString("en-ZA", { minimumFractionDigits: 0 })}`;
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; success?: string; cancelled?: string }> }) {
  const { error, saved, success, cancelled } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: membership } = await supabase.from("company_members").select("company_id, role").eq("user_id", user?.id ?? "").maybeSingle();
  const isAdmin = membership?.role === "owner" || membership?.role === "admin";
  const companyId = membership?.company_id as string | undefined;

  const [{ data: planRows }, { data: subRow }, { data: memberCountRows }, { data: packsThisPeriod }] = await Promise.all([
    supabase.from("subscription_plans").select("code, name, monthly_price_zar, annual_price_zar, max_users, max_packs_per_month, is_custom").order("sort_order"),
    companyId ? supabase.from("company_subscriptions").select("plan_code, billing_cycle, status, trial_ends_at, current_period_start, current_period_end, cancel_at_period_end").eq("company_id", companyId).maybeSingle() : Promise.resolve({ data: null }),
    companyId ? supabase.from("company_members").select("id", { count: "exact", head: true }).eq("company_id", companyId) : Promise.resolve({ data: null }),
    companyId ? supabase.rpc("company_packs_this_period", { p_company_id: companyId }) : Promise.resolve({ data: null }),
  ]);

  const plans = (planRows ?? []) as Plan[];
  const subscription = subRow as Subscription | null;
  const memberCount = (memberCountRows as unknown as { count: number } | null)?.count ?? 0;
  const currentPlan = plans.find((p) => p.code === subscription?.plan_code);
  const statusInfo = subscription ? STATUS_LABEL[subscription.status] : null;

  return (
    <SubPage
      title="Billing"
      intro="Your plan, usage this period, and payment. Every plan includes every engine - plans differ only in how many people and how many bid packs a month."
      error={error}
      saved={saved ? SAVED[saved] ?? null : success ? "Payment received - your plan is now active." : cancelled ? "Checkout cancelled - no charge was made." : null}
    >
      {!isAdmin ? (
        <Card>
          <div style={{ fontSize: 13, color: MUTED }}>Only an owner or admin can manage billing.</div>
        </Card>
      ) : (
        <>
          <Card title="Current plan">
            {subscription && currentPlan ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 17, fontWeight: 700, color: NAVY }}>{currentPlan.name}</span>
                  {statusInfo && (
                    <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: statusInfo.bg, color: statusInfo.color }}>
                      {statusInfo.label}
                    </span>
                  )}
                </div>
                {subscription.status === "trialing" && subscription.trial_ends_at && (
                  <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>
                    Your trial includes one complete bid pack and ends {fmtDate(subscription.trial_ends_at)}. Choose a plan below to keep going after that.
                  </div>
                )}
                {subscription.status === "active" && subscription.current_period_end && (
                  <div style={{ fontSize: 13, color: MUTED, marginBottom: 8 }}>
                    {subscription.cancel_at_period_end
                      ? `Your plan will end on ${fmtDate(subscription.current_period_end)} and won't renew.`
                      : `Renews ${fmtDate(subscription.current_period_end)} (${subscription.billing_cycle}).`}
                  </div>
                )}
                <div style={{ fontSize: 13, color: NAVY, marginBottom: 4 }}>
                  Team: {memberCount} of {currentPlan.max_users ?? "unlimited"}
                </div>
                <div style={{ fontSize: 13, color: NAVY, marginBottom: 10 }}>
                  Bid packs this period: {(packsThisPeriod as number | null) ?? 0} of {currentPlan.max_packs_per_month ?? "unlimited"}
                </div>
                {subscription.status === "active" && (
                  <form action={setCancelAtPeriodEnd}>
                    <input type="hidden" name="cancel" value={subscription.cancel_at_period_end ? "false" : "true"} />
                    <Submit secondary>{subscription.cancel_at_period_end ? "Keep my plan" : "Cancel at period end"}</Submit>
                  </form>
                )}
              </>
            ) : (
              <div style={{ fontSize: 13, color: MUTED }}>No subscription on file yet.</div>
            )}
          </Card>

          <Card title="Plans">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
              {plans.map((plan) => {
                const isCurrent = plan.code === subscription?.plan_code && subscription?.status === "active";
                return (
                  <div key={plan.code} style={{ border: `1px solid ${isCurrent ? "#1D4ED8" : "#E3E6EA"}`, borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: NAVY, marginBottom: 2 }}>{plan.name}</div>
                    {plan.is_custom ? (
                      <div style={{ fontSize: 13, color: MUTED, marginBottom: 10 }}>Priced on request</div>
                    ) : (
                      <div style={{ fontSize: 13, color: MUTED, marginBottom: 10 }}>
                        {zar(plan.monthly_price_zar)}/mo or {zar(plan.annual_price_zar)}/yr
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: FAINT, marginBottom: 10 }}>
                      {plan.max_users ?? "Unlimited"} people - {plan.max_packs_per_month ?? "Unlimited"} bid packs/mo
                    </div>
                    {plan.is_custom ? (
                      <div style={{ fontSize: 12, color: MUTED }}>Contact us to set up Enterprise.</div>
                    ) : isCurrent ? (
                      <div style={{ fontSize: 12, color: "#15803D", fontWeight: 600 }}>Your current plan</div>
                    ) : (
                      <div style={{ display: "flex", gap: 8 }}>
                        <form action={createCheckoutSession}>
                          <input type="hidden" name="plan_code" value={plan.code} />
                          <input type="hidden" name="billing_cycle" value="monthly" />
                          <Submit secondary>Pay monthly</Submit>
                        </form>
                        <form action={createCheckoutSession}>
                          <input type="hidden" name="plan_code" value={plan.code} />
                          <input type="hidden" name="billing_cycle" value="annual" />
                          <Submit secondary>Pay annually</Submit>
                        </form>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}
    </SubPage>
  );
}
