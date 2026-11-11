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

// Standing review, 2026-11-11: this used to be an EXACT match
// (`daysUntilFn(...) === TRIAL_DAY_7_AT_DAYS_LEFT`) - the one candidate
// function in this file with no retry safety at all, unlike its own two
// true siblings below (trialExpiringCandidates/trialExpiredCandidates),
// both deliberately RANGE-based so a missed run self-heals on the next one.
// scripts/send-onboarding-nudges.ts's own header comment on `lifecycleRecipients()`
// (Finding 162, 2026-11-07) already named the worst case in passing - "a
// company that hits this failure on its one qualifying day never gets a
// retry, since the very next run no longer matches" - but that pass fixed
// only the discarded-error logging around it, not this exact-match shape
// itself; the same risk is just as real from a missed/delayed GitHub
// Actions cron run (no code bug needed at all - scheduled workflows are
// documented to occasionally skip or run late under load) as from a read
// failure. Widened to a range, floored just above
// trialExpiringCandidates()'s own 48-hour window so the two never compete
// for the same day. This is safe to widen with NO change to how often the
// email actually sends: send-onboarding-nudges.ts's own idempotency key for
// this notification (`trial-day-7-<company_id>-<user_id>`) has no day/
// threshold component at all, so - exactly like the other two candidate
// functions - claim_notification()'s own one-time-ever claim (migration
// 0092) is what prevents a double-send, not this function matching only
// one day; widening the window only adds the ability to catch up on a
// later run, it changes no dedupe logic.
const TRIAL_DAY_7_FLOOR_DAYS_LEFT = 2;

/**
 * daysUntilFn injected, same precedent as lib/briefingReminders.ts/lib/complianceExpiryReminders.ts - lib/dates.ts's own daysUntil() in production, a stub in tests.
 * Generic over T so a caller can pass rows carrying extra fields (e.g. a joined company name) straight through without a cast.
 */
export function trialDay7Candidates<T extends TrialSubscriptionRow>(subs: T[], daysUntilFn: (dateStr: string | null) => number | null = daysUntil): T[] {
  return subs.filter((s) => {
    if (s.status !== "trialing") return false;
    const left = daysUntilFn(s.trial_ends_at);
    return left !== null && left <= TRIAL_DAY_7_AT_DAYS_LEFT && left > TRIAL_DAY_7_FLOOR_DAYS_LEFT;
  });
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
