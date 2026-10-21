import { describe, expect, it } from "vitest";
import {
  effectiveSubscriptionStatus,
  isSubscriptionLapsed,
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
  planTier: "sanral_pro",
  billingInterval: "monthly",
  status: "trialing",
  trialEndsAt: daysFromNow(10),
};

describe("yearlyPriceZar / priceForPlanZar", () => {
  it("yearly is exactly 10x monthly - '2 months free', computed not hardcoded", () => {
    expect(yearlyPriceZar(1490)).toBe(14900);
    expect(yearlyPriceZar(3950)).toBe(39500);
  });

  it("matches app/page.tsx's own PRICING_TIERS numbers", () => {
    expect(priceForPlanZar("pro", "monthly")).toBe(1490);
    expect(priceForPlanZar("pro", "yearly")).toBe(14900);
    expect(priceForPlanZar("sanral_pro", "monthly")).toBe(3950);
    expect(priceForPlanZar("sanral_pro", "yearly")).toBe(39500);
    expect(priceForPlanZar("watch", "monthly")).toBe(0);
  });

  it("formats for PayFast as a 2-decimal string, no thousands separator", () => {
    expect(priceForPayfastAmount("pro", "monthly")).toBe("1490.00");
    expect(priceForPayfastAmount("sanral_pro", "yearly")).toBe("39500.00");
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
