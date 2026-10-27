// Pure threshold logic for the Clarification Window Expiry reminder
// (notification engine migration brief, item A4) - 10 days and "48h" before
// a tender's question-cutoff date.
//
// Honest scoping note: this schema has no auto-extracted question-cutoff
// date anywhere (confirmed by reading every migration - unlike
// briefing_date/closing_date, nothing in engine/discovery ever writes one).
// The only real backing fact is tender_tasks.kind = 'clarification'
// (migration 0009/0021's own standard-milestone enum) with a MANUALLY-typed
// due_date - a plain `date` column, no time component. So "48 hours" can't
// mean anything more precise than 2 whole days here; this reminder fires at
// exactly 10 and 2 days left, the closest honest equivalent, rather than
// fabricating intraday precision a date-only column can't support. Coverage
// is therefore limited to tenders where a person has actually added a
// clarification-window task - real, but not automatic the way briefing/
// closing reminders are.
export const CLARIFICATION_WINDOW_THRESHOLD_DAYS = [10, 2] as const;
export type ClarificationWindowThresholdDays = (typeof CLARIFICATION_WINDOW_THRESHOLD_DAYS)[number];

export function clarificationThresholdFor(daysLeft: number): ClarificationWindowThresholdDays | null {
  return (CLARIFICATION_WINDOW_THRESHOLD_DAYS as readonly number[]).includes(daysLeft) ? (daysLeft as ClarificationWindowThresholdDays) : null;
}

export type ClarificationTaskRow = {
  id: string;
  company_id: string;
  tender_id: string;
  description: string;
  due_date: string | null;
  status: "not_started" | "in_progress" | "done";
  kind: string | null;
};

export type ClarificationWindowCandidate = {
  task: ClarificationTaskRow;
  daysLeft: number;
  threshold: ClarificationWindowThresholdDays;
};

/** Every clarification task due a reminder today - kind='clarification', not already done (a completed task has nothing left to remind about). */
export function clarificationWindowCandidates(
  taskRows: ClarificationTaskRow[],
  daysUntilFn: (dateStr: string | null) => number | null,
): ClarificationWindowCandidate[] {
  const out: ClarificationWindowCandidate[] = [];
  for (const task of taskRows) {
    if (task.kind !== "clarification" || task.status === "done") continue;
    const daysLeft = daysUntilFn(task.due_date);
    if (daysLeft === null) continue;
    const threshold = clarificationThresholdFor(daysLeft);
    if (threshold === null) continue;
    out.push({ task, daysLeft, threshold });
  }
  return out;
}
