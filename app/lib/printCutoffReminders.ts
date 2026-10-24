// Pure threshold logic for the "48-hour print & transit cutoff" operational
// alert (Operational Notification Engine, Sarel's own brief) - reuses
// lib/dispatchTriage.ts's own printSignDeadline()/hoursUntilPrintSignDeadline()
// (the Tender Command Center's real "operational cutoff" math: closing time
// minus the tender's own print + transit hour estimates) rather than
// re-deriving a second version that could disagree with what the dashboard
// and the tender workspace's own Submission Mode badge already show.
import { hoursUntilPrintSignDeadline, type DispatchLogisticsInput, type SubmissionType, type DispatchStatus } from "./dispatchTriage.ts";

export const PRINT_CUTOFF_THRESHOLD_HOURS = 48;

const CLOSED_STAGES = ["submitted", "won", "lost"];

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
 * is already null for a digital one), excluding closed-out pipeline stages.
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
