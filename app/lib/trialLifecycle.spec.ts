import { describe, expect, it } from "vitest";
import {
  trialDay7Candidates,
  trialExpiredCandidates,
  trialExpiringCandidates,
  TRIAL_DAY_7_AT_DAYS_LEFT,
  TRIAL_EXPIRING_HOURS_THRESHOLD,
  type TrialSubscriptionRow,
} from "./trialLifecycle";

const NOW = new Date("2026-10-24T12:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 60 * 60 * 1000).toISOString();

describe("trialDay7Candidates", () => {
  const sub: TrialSubscriptionRow = { company_id: "c1", status: "trialing", trial_ends_at: "2026-11-01" };

  it("fires only for a trialing subscription exactly at the day-7 threshold", () => {
    const daysUntilFn = (d: string | null) => (d === sub.trial_ends_at ? TRIAL_DAY_7_AT_DAYS_LEFT : 999);
    expect(trialDay7Candidates([sub], daysUntilFn)).toEqual([sub]);
  });

  it("never fires for a subscription that has already converted to paid", () => {
    const active = { ...sub, status: "active" };
    expect(trialDay7Candidates([active], () => TRIAL_DAY_7_AT_DAYS_LEFT)).toEqual([]);
  });

  it("off-threshold day counts yield nothing", () => {
    expect(trialDay7Candidates([sub], () => 6)).toEqual([]);
    expect(trialDay7Candidates([sub], () => 8)).toEqual([]);
  });
});

describe("trialExpiringCandidates", () => {
  it("fires within the 48-hour window", () => {
    const sub: TrialSubscriptionRow = { company_id: "c1", status: "trialing", trial_ends_at: hoursFromNow(24) };
    expect(trialExpiringCandidates([sub], NOW)).toEqual([sub]);
  });

  it("does not fire outside the window (too far out, or already passed)", () => {
    const tooFar: TrialSubscriptionRow = { company_id: "c1", status: "trialing", trial_ends_at: hoursFromNow(TRIAL_EXPIRING_HOURS_THRESHOLD + 1) };
    const passed: TrialSubscriptionRow = { company_id: "c2", status: "trialing", trial_ends_at: hoursFromNow(-1) };
    expect(trialExpiringCandidates([tooFar, passed], NOW)).toEqual([]);
  });

  it("never fires for a non-trialing subscription", () => {
    const active: TrialSubscriptionRow = { company_id: "c1", status: "active", trial_ends_at: hoursFromNow(24) };
    expect(trialExpiringCandidates([active], NOW)).toEqual([]);
  });
});

describe("trialExpiredCandidates", () => {
  it("fires once trial_ends_at has passed", () => {
    const sub: TrialSubscriptionRow = { company_id: "c1", status: "trialing", trial_ends_at: hoursFromNow(-1) };
    expect(trialExpiredCandidates([sub], NOW)).toEqual([sub]);
  });

  it("does not fire while still within the trial", () => {
    const sub: TrialSubscriptionRow = { company_id: "c1", status: "trialing", trial_ends_at: hoursFromNow(1) };
    expect(trialExpiredCandidates([sub], NOW)).toEqual([]);
  });

  it("never fires for a subscription that already converted to paid", () => {
    const active: TrialSubscriptionRow = { company_id: "c1", status: "active", trial_ends_at: hoursFromNow(-1) };
    expect(trialExpiredCandidates([active], NOW)).toEqual([]);
  });
});
