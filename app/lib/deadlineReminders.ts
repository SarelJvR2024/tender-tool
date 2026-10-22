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

export type DeadlineReminderTenderRow = {
  id: string;
  contract_no: string | null;
  description: string | null;
  closing_date: string | null;
  tender_packs: { company_id: string }[];
};

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
    for (const companyId of (tender.tender_packs ?? []).map((p) => p.company_id).filter(Boolean)) {
      out.push({ tender, companyId, daysLeft, threshold });
    }
  }
  return out;
}
