// Tender Command Center (Sarel's own brief, 2026-10-24): pure classification
// logic for the dashboard's operational triage. Every function here is a
// plain computation over facts this app already has (or that migration 0090
// added) - nothing here reads the database directly, so it stays unit-
// testable and reusable from both the dashboard (a whole company's active
// bids) and the tender workspace (one tender's own header badge).
//
// What this module deliberately does NOT try to compute, and why:
//   - blocking_items as a full multi-item list: the real, authoritative list
//     already exists - lib/tenderNextStep.ts's nextStepFor() (SANRAL via
//     compliance-data.ts, general via general-pack-review-data.ts) and
//     tenders/[id]/disqualification-guard.tsx's own 7-check rows. Re-deriving
//     a second version here risks it disagreeing with the one real answer -
//     the same "never a second number that could disagree" rule this app
//     already follows everywhere (see compliance-report.tsx, page.tsx).
//     Callers pass in a short blockingSummary string (from one of those real
//     sources) rather than this module inventing its own.
//   - decision_needed's full 4-value set from the brief (GO_NO_GO,
//     PRICING_SIGNOFF, ATTEND_BRIEFING, DIRECTOR_RESOLUTION): only
//     ATTEND_BRIEFING and DIRECTOR_RESOLUTION have a real signal anywhere in
//     this schema today (an upcoming briefing task; the Disqualification
//     Guard reporting a real "Fix" item close to closing). No GO_NO_GO or
//     PRICING_SIGNOFF workflow exists - financial_captures (migration 0001)
//     is deliberately still just draft/complete, with no sign-off state, and
//     pursuing a tender has no stage of its own before "found" on the
//     pipeline board. Fabricating those two would be inventing a workflow
//     this app can't actually back with real data - scoped out, not
//     silently dropped (see docs/specs/System-Status.md).

import type { PipelineStage } from "./pipeline";
import { daysUntil } from "./dates.ts";

export type SubmissionType = "physical_box" | "etenders_portal" | "email" | "other_digital";
export type DispatchStatus = "not_ready" | "compiling" | "print_ready" | "printed_and_bound" | "out_for_delivery" | "submitted_and_receipted";
export type DispatchBucket = "critical" | "decision" | "in_progress" | "radar";
export type DecisionNeeded = "attend_briefing" | "director_resolution" | "none";

const DISPATCHED_STATUSES: DispatchStatus[] = ["printed_and_bound", "out_for_delivery", "submitted_and_receipted"];
const CLOSED_STAGES: PipelineStage[] = ["submitted", "won", "lost"];

export type DispatchLogisticsInput = {
  closingDate: string | null;
  submissionType: SubmissionType;
  estimatedPrintHours: number;
  estimatedTransitHours: number;
  dispatchStatus: DispatchStatus;
};

/**
 * The real operational cutoff - closing time minus the print/bind/sign buffer
 * minus transit, for a physical-box submission. Computed, never stored (see
 * module header): the only two inputs that ever change (the hour estimates,
 * the closing date itself if the buyer moves it) are both already real
 * columns, so storing a third derived value would just be something that
 * could drift. Null for a digital submission (etenders/email have no
 * physical print-and-drive buffer) or an unknown closing date.
 */
export function printSignDeadline(input: DispatchLogisticsInput): Date | null {
  if (!input.closingDate || input.submissionType !== "physical_box") return null;
  const closing = new Date(input.closingDate);
  if (Number.isNaN(closing.getTime())) return null;
  const bufferMs = (input.estimatedPrintHours + input.estimatedTransitHours) * 60 * 60 * 1000;
  return new Date(closing.getTime() - bufferMs);
}

/** Hours remaining until the print/sign cutoff (negative once it's passed). Null when printSignDeadline() is null. */
export function hoursUntilPrintSignDeadline(input: DispatchLogisticsInput, now: Date = new Date()): number | null {
  const deadline = printSignDeadline(input);
  if (!deadline) return null;
  return (deadline.getTime() - now.getTime()) / (60 * 60 * 1000);
}

/**
 * The separate "must leave for delivery by" cutoff - closing time minus
 * transit only, with no print/bind/sign buffer subtracted. QA finding,
 * 2026-10-26: printSignDeadline() alone collapsed the whole day-before plan
 * into one number, which read as "the one thing to hit" when it's really
 * two sequential steps with two different owners (prep finishes, THEN the
 * vehicle leaves) - this gives the UI the second point on that timeline
 * without inventing a new buffer this schema doesn't have. Same nulls as
 * printSignDeadline() (digital submission, or no closing date).
 */
export function departureDeadline(input: DispatchLogisticsInput): Date | null {
  if (!input.closingDate || input.submissionType !== "physical_box") return null;
  const closing = new Date(input.closingDate);
  if (Number.isNaN(closing.getTime())) return null;
  return new Date(closing.getTime() - input.estimatedTransitHours * 60 * 60 * 1000);
}

export type DecisionInput = {
  briefingDate: string | null;
  briefingTaskStatus: "not_started" | "in_progress" | "done" | null; // null = no auto-seeded briefing task on file
  hasRealFixBlocker: boolean; // a real Disqualification Guard "Fix" item, not fabricated
  closingDate: string | null;
};

/**
 * ATTEND_BRIEFING and DIRECTOR_RESOLUTION only - see module header for why
 * GO_NO_GO/PRICING_SIGNOFF are scoped out entirely rather than guessed at.
 * ATTEND_BRIEFING isn't narrowed to "compulsory" briefings specifically -
 * that flag is only reliably known for general-family tenders (their own
 * read manifest), not SANRAL ones, so this honestly broadens to "any
 * upcoming briefing not yet attended" rather than fabricating a compulsory
 * flag for the SANRAL half of this check.
 */
export function deriveDecisionNeeded(input: DecisionInput, now: Date = new Date()): DecisionNeeded {
  if (input.briefingDate) {
    const briefing = new Date(input.briefingDate);
    if (!Number.isNaN(briefing.getTime()) && briefing.getTime() > now.getTime() && input.briefingTaskStatus !== "done") {
      return "attend_briefing";
    }
  }
  if (input.hasRealFixBlocker) {
    const daysLeft = daysUntil(input.closingDate, now);
    if (daysLeft !== null && daysLeft <= 7) return "director_resolution";
  }
  return "none";
}

export type ClassifyInput = DispatchLogisticsInput & {
  pipelineStage: PipelineStage;
  decisionNeeded: DecisionNeeded;
};

/**
 * One of the 4 buckets from Sarel's own brief (§1.2), in the same priority
 * order the brief lists them: a tender already closed out (submitted/won/
 * lost) isn't triaged at all - call sites filter those out before this runs,
 * same as lib/tenderNextStep.ts's own closingSoon list already excludes them.
 */
export function classifyDispatchBucket(input: ClassifyInput, now: Date = new Date()): DispatchBucket | null {
  if (CLOSED_STAGES.includes(input.pipelineStage)) return null;

  const notYetDispatched = !DISPATCHED_STATUSES.includes(input.dispatchStatus);
  const hoursToDeadline = hoursUntilPrintSignDeadline(input, now);
  if (hoursToDeadline !== null && notYetDispatched && hoursToDeadline <= 48) return "critical";

  // Digital submissions have no print/transit buffer (printSignDeadline is
  // null for them) - fall back to the closing date itself for the same
  // 48-hour urgency window, so an eTenders-portal upload closing tomorrow
  // isn't silently invisible to the Critical lane just because it has no
  // physical cutoff to compute.
  if (hoursToDeadline === null && input.submissionType !== "physical_box" && input.closingDate && notYetDispatched) {
    const closingHours = (new Date(input.closingDate).getTime() - now.getTime()) / (60 * 60 * 1000);
    if (!Number.isNaN(closingHours) && closingHours <= 48) return "critical";
  }

  if (input.decisionNeeded !== "none") return "decision";

  const daysToClose = daysUntil(input.closingDate, now);
  if (daysToClose !== null && daysToClose <= 7) return "in_progress";

  return "radar";
}

/**
 * The "system speaks to you" line (brief §3) - built only from real,
 * already-computed facts (the deadline, a caller-supplied blocking summary
 * from the one real source - see module header), never a generic template
 * with the specifics guessed in.
 */
export function operationalStatusMessage(input: DispatchLogisticsInput, blockingSummary: string | null, now: Date = new Date()): string | null {
  const deadline = printSignDeadline(input);
  const hoursLeft = hoursUntilPrintSignDeadline(input, now);
  if (deadline && hoursLeft !== null) {
    if (hoursLeft <= 0) return "PRINT OVERDUE - the print & sign cutoff has already passed for a physical submission.";
    const hoursText = hoursLeft < 1 ? "under an hour" : `${Math.floor(hoursLeft)} hour${Math.floor(hoursLeft) === 1 ? "" : "s"}`;
    if (hoursLeft <= 48) {
      return blockingSummary
        ? `CRITICAL: you have ${hoursText} until the print cutoff. ${blockingSummary}`
        : `CRITICAL: you have ${hoursText} until the print cutoff. Confirm the pack is ready to print.`;
    }
  }
  if (blockingSummary) return blockingSummary;
  if (input.dispatchStatus === "printed_and_bound" || input.dispatchStatus === "out_for_delivery") {
    return "Printed and ready - confirm delivery before the cutoff.";
  }
  return null;
}
