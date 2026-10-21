// Plan tiers, pricing and subscription-status math - pure, no I/O, fully
// unit-tested (billing.spec.ts), same "one pure core, read by every surface"
// convention as lib/readiness.ts and lib/documentExpiry.ts.
//
// Prices are copied from app/page.tsx's own PRICING_TIERS - the ONLY
// numbers this file is allowed to agree with. An earlier research pass for
// this piece of work named a different 4-tier scheme (Starter/Professional/
// Roads & Civils/Enterprise) that does not exist anywhere in this
// codebase - confirmed by reading app/page.tsx itself and
// docs/strategy/Marketing-Pricing-Strategy.md (the actual pricing research
// behind the real PRICING_TIERS), neither of which has ever named those 4
// tiers or those prices. Per this piece's own scope boundary ("do not
// touch app/page.tsx... leaving [PRICING_TIERS] exactly as currently
// written for you to make true"), this file matches the real, current
// PRICING_TIERS - see app/AGENTS.md's own dated entry for this discrepancy.

export const PLAN_TIERS = ["watch", "pro", "sanral_pro"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const TRIAL_DAYS = 14;

// The trial defaults every new company onto the full product (Sarel's own
// "full access" wording for the trial), not the free Watch tier - a trial
// of the free tier would show nothing worth trialing.
export const TRIAL_DEFAULT_PLAN: PlanTier = "sanral_pro";

export const PLAN_LABEL: Record<PlanTier, string> = {
  watch: "Tender Watch",
  pro: "Tender Pro",
  sanral_pro: "SANRAL Pro",
};

// Rand, excl. VAT - app/page.tsx's PRICING_TIERS, re-typed as numbers here
// so this file can do arithmetic with them (that page keeps its own
// display strings, e.g. "R1,490", unchanged - no shared import, since that
// page is explicitly off-limits for this piece and the two are checked
// against each other by this file's own test, not a runtime import).
export const PLAN_MONTHLY_ZAR: Record<PlanTier, number> = {
  watch: 0,
  pro: 1490,
  sanral_pro: 3950,
};

// Only these two are ever something to actually subscribe/pay for - Watch
// is free and needs no PayFast checkout at all.
export const PAYABLE_PLAN_TIERS: readonly PlanTier[] = ["pro", "sanral_pro"];

export function isPayablePlan(plan: PlanTier): boolean {
  return PAYABLE_PLAN_TIERS.includes(plan);
}

// "Yearly billing at 2 months free": paying for 10 months' worth up front
// covers all 12 - computed here, never hardcoded as a second literal price
// anywhere else (the checkout route, the /billing page and this file's own
// test all call this one function).
export function yearlyPriceZar(monthlyZar: number): number {
  return monthlyZar * 10;
}

export function priceForPlanZar(plan: PlanTier, interval: BillingInterval): number {
  const monthly = PLAN_MONTHLY_ZAR[plan];
  return interval === "yearly" ? yearlyPriceZar(monthly) : monthly;
}

// PayFast wants a plain string with exactly 2 decimal places, e.g. "1490.00" -
// never thousands separators (app/page.tsx's own "R1,490" display string
// would be rejected by PayFast's own amount validation).
export function priceForPayfastAmount(plan: PlanTier, interval: BillingInterval): string {
  return priceForPlanZar(plan, interval).toFixed(2);
}

export type CompanySubscriptionRow = {
  planTier: PlanTier;
  billingInterval: BillingInterval;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
};

// A stored "trialing" status doesn't flip to "past_due" by itself the
// moment trial_ends_at passes - nothing in this app runs a clock-driven job
// to rewrite it (same "recomputed on every load, nothing persisted that
// doesn't need to be" idiom as lib/notifications.ts/lib/documentExpiry.ts).
// This is the one function that reconciles the two: the EFFECTIVE status a
// lapsed trial should be treated as, computed fresh every time.
export function effectiveSubscriptionStatus(sub: CompanySubscriptionRow, now: Date = new Date()): SubscriptionStatus {
  if (sub.status === "trialing" && sub.trialEndsAt && new Date(sub.trialEndsAt).getTime() < now.getTime()) {
    return "past_due";
  }
  return sub.status;
}

// The one honest first-cut enforcement rule this piece builds (see
// app/AGENTS.md): trialing/active keep full access; past_due/cancelled
// (including a trial that lapsed with no payment on file) show a banner,
// not a silent lock-out and not silent continued access either. No
// per-feature/per-tier gating here - flagged as future work.
export function isSubscriptionLapsed(sub: CompanySubscriptionRow, now: Date = new Date()): boolean {
  const status = effectiveSubscriptionStatus(sub, now);
  return status === "past_due" || status === "cancelled";
}

// Whole days left on a trial, floor()'d (so "0" genuinely means "ends
// today", never rounded up past the real deadline) - null once it isn't
// trialing at all, so the banner can tell "no trial countdown to show"
// apart from "0 days left".
export function trialDaysLeft(sub: CompanySubscriptionRow, now: Date = new Date()): number | null {
  if (sub.status !== "trialing" || !sub.trialEndsAt) return null;
  const msLeft = new Date(sub.trialEndsAt).getTime() - now.getTime();
  return Math.max(0, Math.floor(msLeft / (1000 * 60 * 60 * 24)));
}
