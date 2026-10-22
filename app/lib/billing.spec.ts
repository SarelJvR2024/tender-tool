import { describe, expect, it } from "vitest";
import {
  effectiveSubscriptionStatus,
  isPayablePlan,
  isSubscriptionLapsed,
  PLAN_LIMITS,
  PLAN_MONTHLY_ZAR,
  priceForPlanZar,
  priceForPayfastAmount,
  trialDaysLeft,
  yearlyPriceZar,
  type CompanySubscriptionRow,
} from "./billing";

function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
}

const base: CompanySubscriptionRow = {
  planTier: "professional",
  billingInterval: "monthly",
  status: "trialing",
  trialEndsAt: daysFromNow(10),
  maxUsers: 5,
  maxPacksPerMonth: 15,
};

describe("yearlyPriceZar / priceForPlanZar", () => {
  it("yearly is exactly 10x monthly - '2 months free', computed not hardcoded", () => {
    expect(yearlyPriceZar(1490)).toBe(14900);
    expect(yearlyPriceZar(2990)).toBe(29900);
    expect(yearlyPriceZar(4990)).toBe(49900);
  });

  it("matches Sarel's own confirmed pricing (Starter/Professional/Business)", () => {
    expect(priceForPlanZar("starter", "monthly")).toBe(1490);
    expect(priceForPlanZar("starter", "yearly")).toBe(14900);
    expect(priceForPlanZar("professional", "monthly")).toBe(2990);
    expect(priceForPlanZar("professional", "yearly")).toBe(29900);
    expect(priceForPlanZar("business", "monthly")).toBe(4990);
    expect(priceForPlanZar("business", "yearly")).toBe(49900);
  });

  it("formats for PayFast as a 2-decimal string, no thousands separator", () => {
    expect(priceForPayfastAmount("starter", "monthly")).toBe("1490.00");
    expect(priceForPayfastAmount("business", "yearly")).toBe("49900.00");
  });
});

describe("PLAN_LIMITS / PLAN_MONTHLY_ZAR", () => {
  it("every self-serve tier has a fixed price and real seat/pack limits", () => {
    expect(PLAN_LIMITS.starter).toEqual({ maxUsers: 2, maxPacksPerMonth: 5 });
    expect(PLAN_LIMITS.professional).toEqual({ maxUsers: 5, maxPacksPerMonth: 15 });
    expect(PLAN_LIMITS.business).toEqual({ maxUsers: 10, maxPacksPerMonth: 30 });
  });

  it("enterprise is unlimited/custom on both axes - priced and scoped on request", () => {
    expect(PLAN_LIMITS.enterprise).toEqual({ maxUsers: null, maxPacksPerMonth: null });
    expect(PLAN_MONTHLY_ZAR.enterprise).toBeNull();
  });
});

describe("PAYABLE_PLAN_TIERS / isPayablePlan", () => {
  it("enterprise is never self-serve payable", () => {
    expect(isPayablePlan("enterprise")).toBe(false);
    expect(isPayablePlan("starter")).toBe(true);
    expect(isPayablePlan("professional")).toBe(true);
    expect(isPayablePlan("business")).toBe(true);
  });
});

describe("effectiveSubscriptionStatus / isSubscriptionLapsed", () => {
  it("a trial within its window stays trialing, not lapsed", () => {
    expect(effectiveSubscriptionStatus(base)).toBe("trialing");
    expect(isSubscriptionLapsed(base)).toBe(false);
  });

  it("a trial past trial_ends_at reads as past_due, even though the stored status is still 'trialing'", () => {
    const lapsed: CompanySubscriptionRow = { ...base, trialEndsAt: daysFromNow(-1) };
    expect(effectiveSubscriptionStatus(lapsed)).toBe("past_due");
    expect(isSubscriptionLapsed(lapsed)).toBe(true);
  });

  it("active stays active regardless of trial_ends_at (a real paid subscription, trial_ends_at is stale/irrelevant)", () => {
    const active: CompanySubscriptionRow = { ...base, status: "active", trialEndsAt: daysFromNow(-30) };
    expect(effectiveSubscriptionStatus(active)).toBe("active");
    expect(isSubscriptionLapsed(active)).toBe(false);
  });

  it("past_due and cancelled are both lapsed", () => {
    expect(isSubscriptionLapsed({ ...base, status: "past_due" })).toBe(true);
    expect(isSubscriptionLapsed({ ...base, status: "cancelled" })).toBe(true);
  });
});

describe("trialDaysLeft", () => {
  it("null once not trialing", () => {
    expect(trialDaysLeft({ ...base, status: "active" })).toBeNull();
  });

  it("counts down, floored, never negative", () => {
    expect(trialDaysLeft({ ...base, trialEndsAt: daysFromNow(5) })).toBe(5);
    expect(trialDaysLeft({ ...base, trialEndsAt: daysFromNow(-3) })).toBe(0);
  });
});
