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

  it("fires at the day-7 threshold itself", () => {
    const daysUntilFn = (d: string | null) => (d === sub.trial_ends_at ? TRIAL_DAY_7_AT_DAYS_LEFT : 999);
    expect(trialDay7Candidates([sub], daysUntilFn)).toEqual([sub]);
  });

  it("never fires for a subscription that has already converted to paid", () => {
    const active = { ...sub, status: "active" };
    expect(trialDay7Candidates([active], () => TRIAL_DAY_7_AT_DAYS_LEFT)).toEqual([]);
  });

  it("does not fire before day 7 (too early)", () => {
    expect(trialDay7Candidates([sub], () => 8)).toEqual([]);
  });

  // Standing review, 2026-11-11: this is the real fix - trialDay7Candidates()
  // used to be an EXACT match (only daysLeft === 7), the one candidate
  // function in this file with no retry safety at all. A company whose one
  // qualifying run was missed (a cron misfire, a transient read error - see
  // send-onboarding-nudges.ts's own Finding 162) never got the nudge again,
  // since daysLeft only ever passes through 7 once, going down. Now a RANGE,
  // same retry-safe shape as trialExpiringCandidates/trialExpiredCandidates
  // below - the one-time idempotency claim (not this function) is still
  // what prevents a double-send, so widening this changes no dedupe logic.
  it("still fires on any day between the 7-day mark and the 48h 'expiring' handoff - the actual fix, catching up a missed day-7 run", () => {
    expect(trialDay7Candidates([sub], () => 6)).toEqual([sub]);
    expect(trialDay7Candidates([sub], () => 5)).toEqual([sub]);
    expect(trialDay7Candidates([sub], () => 3)).toEqual([sub]);
  });

  it("stops at the floor so it never overlaps trialExpiringCandidates()'s own 48-hour window", () => {
    expect(trialDay7Candidates([sub], () => 2)).toEqual([]);
    expect(trialDay7Candidates([sub], () => 0)).toEqual([]);
    expect(trialDay7Candidates([sub], () => -1)).toEqual([]);
  });

  it("never fires once daysUntilFn returns null (no trial_ends_at on file)", () => {
    expect(trialDay7Candidates([sub], () => null)).toEqual([]);
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
