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

/**
 * Which reminder threshold, if any, daysLeft is due for right now - a
 * bounded RANGE per threshold, not an exact calendar-day match (QA Finding
 * 403, 2026-11-11): this file's own header comment, and the pre-fix version
 * of this function, previously justified an exact match with "so each
 * threshold fires once per tender" - but that's actually guaranteed by
 * `record_deadline_reminder_sent()`'s own dedupe key (`tender_id,
 * company_id, threshold_days` - migration 0080), which has no day/date
 * component at all. The one-time claim, not this match, is what prevents a
 * double-send - so an exact match bought no correctness and was only an
 * unnecessary single point of failure: scripts/send-deadline-reminders.ts
 * runs once a day via a GitHub Actions cron
 * (.github/workflows/deadline-reminders.yml), and scheduled workflows are
 * documented to occasionally skip or run late - if that happens on the one
 * calendar day a tender's daysLeft was exactly 3 or exactly 1, that
 * tender/company's "closing in 3 days"/"24 hours" warning was lost for
 * good, with no way to ever catch up, since every later day's daysLeft is a
 * different integer matching neither threshold. Same shape, same fix
 * pattern, as `lib/trialLifecycle.ts`'s `trialDay7Candidates()` (Finding
 * 387) and `lib/clarificationWindowReminders.ts`'s
 * `clarificationThresholdFor()` (Finding 401) - the 3-day window is floored
 * just above the 1-day window so the two never compete for the same day;
 * the 1-day window is floored at 0 so a tender already closing today or
 * overdue stays out of scope, matching the original exact match's own
 * scope (it never matched 0 or a negative number either).
 */
export function reminderThresholdFor(daysLeft: number): ReminderThresholdDays | null {
  if (daysLeft <= 3 && daysLeft > 1) return 3;
  if (daysLeft <= 1 && daysLeft > 0) return 1;
  return null;
}

export type DeadlineReminderTenderRow = {
  id: string;
  contract_no: string | null;
  description: string | null;
  closing_date: string | null;
  tender_packs: { company_id: string; pipeline_stage: string }[];
};

// A submitted (or later) bid no longer needs a "closing in N days" reminder
// - the deadline it's warning about has already been met. briefing_shortlisted
// only ever follows submitted (lib/pipeline.ts's NEXT_STAGES), so it's
// excluded for the same reason. See RETURNABLES_EXCLUDED_STAGES
// (lib/returnablesDigestCandidates.ts) for the identical reasoning applied
// to that digest.
export const DEADLINE_REMINDER_EXCLUDED_STAGES = ["submitted", "briefing_shortlisted", "won", "lost"] as const;

export type DeadlineReminderCandidate = {
  tender: DeadlineReminderTenderRow;
  companyId: string;
  daysLeft: number;
  threshold: ReminderThresholdDays;
};

/**
 * Every (tender, company, threshold) due a reminder today - one entry PER
 * COMPANY actually tracking the tender via tender_packs, not one per tender.
 *
 * tenders are the shared/public table (0001's own split: the daily discovery
 * pipeline's one feed serves every tenant) and tender_packs is `unique
 * (company_id, tender_id)`, not `unique (tender_id)` - so more than one
 * unrelated company routinely tracks the exact same tender. A fix pulled out
 * of scripts/send-deadline-reminders.ts (QA Finding, 2026-10-22): that
 * script used to read only tender.tender_packs[0].company_id and call
 * record_deadline_reminder_sent once per TENDER, which silently dropped
 * every other tracking company's reminder for good (the dedupe row's own
 * unique constraint was keyed by tender+threshold only, with no company_id
 * at all - see migration 0080's header comment).
 *
 * `daysUntilFn` is injected rather than imported (this file's own header
 * comment explains why: direct-node execution can't resolve lib/dates.ts's
 * own import chain), so this function stays testable without a bundler.
 */
export function deadlineReminderCandidates(
  tenderRows: DeadlineReminderTenderRow[],
  daysUntilFn: (closingDate: string | null) => number | null
): DeadlineReminderCandidate[] {
  const out: DeadlineReminderCandidate[] = [];
  for (const tender of tenderRows) {
    const daysLeft = daysUntilFn(tender.closing_date);
    if (daysLeft === null || daysLeft > DEADLINE_WINDOW_DAYS) continue;
    const threshold = reminderThresholdFor(daysLeft);
    if (threshold === null) continue;
    for (const pack of tender.tender_packs ?? []) {
      if (!pack.company_id) continue;
      if ((DEADLINE_REMINDER_EXCLUDED_STAGES as readonly string[]).includes(pack.pipeline_stage)) continue;
      out.push({ tender, companyId: pack.company_id, daysLeft, threshold });
    }
  }
  return out;
}
