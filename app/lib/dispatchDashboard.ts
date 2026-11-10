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
import { SANRAL_CONVENTIONAL_FAMILY } from "./tenderCompliance";
import { GENERAL_FAMILY } from "./generalTender";
import { loadTenderCompliance } from "@/app/tenders/[id]/compliance-data";
import { loadSubmissionPlan } from "@/app/tenders/[id]/submission-plan-data";
import { disqualificationGuardRows } from "@/app/tenders/[id]/disqualification-guard";
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

      // Finding (standing review, originally flagged 2026-10-27, closed out
      // this pass): `hasRealFixBlocker` is documented ("a real
      // Disqualification Guard 'Fix' item, not fabricated") as needing the
      // Guard's own narrow fixCount - but `blockingStep` above comes from
      // `nextStepFor()`, a much broader "the one concrete, unfinished thing"
      // signal that's non-null for routine Provide/Verify gaps too (no pack
      // started yet, a key position still needing a person confirmed, a
      // general-pack item merely flagged needs_input/warning). Using it here
      // meant almost any active bid closing within 7 days with ANYTHING left
      // to do landed in `director_resolution` / the Dashboard's "Decision"
      // lane - the lane this feature's own brief reserves for a genuine
      // disqualification risk needing a director's personal call. Fixed by
      // computing the Guard's own real fixCount instead, via
      // disqualificationGuardRows() (extracted from DisqualificationGuard()
      // itself so the two can never disagree) - same `isSanralFamily`/
      // `isGeneralFamily` split `tenders/[id]/page.tsx` already uses, same
      // worthDeepCheck cost bound as blockingStep already pays (SANRAL's own
      // loadTenderCompliance() call is React-cache()'d, so this adds no
      // second network round trip there; general's own loadSubmissionPlan()
      // is a different loader from nextStepFor()'s loadGeneralPackReviewSnapshot()
      // and does add one bounded extra read, same cost tier already accepted
      // for this 14-day window).
      const isSanralFamily = b.family === SANRAL_CONVENTIONAL_FAMILY;
      const isGeneralFamily = b.family === GENERAL_FAMILY;
      const [compliance, plan] = worthDeepCheck
        ? await Promise.all([
            isSanralFamily ? loadTenderCompliance(b.tenderId) : Promise.resolve(null),
            isGeneralFamily ? loadSubmissionPlan(b.tenderId) : Promise.resolve(null),
          ])
        : [null, null];
      const fixCount = disqualificationGuardRows({ isSanralFamily, isGeneralFamily, compliance, plan }).rows.filter(
        (r) => r.status === "fix",
      ).length;

      const decisionNeeded = deriveDecisionNeeded(
        {
          briefingDate: b.briefingDate,
          briefingTaskStatus: briefingStatusByTender.get(b.tenderId) ?? null,
          hasRealFixBlocker: fixCount > 0,
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
