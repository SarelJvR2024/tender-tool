// Tender Command Center (Sarel's own brief, 2026-10-24): the dashboard's own
// data loader, turning this company's active bids (tender_packs rows still
// in 'found'/'bidding' - dashboard/page.tsx's own IN_PROGRESS_STAGES) into
// classified DispatchCard rows. Pure triage math lives in dispatchTriage.ts;
// this file is the one place that reads the database and reuses the
// already-proven, already-bounded nextStepFor() (lib/tenderNextStep.ts) for
// the real blocking-item summary, rather than re-deriving one.
import type { SupabaseClient } from "@supabase/supabase-js";
import { nextStepFor } from "./tenderNextStep";
import { daysUntil } from "./dates";
import type { PipelineStage } from "./pipeline";
import {
  classifyDispatchBucket,
  deriveDecisionNeeded,
  printSignDeadline,
  type DecisionNeeded,
  type DispatchBucket,
  type DispatchStatus,
  type SubmissionType,
} from "./dispatchTriage";

export type ActiveBidInput = {
  tenderId: string;
  tenderPackId: string;
  contractNo: string | null;
  description: string | null;
  buyer: string | null;
  closingDate: string | null;
  family: string | null;
  briefingDate: string | null;
  briefingTime: string | null;
  submissionType: SubmissionType;
  deliveryLocation: string | null;
  estimatedPrintHours: number;
  estimatedTransitHours: number;
  dispatchStatus: DispatchStatus;
  courierContact: string | null;
  pipelineStage: PipelineStage;
};

export type DispatchCard = ActiveBidInput & {
  bucket: DispatchBucket;
  decisionNeeded: DecisionNeeded;
  blockingSummary: string | null;
  blockingHref: string | null;
  printDeadline: string | null;
};

// Same bound dashboard/page.tsx's own closingSoon list already uses for
// nextStepFor() - a real, multi-query compliance/pack-review read per
// tender, fine for a handful of rows, not something to pay for a bid with
// nothing time-pressured about it yet.
const DEEP_CHECK_WINDOW_DAYS = 14;

export async function loadDispatchCards(
  activeBids: ActiveBidInput[],
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<DispatchCard[]> {
  if (activeBids.length === 0) return [];

  const tenderIds = activeBids.map((b) => b.tenderId);
  const { data: briefingTaskRows, error: briefingError } = await supabase
    .from("tender_tasks")
    .select("tender_id, status")
    .in("tender_id", tenderIds)
    .eq("kind", "briefing");
  if (briefingError) console.error("tender_tasks (briefing) select failed for dispatch dashboard", briefingError);
  const briefingStatusByTender = new Map(
    ((briefingTaskRows ?? []) as { tender_id: string; status: "not_started" | "in_progress" | "done" }[]).map((r) => [r.tender_id, r.status]),
  );

  const cards = await Promise.all(
    activeBids.map(async (b): Promise<DispatchCard | null> => {
      const logistics = {
        closingDate: b.closingDate,
        submissionType: b.submissionType,
        estimatedPrintHours: b.estimatedPrintHours,
        estimatedTransitHours: b.estimatedTransitHours,
        dispatchStatus: b.dispatchStatus,
      };
      const daysToClose = daysUntil(b.closingDate, now);
      const briefingSoon = (() => {
        const d = daysUntil(b.briefingDate, now);
        return d !== null && d <= DEEP_CHECK_WINDOW_DAYS;
      })();
      const worthDeepCheck = (daysToClose !== null && daysToClose <= DEEP_CHECK_WINDOW_DAYS) || briefingSoon;

      const blockingStep = worthDeepCheck ? await nextStepFor(b.tenderId, b.family, true) : null;

      const decisionNeeded = deriveDecisionNeeded(
        {
          briefingDate: b.briefingDate,
          briefingTaskStatus: briefingStatusByTender.get(b.tenderId) ?? null,
          hasRealFixBlocker: !!blockingStep,
          closingDate: b.closingDate,
        },
        now,
      );

      const bucket = classifyDispatchBucket({ ...logistics, pipelineStage: b.pipelineStage, decisionNeeded }, now);
      if (bucket === null) return null;

      return {
        ...b,
        bucket,
        decisionNeeded,
        blockingSummary: blockingStep?.label ?? null,
        blockingHref: blockingStep?.href ?? null,
        printDeadline: printSignDeadline(logistics)?.toISOString() ?? null,
      };
    }),
  );

  return cards.filter((c): c is DispatchCard => c !== null);
}
