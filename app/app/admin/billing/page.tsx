import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../../_components/AppShell";
import { AdminNav } from "../AdminNav";
import { StatCard } from "@/components/tt/stat-card";
import { formatDate } from "@/lib/dates";
import {
  PLAN_LABEL, PLAN_MONTHLY_ZAR, isPayablePlan, priceForPlanZar, effectiveSubscriptionStatus,
  type PlanTier, type BillingInterval, type SubscriptionStatus, type CompanySubscriptionRow,
} from "@/lib/billing";

// Reads per-request session/DB data (gated by is_platform_admin() - migration
// 0101) - same escape hatch as every other admin page.
export const instant = false;

type BillingRow = {
  company_id: string;
  legal_name: string;
  csd_trading_name: string | null;
  is_test_company: boolean;
  plan_tier: string;
  billing_interval: string;
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  max_packs_per_month: number | null;
  packs_used_this_period: number;
  has_payfast_token: boolean;
};

const STATUS_TONE: Record<SubscriptionStatus, "success" | "warning" | "destructive"> = {
  active: "success", trialing: "warning", past_due: "destructive", cancelled: "destructive",
};
const STATUS_CHIP_CLASS: Record<"success" | "warning" | "destructive", string> = {
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
};

function isKnownPlanTier(v: string): v is PlanTier {
  return v in PLAN_LABEL;
}

/** This one row's own monthly MRR contribution (0 if not an active, payable-tier subscription) - a pure function so the narrowing from isPayablePlan() stays in scope for priceForPlanZar(), instead of trying to carry a type-guard result through a separately-computed boolean. */
function monthlyContributionZar(planTier: PlanTier | null, billingInterval: string, effectiveStatus: SubscriptionStatus): number {
  if (effectiveStatus !== "active" || planTier === null || !isPayablePlan(planTier)) return 0;
  return billingInterval === "yearly" ? priceForPlanZar(planTier, "yearly") / 12 : priceForPlanZar(planTier, "monthly");
}

/**
 * MRR + subscription/quota overview (Admin Command Center Phase 3,
 * 2026-10-27). Pricing/lapsed-trial logic is NEVER reimplemented here - this
 * page only calls lib/billing.ts's own already-tested functions
 * (PLAN_MONTHLY_ZAR, priceForPlanZar, effectiveSubscriptionStatus) against
 * the raw columns migration 0101's platform_admin_billing_overview() RPC
 * returns, so a price or a trial-lapse rule can only ever be wrong in one
 * place.
 *
 * Deliberately excludes an AI-unit-economics card - Sarel's own explicit
 * Phase 1 decision ("omit entirely rather than show a number with nothing
 * real behind it") carries forward here unchanged: no token/OCR cost
 * tracking exists anywhere in engine/, so there is still nothing real to
 * show.
 */
export default async function AdminBillingPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("platform_admin_billing_overview");
  if (error) console.error("platform_admin_billing_overview rpc failed", error);

  const rows = ((data ?? []) as BillingRow[]).filter((r) => !r.is_test_company);
  const now = new Date();

  // Pure mapping first (no outer-scope mutation - react-hooks/immutability
  // flags exactly that, even in a Server Component's own render body) -
  // every aggregate below is then derived from this one computed array via
  // reduce/filter, never by reassigning a variable from inside the map.
  const computed = rows.map((r) => {
    const planTier = isKnownPlanTier(r.plan_tier) ? r.plan_tier : null;
    const sub: CompanySubscriptionRow | null = planTier
      ? {
          planTier,
          billingInterval: (r.billing_interval as BillingInterval) ?? "monthly",
          status: r.status as SubscriptionStatus,
          trialEndsAt: r.trial_ends_at,
          maxUsers: null,
          maxPacksPerMonth: r.max_packs_per_month,
        }
      : null;
    const effectiveStatus = sub ? effectiveSubscriptionStatus(sub, now) : (r.status as SubscriptionStatus);
    const isCustomPricingActive = effectiveStatus === "active" && planTier !== null && !isPayablePlan(planTier);

    return { ...r, planTier, effectiveStatus, isCustomPricingActive };
  });

  const mrrZar = computed.reduce((sum, r) => sum + monthlyContributionZar(r.planTier, r.billing_interval, r.effectiveStatus), 0);
  const customPricingActiveCount = computed.filter((r) => r.isCustomPricingActive).length;
  const tierCounts = computed.reduce<Record<string, number>>((acc, r) => {
    if (r.planTier) acc[r.planTier] = (acc[r.planTier] ?? 0) + 1;
    return acc;
  }, {});
  const activeCount = computed.filter((r) => r.effectiveStatus === "active").length;
  const trialingCount = computed.filter((r) => r.effectiveStatus === "trialing").length;
  const pastDueCount = computed.filter((r) => r.effectiveStatus === "past_due").length;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1150px] p-4 sm:p-6 md:px-8 md:py-6">
        <AdminNav active="billing" />

        <h1 className="mb-1 font-display text-[22px] font-bold text-foreground">Billing</h1>
        <p className="mb-4 text-[13px] text-muted-foreground">
          MRR computed from real active subscriptions x the actual published prices (
          {Object.entries(PLAN_MONTHLY_ZAR)
            .filter(([, price]) => price !== null)
            .map(([tier, price]) => `${PLAN_LABEL[tier as PlanTier]} R${price}/mo`)
            .join(", ")}
          ), normalised to monthly for yearly billing. Enterprise is priced on request and excluded from MRR -
          shown as its own count instead. Test companies are excluded entirely. No AI-cost card here - no real
          token/OCR cost tracking exists anywhere yet.
        </p>

        {error && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
            {"Couldn't load billing data - try refreshing. If it keeps happening, let us know."}
          </div>
        )}

        <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
          <StatCard label="MRR (ZAR, excl. VAT)" value={`R${mrrZar.toLocaleString("en-ZA")}`} tone="money" />
          <StatCard label="Active paying subscriptions" value={activeCount} tone="success" />
          <StatCard label="Active trials" value={trialingCount} tone="warning" />
          <StatCard label="Past due / lapsed" value={pastDueCount} tone={pastDueCount > 0 ? "destructive" : "muted"} />
          <StatCard label="Enterprise (custom pricing, not in MRR)" value={customPricingActiveCount} tone="muted" />
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          {Object.entries(tierCounts).map(([tier, count]) => (
            <span key={tier} className="inline-flex rounded-full border border-border bg-muted px-2.5 py-1 text-[12px] font-semibold text-muted-foreground">
              {PLAN_LABEL[tier as PlanTier] ?? tier}: {count}
            </span>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {computed.length === 0 && !error && <div className="p-4.5 text-[13px] text-muted-foreground">No subscriptions on file.</div>}
          {computed.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                    <th className="px-4.5 py-2 font-semibold">Company</th>
                    <th className="px-4.5 py-2 font-semibold">Plan</th>
                    <th className="px-4.5 py-2 font-semibold">Billing</th>
                    <th className="px-4.5 py-2 font-semibold">Status</th>
                    <th className="px-4.5 py-2 font-semibold">Packs this period</th>
                    <th className="px-4.5 py-2 font-semibold">PayFast</th>
                    <th className="px-4.5 py-2 font-semibold">Period end / trial end</th>
                  </tr>
                </thead>
                <tbody>
                  {computed.map((r) => {
                    const tone = STATUS_TONE[r.effectiveStatus as SubscriptionStatus] ?? "warning";
                    return (
                      <tr key={r.company_id} className="border-b border-border last:border-b-0">
                        <td className="max-w-[220px] truncate px-4.5 py-2 text-foreground">{r.csd_trading_name || r.legal_name}</td>
                        <td className="px-4.5 py-2 text-muted-foreground">{r.planTier ? PLAN_LABEL[r.planTier] : r.plan_tier}</td>
                        <td className="px-4.5 py-2 text-muted-foreground capitalize">{r.billing_interval}</td>
                        <td className="whitespace-nowrap px-4.5 py-2">
                          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize ${STATUS_CHIP_CLASS[tone]}`}>
                            {r.effectiveStatus.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4.5 py-2 text-muted-foreground">
                          {r.packs_used_this_period}
                          {r.max_packs_per_month !== null ? ` / ${r.max_packs_per_month}` : " (unlimited)"}
                        </td>
                        <td className="px-4.5 py-2 text-muted-foreground">{r.has_payfast_token ? "On file" : "Never charged"}</td>
                        <td className="whitespace-nowrap px-4.5 py-2 text-muted-foreground">
                          {r.effectiveStatus === "trialing" ? formatDate(r.trial_ends_at) ?? "-" : formatDate(r.current_period_end) ?? "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
