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
  tender_packs: { company_id: string }[];
};

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
    for (const companyId of (tender.tender_packs ?? []).map((p) => p.company_id).filter(Boolean)) {
      out.push({ tender, companyId, daysLeft, threshold });
    }
  }
  return out;
}
