// Timeline warnings for the two real decision-window dates on a tender -
// the compulsory briefing and the submission (closing) date - so a person
// deciding whether to pursue a tender, or already preparing a bid, sees how
// much runway is actually left, not just a bare date on a card.
//
// Deliberately NOT a submission-plan checklist step: nothing here is ever
// "done" or confirmed, it only warns, sharpening as a date gets close or
// slips past - same urgency bands DeadlineChip already uses (far >14 days,
// soon 7-14, urgent <7, past), reused directly rather than redefined here so
// the two can never silently disagree.
//
// Deliberately usable both before pursuit (Discovery's own
// discovered_opportunities.closing_date/briefing) and after (the Tender
// Workspace's tenders.closing_date/briefing_date) - both already carry the
// same two dates, so one function covers both call sites instead of two
// screens computing urgency their own way.
import { bandFor, type Band } from "@/components/tt/deadline-chip";
import { daysUntil } from "./dates";

export type TimelineMilestone = {
  key: "briefing" | "closing";
  label: string;
  date: string;
  daysLeft: number;
  urgency: Band;
};

export function tenderTimeline(input: {
  closingDate: string | null;
  briefingDate: string | null;
  // A non-compulsory briefing isn't surfaced here - missing an optional
  // briefing doesn't threaten a submission, so warning about it the same
  // way as a compulsory one would cry wolf.
  briefingCompulsory: boolean | null;
}): TimelineMilestone[] {
  const milestones: TimelineMilestone[] = [];

  if (input.briefingCompulsory && input.briefingDate) {
    const daysLeft = daysUntil(input.briefingDate);
    if (daysLeft !== null) {
      milestones.push({
        key: "briefing",
        label: "Compulsory briefing",
        date: input.briefingDate,
        daysLeft,
        urgency: bandFor(daysLeft),
      });
    }
  }

  if (input.closingDate) {
    const daysLeft = daysUntil(input.closingDate);
    if (daysLeft !== null) {
      milestones.push({
        key: "closing",
        label: "Submission closes",
        date: input.closingDate,
        daysLeft,
        urgency: bandFor(daysLeft),
      });
    }
  }

  return milestones;
}
