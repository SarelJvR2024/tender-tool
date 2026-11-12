// Pure threshold logic for the briefing-session countdown alert
// (Operational Notification Engine) - "5 days and 24 hours prior", same
// bounded-range + per-company-fanout shape as lib/deadlineReminders.ts's
// own closing-date reminder (including the same QA fix: a tender is the
// shared/public table, tender_packs is unique(company_id, tender_id) not
// unique(tender_id), so more than one company routinely tracks the same
// tender and must each get their own candidate/dedupe row).
//
// Honest naming note: the brief called this a "Compulsory Briefing"
// alert, but tenders.briefing_date/briefing_time (migration 0048) never
// stores whether a briefing is compulsory once a tender is pursued - only
// the pre-pursue discovered_opportunities.briefing JSON (a different table,
// scraped from the listing) carries that flag, and it isn't reliably
// joinable back to a pursued tender for every case. Rather than silently
// treat every briefing as compulsory (or fabricate a flag), this alert
// fires for any briefing date on file and says "Briefing session", not
// "Compulsory briefing" - see lib/emailTemplates.ts's own briefingReminderEmail().
export const BRIEFING_REMINDER_THRESHOLD_DAYS = [5, 1] as const; // 1 day = "24 hours"
export type BriefingReminderThresholdDays = (typeof BRIEFING_REMINDER_THRESHOLD_DAYS)[number];

/**
 * Which briefing-reminder threshold, if any, daysLeft is due for right now
 * - a bounded RANGE per threshold, not an exact calendar-day match (QA
 * Finding 404, 2026-11-11). This function's own header previously claimed
 * an exact `[5, 1].includes(daysLeft)` match "fires once per tender" - the
 * identical misconception Findings 387/401/403 already debunked for their
 * own sibling threshold functions: firing-once is guaranteed by
 * `record_operational_alert_sent()`'s own dedupe key (migration 0092:
 * `alert_type, tender_id, company_id, threshold_key`, where
 * `threshold_key` is the THRESHOLD itself - `String(threshold)`, i.e. "5"
 * or "1" - not `daysLeft`; confirmed by reading `scripts/send-operational-
 * alerts.ts`'s own `claim()` call site), not by the match being exact.
 * `scripts/send-operational-alerts.ts` runs once a day via a GitHub
 * Actions cron (`.github/workflows/operational-alerts.yml`), and scheduled
 * workflows are documented to occasionally skip or run late - if that
 * happens on the one calendar day a tender's `daysLeft` was exactly 5 or
 * exactly 1, that tender/company's briefing-session warning was lost for
 * good: the compulsory pre-bid briefing this reminder exists for cannot be
 * attended after the fact, unlike a closing-date or clarification-window
 * reminder where the underlying deadline is still ahead on a later day.
 * Same fix pattern as `lib/trialLifecycle.ts`'s `trialDay7Candidates()`
 * (387), `lib/clarificationWindowReminders.ts`'s `clarificationThresholdFor()`
 * (401) and `lib/deadlineReminders.ts`'s `reminderThresholdFor()` (403) -
 * the 5-day window is floored just above the 1-day window so the two never
 * compete for the same day; the 1-day window is floored at 0 so a briefing
 * already today or past stays out of scope, matching the original exact
 * match's own scope (it never matched 0 or a negative number either).
 */
export function briefingThresholdFor(daysLeft: number): BriefingReminderThresholdDays | null {
  if (daysLeft <= 5 && daysLeft > 1) return 5;
  if (daysLeft <= 1 && daysLeft > 0) return 1;
  return null;
}

export type BriefingReminderTenderRow = {
  id: string;
  contract_no: string | null;
  description: string | null;
  briefing_date: string | null;
  briefing_time: string | null;
  tender_packs: { company_id: string; pipeline_stage: string }[];
};

// Finding (standing solution-architect review, 2026-11-09): the same
// "already past this milestone" exclusion lib/deadlineReminders.ts
// (DEADLINE_REMINDER_EXCLUDED_STAGES), lib/clarificationWindowReminders.ts
// (isClarificationCandidate) and lib/printCutoffReminders.ts (CLOSED_STAGES)
// each already apply - a company that has submitted, been
// briefed/shortlisted, or had the tender decided (won/lost) has nothing
// left to do with a "briefing session in 5 days/24 hours" nag: the
// compulsory pre-bid briefing this reminder is about is only ever relevant
// before that point. This file never had the guard at all (tender_packs
// carried no pipeline_stage, and the caller's own query didn't even select
// it), so a company stuck on an already-decided tender whose briefing_date
// is later moved out by a corrigendum (watch_tender_updates.py's own
// apply_briefing_date(), independent of any one company's pipeline_stage,
// since tenders is the shared/public table) would still get nagged.
export const BRIEFING_REMINDER_EXCLUDED_STAGES = ["submitted", "briefing_shortlisted", "won", "lost"] as const;

export type BriefingReminderCandidate = {
  tender: BriefingReminderTenderRow;
  companyId: string;
  daysLeft: number;
  threshold: BriefingReminderThresholdDays;
};

export function briefingReminderCandidates(
  tenderRows: BriefingReminderTenderRow[],
  daysUntilFn: (dateStr: string | null) => number | null
): BriefingReminderCandidate[] {
  const out: BriefingReminderCandidate[] = [];
  for (const tender of tenderRows) {
    const daysLeft = daysUntilFn(tender.briefing_date);
    if (daysLeft === null) continue;
    const threshold = briefingThresholdFor(daysLeft);
    if (threshold === null) continue;
    for (const pack of tender.tender_packs ?? []) {
      if (!pack.company_id) continue;
      if ((BRIEFING_REMINDER_EXCLUDED_STAGES as readonly string[]).includes(pack.pipeline_stage)) continue;
      out.push({ tender, companyId: pack.company_id, daysLeft, threshold });
    }
  }
  return out;
}

export type BriefingWatchedDocRow = {
  tender_id: string;
  first_seen_at: string;
  changes: { briefing?: { cancelled?: boolean } } | null;
};

/**
 * Tender ids whose MOST RECENTLY detected briefing-change signal (by
 * `first_seen_at`) says the compulsory briefing session was CANCELLED -
 * `engine/discovery/tender_updates.py`'s `find_briefing_change()` writes
 * `changes.briefing = {date: null, cancelled: true, ...}` for this (the
 * same sentinel Finding 446 fixed for the corrigendum alert email).
 *
 * Finding 448: `tenders.briefing_date`/`briefing_time` is never cleared
 * when a briefing is cancelled. `watch_tender_updates.py`'s own
 * `apply_briefing_date()` only ever runs for a NEW date (`apply_b` requires
 * `b.get("date")` truthy, false by design for the cancelled sentinel), and
 * `accept_tender_update_date()` (migration 0111) explicitly REFUSES to
 * accept a cancelled briefing ("The briefing was cancelled, there is no
 * date to accept") - there is no automatic OR manual path anywhere that
 * ever clears it. So `briefingReminderCandidates()` above, reading
 * `tenders.briefing_date` alone, would otherwise keep firing the 5-day/
 * 24-hour "Briefing session" reminder email for a session the Tender
 * Workspace page (`tender-updates.tsx`) already correctly tells the SAME
 * person was cancelled (`briefing.cancelled` - a truthy-object check,
 * never `briefing.date`).
 *
 * This reads that identical signal to suppress the email the same way,
 * rather than ever clearing the stored date itself: `BRIEFING_CANCELLED_RE`
 * is matched against free text with no second source to corroborate it
 * against (unlike a closing-date change, which only auto-applies when the
 * source listing independently agrees) - a false match here should only
 * ever suppress one duplicate notice, never silently delete a real
 * briefing date nobody could then get back.
 *
 * A tender can have several watched documents over time; a cancellation
 * later superseded by a new addendum reinstating or moving the briefing is
 * no longer "cancelled" (that later document's own `changes.briefing` has
 * no `cancelled` key) - only the LATEST document that says anything about
 * the briefing at all decides this, per tender.
 */
export function tendersWithCancelledBriefing(docs: BriefingWatchedDocRow[]): Set<string> {
  const latestByTender = new Map<string, BriefingWatchedDocRow>();
  for (const doc of docs) {
    if (!doc.tender_id || !doc.changes?.briefing) continue;
    const prev = latestByTender.get(doc.tender_id);
    if (!prev || doc.first_seen_at > prev.first_seen_at) latestByTender.set(doc.tender_id, doc);
  }
  const out = new Set<string>();
  for (const [tenderId, doc] of latestByTender) {
    if (doc.changes?.briefing?.cancelled) out.add(tenderId);
  }
  return out;
}
