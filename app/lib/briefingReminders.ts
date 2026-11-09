// Pure threshold logic for the briefing-session countdown alert
// (Operational Notification Engine) - "5 days and 24 hours prior", same
// exact-day-match + per-company-fanout shape as lib/deadlineReminders.ts's
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

export function briefingThresholdFor(daysLeft: number): BriefingReminderThresholdDays | null {
  return (BRIEFING_REMINDER_THRESHOLD_DAYS as readonly number[]).includes(daysLeft) ? (daysLeft as BriefingReminderThresholdDays) : null;
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
