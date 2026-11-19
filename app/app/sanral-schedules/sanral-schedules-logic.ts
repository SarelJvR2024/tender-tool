/**
 * Pure, DB-free helper for the SANRAL schedules front door
 * (sanral-schedules/page.tsx) - this list exists so a company can jump
 * straight to "the real action on whichever SANRAL tender the company is
 * working on" (that page's own header comment). Once a tender's own
 * `tender_packs.pipeline_stage` reaches `submitted`/`briefing_shortlisted`/
 * `won`/`lost`, there is no more "filling schedules" action left for it -
 * the same `DEADLINE_REMINDER_EXCLUDED_STAGES` every other "closing
 * soon"/"still needs action" surface in this codebase already applies
 * (the topbar bell - Finding 434, the Home dashboard stat card - Finding
 * 435, the deadline/returnables/briefing/print-cutoff reminder emails).
 * `page.tsx` never read `pipeline_stage` at all before this fix, so a
 * tender the company had already submitted, won or lost stayed listed on
 * this "front door" forever, with a "Fill SANRAL schedules" button
 * pointing at nothing left to fill.
 */
import { DEADLINE_REMINDER_EXCLUDED_STAGES } from "../../lib/deadlineReminders.ts";

export function isActiveSanralScheduleTender(tenderPacks: { pipeline_stage: string | null }[]): boolean {
  const stage = tenderPacks[0]?.pipeline_stage;
  return !stage || !(DEADLINE_REMINDER_EXCLUDED_STAGES as readonly string[]).includes(stage);
}
