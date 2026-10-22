// Plan tiers, pricing and subscription-status math - pure, no I/O, fully
// unit-tested (billing.spec.ts), same "one pure core, read by every surface"
// convention as lib/readiness.ts and lib/documentExpiry.ts.
//
// Pricing confirmed by Sarel directly (2026-10-22, in chat) after a real
// conflict surfaced across sessions: Starter R1,490/mo, Professional
// R2,990/mo ("the plan most companies start on"), Business R4,990/mo,
// Enterprise (custom, priced on request - never self-serve). Full feature
// parity across every tier - plans differ only by seat count (max_users)
// and monthly bid-pack volume (max_packs_per_month), both now real,
// enforced limits (migration 0083 closes the gap this file's own earlier
// header comment, and app/AGENTS.md, flagged as deliberately deferred).
//
// PLAN_LIMITS is mirrored in (and cross-checked by this file's own test
// against) migration 0083's tt_plan_limits() SQL function - the two are
// never imported across the app/database boundary, same "two copies,
// checked against each other" convention this file's pricing already used
// for app/page.tsx.

export const PLAN_TIERS = ["starter", "professional", "business", "enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const BILLING_INTERVALS = ["monthly", "yearly"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const TRIAL_DAYS = 14;

// The trial defaults every new company onto Professional - "the plan most
// companies start on" (Sarel's own wording) - rather than Starter or
// Business, since every tier now has identical feature access and there's
// no more "default to the premium tier so they see everything" reasoning
// (that only applied under the old watch/pro/sanral_pro scheme, where Watch
// was genuinely limited). The one real trial limit stays a single bid pack
// total, enforced in SQL by company_can_request_pack() - not a function of
// this constant.
export const TRIAL_DEFAULT_PLAN: PlanTier = "professional";

export const PLAN_LABEL: Record<PlanTier, string> = {
  starter: "Starter",
  professional: "Professional",
  business: "Business",
  enterprise: "Enterprise",
};

// Rand, excl. VAT. Enterprise is null - priced on request, never a fixed
// number.
export const PLAN_MONTHLY_ZAR: Record<PlanTier, number | null> = {
  starter: 1490,
  professional: 2990,
  business: 4990,
  enterprise: null,
};

export type PlanLimits = { maxUsers: number | null; maxPacksPerMonth: number | null };

// null/null for enterprise - scoped and quoted per customer, not a fixed
// self-serve number.
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  starter: { maxUsers: 2, maxPacksPerMonth: 5 },
  professional: { maxUsers: 5, maxPacksPerMonth: 15 },
  business: { maxUsers: 10, maxPacksPerMonth: 30 },
  enterprise: { maxUsers: null, maxPacksPerMonth: null },
};

// Only these three are ever something to actually subscribe/pay for via
// PayFast - Enterprise is priced on request (contact us), never a
// self-serve checkout.
export const PAYABLE_PLAN_TIERS = ["starter", "professional", "business"] as const satisfies readonly PlanTier[];

export function isPayablePlan(plan: PlanTier): plan is (typeof PAYABLE_PLAN_TIERS)[number] {
  return (PAYABLE_PLAN_TIERS as readonly PlanTier[]).includes(plan);
}

// "Yearly billing at 2 months free": paying for 10 months' worth up front
// covers all 12 - computed here, never hardcoded as a second literal price
// anywhere else (the checkout route, the /billing page and this file's own
// test all call this one function).
export function yearlyPriceZar(monthlyZar: number): number {
  return monthlyZar * 10;
}

// Payable tiers only - Enterprise has no fixed price (PLAN_MONTHLY_ZAR.enterprise
// is null) and is never passed here; callers that iterate pricing cards
// branch on isPayablePlan() first, same as the checkout route and /billing
// page already do.
export function priceForPlanZar(plan: (typeof PAYABLE_PLAN_TIERS)[number], interval: BillingInterval): number {
  const monthly = PLAN_MONTHLY_ZAR[plan] as number;
  return interval === "yearly" ? yearlyPriceZar(monthly) : monthly;
}

// PayFast wants a plain string with exactly 2 decimal places, e.g. "1490.00" -
// never thousands separators (app/page.tsx's own "R1,490" display string
// would be rejected by PayFast's own amount validation).
export function priceForPayfastAmount(plan: (typeof PAYABLE_PLAN_TIERS)[number], interval: BillingInterval): string {
  return priceForPlanZar(plan, interval).toFixed(2);
}

export type CompanySubscriptionRow = {
  planTier: PlanTier;
  billingInterval: BillingInterval;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  maxUsers: number | null;
  maxPacksPerMonth: number | null;
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

// trialing/active keep full access; past_due/cancelled (including a trial
// that lapsed with no payment on file) show a banner, not a silent
// lock-out and not silent continued access either. Per-tier usage gating
// (seats, bid packs/month) is separate and real now - company_can_request_pack()
// and the seat check in app/company/team/actions.ts (migration 0083) - this
// function is about the SUBSCRIPTION's own state, not a specific limit.
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
