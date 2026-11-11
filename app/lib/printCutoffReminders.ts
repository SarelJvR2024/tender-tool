// Pure threshold logic for the "48-hour print & transit cutoff" operational
// alert (Operational Notification Engine, Sarel's own brief) - reuses
// lib/dispatchTriage.ts's own printSignDeadline()/hoursUntilPrintSignDeadline()
// (the Tender Command Center's real "operational cutoff" math: closing time
// minus the tender's own print + transit hour estimates) rather than
// re-deriving a second version that could disagree with what the dashboard
// and the tender workspace's own Submission Mode badge already show.
import { hoursUntilPrintSignDeadline, DISPATCHED_STATUSES, type DispatchLogisticsInput, type SubmissionType, type DispatchStatus } from "./dispatchTriage.ts";

export const PRINT_CUTOFF_THRESHOLD_HOURS = 48;

// briefing_shortlisted (0105) is also already submitted - nothing left to
// print or dispatch - the same reason submitted/won/lost are excluded here.
// Found 2026-11-02: missing before this, so a tender already submitted and
// now awaiting the buyer's briefing/shortlist decision would still nag for
// a print/transit cutoff that's already moot - the same "submitted-tender
// nagging gap" shape PR #174 fixed in the two cron scripts, in this
// separate lib file.
const CLOSED_STAGES = ["submitted", "briefing_shortlisted", "won", "lost"];

export type PrintCutoffTenderPackRow = {
  id: string;
  tender_id: string;
  company_id: string;
  pipeline_stage: string;
  submission_type: SubmissionType;
  estimated_print_hours: number;
  estimated_transit_hours: number;
  dispatch_status: DispatchStatus;
};

export type PrintCutoffTenderRow = {
  id: string;
  contract_no: string | null;
  description: string | null;
  closing_date: string | null;
};

export type PrintCutoffCandidate = {
  pack: PrintCutoffTenderPackRow;
  tender: PrintCutoffTenderRow;
  hoursLeft: number;
};

/**
 * Every tender_packs row within PRINT_CUTOFF_THRESHOLD_HOURS of its own
 * print/sign deadline - physical-box submissions only (printSignDeadline()
 * is already null for a digital one), excluding closed-out pipeline stages
 * AND a pack already dispatched (Finding 405: dispatch_status is its own,
 * independently-updated column - advanceDispatchStatus()/logistics-
 * actions.ts writes it with no matching pipeline_stage write at all - so a
 * company that has already printed/bound/handed over the physical box
 * (dispatch_status printed_and_bound/out_for_delivery/submitted_and_
 * receipted) but hasn't separately dragged the Pipeline board card to
 * "submitted" kept getting this real, scary "URGENT: print & sign deadline
 * in N hours ... there isn't enough time left to print, bind and deliver"
 * cron email for a box they'd already dispatched, sometimes days earlier.
 * dispatchTriage.ts's own classifyDispatchBucket()/operationalStatusMessage()
 * already guard the identical fact for the dashboard/workspace UI - this
 * reuses the same exported DISPATCHED_STATUSES list rather than re-deriving
 * a second copy that could drift from it, same precedent as reusing
 * hoursUntilPrintSignDeadline() itself, per this file's own header).
 * No lower bound on hoursLeft: a cron gap that lets this run first notice
 * the window well after 48h (even negative) still gets one honest alert
 * rather than none - the dedupe claim (record_operational_alert_sent) means
 * it only ever fires once per (tender, company) either way.
 */
export function printCutoffCandidates(
  packs: PrintCutoffTenderPackRow[],
  tendersById: Map<string, PrintCutoffTenderRow>,
  now: Date = new Date()
): PrintCutoffCandidate[] {
  const out: PrintCutoffCandidate[] = [];
  for (const pack of packs) {
    if (CLOSED_STAGES.includes(pack.pipeline_stage)) continue;
    if (DISPATCHED_STATUSES.includes(pack.dispatch_status)) continue;
    const tender = tendersById.get(pack.tender_id);
    if (!tender) continue;
    const input: DispatchLogisticsInput = {
      closingDate: tender.closing_date,
      submissionType: pack.submission_type,
      estimatedPrintHours: pack.estimated_print_hours,
      estimatedTransitHours: pack.estimated_transit_hours,
      dispatchStatus: pack.dispatch_status,
    };
    const hoursLeft = hoursUntilPrintSignDeadline(input, now);
    if (hoursLeft === null || hoursLeft > PRINT_CUTOFF_THRESHOLD_HOURS) continue;
    out.push({ pack, tender, hoursLeft });
  }
  return out;
}
