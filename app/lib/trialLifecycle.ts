// Tier 0 trial lifecycle - candidate selection only. Every company gets a
// company_subscriptions row the moment it's created (migration 0078's own
// trigger), status defaulting to 'trialing' with trial_ends_at = signup + 14
// days - these 3 triggers read exactly that row, nothing invented. Payment
// cancellation needs no separate step here: apply_payfast_itn (0078) flips
// status away from 'trialing' the moment a payment succeeds, and every
// function below only ever selects status = 'trialing' rows in the first
// place - see lib/emailTemplatesTier0.ts's own header comment on why that's
// enough.
import { daysUntil } from "./dates.ts";

export type TrialSubscriptionRow = {
  company_id: string;
  status: string;
  trial_ends_at: string | null;
};

// A 14-day trial's own midpoint-plus check-in - "day 7" means exactly 7
// days left, not "7 days have passed" (both describe the same moment for a
// 14-day trial, but trial_ends_at - not a stored trial_starts_at - is the
// only column that actually exists, so counting down from it is what this
// can honestly compute).
export const TRIAL_DAY_7_AT_DAYS_LEFT = 7;

/**
 * daysUntilFn injected, same precedent as lib/briefingReminders.ts/lib/complianceExpiryReminders.ts - lib/dates.ts's own daysUntil() in production, a stub in tests.
 * Generic over T so a caller can pass rows carrying extra fields (e.g. a joined company name) straight through without a cast.
 */
export function trialDay7Candidates<T extends TrialSubscriptionRow>(subs: T[], daysUntilFn: (dateStr: string | null) => number | null = daysUntil): T[] {
  return subs.filter((s) => s.status === "trialing" && daysUntilFn(s.trial_ends_at) === TRIAL_DAY_7_AT_DAYS_LEFT);
}

// Hour-precision, not day-precision, for the other two - same reasoning
// lib/dispatchTriage.ts's own printSignDeadline()/hoursUntilPrintSignDeadline()
// give for why a 48-hour threshold needs real hours, not a ceil()'d day
// count that could fire anywhere from just-over-24h to a full 48h out.
export const TRIAL_EXPIRING_HOURS_THRESHOLD = 48;

export function trialExpiringCandidates<T extends TrialSubscriptionRow>(subs: T[], now: Date = new Date()): T[] {
  return subs.filter((s) => {
    if (s.status !== "trialing" || !s.trial_ends_at) return false;
    const hoursLeft = (new Date(s.trial_ends_at).getTime() - now.getTime()) / (1000 * 60 * 60);
    return hoursLeft > 0 && hoursLeft <= TRIAL_EXPIRING_HOURS_THRESHOLD;
  });
}

export function trialExpiredCandidates<T extends TrialSubscriptionRow>(subs: T[], now: Date = new Date()): T[] {
  return subs.filter((s) => {
    if (s.status !== "trialing" || !s.trial_ends_at) return false;
    return new Date(s.trial_ends_at).getTime() <= now.getTime();
  });
}
