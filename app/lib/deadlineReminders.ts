// Pure threshold logic for the deadline-reminder email - "closing in 3
// days / 24 hours", Sarel's own two named priorities.
//
// DEADLINE_WINDOW_DAYS lives HERE, not in lib/notifications.ts (which reads
// it back from here) - scripts/send-deadline-reminders.ts (run directly via
// `node --experimental-strip-types`, no bundler) needs to import this
// constant, and lib/notifications.ts has its own extensionless relative
// import ("./dates") that direct node execution can't resolve (the exact
// limitation app/AGENTS.md's "Verify/Provide/Fix grouping" entry documents
// for `pack-review-logic.ts`'s "zero imports" rule) - confirmed by trying
// it. Keeping the one shared constant in this import-light file instead
// means both the bell (lib/notifications.ts) and the reminder script read
// the exact same window, with neither forced through the other's own
// unresolvable import chain.
export const DEADLINE_WINDOW_DAYS = 14;

export const REMINDER_THRESHOLD_DAYS = [3, 1] as const; // 1 day = "24 hours"
export type ReminderThresholdDays = (typeof REMINDER_THRESHOLD_DAYS)[number];

/** Whether daysLeft exactly matches one of the two reminder thresholds - never "within", always an exact calendar-day match, so each threshold fires once per tender (see sent_deadline_reminders' own unique constraint for the actual dedupe). */
export function reminderThresholdFor(daysLeft: number): ReminderThresholdDays | null {
  return (REMINDER_THRESHOLD_DAYS as readonly number[]).includes(daysLeft) ? (daysLeft as ReminderThresholdDays) : null;
}
