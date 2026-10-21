import { reviewStatusToBidTask } from "./pack-review-logic.ts";
import type { BidTaskStatus } from "./bid-task-status";
import type { ReviewSection } from "./pack-review-data";

/**
 * One Pack Review item, reclassified into the Product promise's
 * Verify/Provide/Fix grouping (app/AGENTS.md) and carrying enough of its own
 * section's metadata to render standalone at the top of the tender
 * workspace, outside the section it came from.
 */
export type TenderWorkItem = {
  key: string;
  label: string;
  value: string | null;
  note: string | null;
  status: BidTaskStatus;
  /** Only true when the underlying ReviewStatus is literally "confirmed" - an
   * item bucketed Verify only because it isn't disqualifying (ReviewStatus
   * "assumed_default") still needs a look, so it's NOT "confirmed". */
  confirmed: boolean;
  /** Which Pack Review section this came from (e.g. "Company master data") -
   * the real "where this was filled from", not an invented source/date. */
  sourceLabel: string;
  changeHref: string;
  changeLabel: string;
};

export type TenderReadiness = {
  /** 0-100, rounded; 100 when there's nothing to assess yet (an unmapped
   * family, or a pack with zero sections read). */
  score: number;
  totalCount: number;
  confirmedCount: number;
  /** totalCount - confirmedCount - "X things left before you can submit". */
  thingsLeft: number;
  fix: TenderWorkItem[];
  provide: TenderWorkItem[];
  verify: TenderWorkItem[];
};

/**
 * Flattens a Pack Review snapshot's sections (SANRAL's PackReviewSnapshot or
 * general's GeneralPackReviewSnapshot - both built from the identical
 * ReviewSection/ReviewItem shape in pack-review-data.ts) into one Fix/
 * Provide/Verify view plus a 0-100 readiness score. Pure - no I/O, reads the
 * exact same section/item data the Pack Review card itself already renders,
 * so the score and the detailed card below it can never disagree.
 *
 * A section whose own data failed to load (`section.error`) contributes
 * nothing - there's nothing real to classify, and silently treating a read
 * failure as "0 items, fully ready" would be worse than leaving it out of
 * the count.
 */
export function computeTenderReadiness(sections: ReviewSection[]): TenderReadiness {
  const fix: TenderWorkItem[] = [];
  const provide: TenderWorkItem[] = [];
  const verify: TenderWorkItem[] = [];
  let confirmedCount = 0;
  let totalCount = 0;

  for (const section of sections) {
    if (section.error) continue;
    for (const item of section.items) {
      totalCount += 1;
      const confirmed = item.status === "confirmed";
      if (confirmed) confirmedCount += 1;
      const workItem: TenderWorkItem = {
        key: item.key,
        label: item.label,
        value: item.value,
        note: item.note,
        status: reviewStatusToBidTask(item.status),
        confirmed,
        sourceLabel: section.title,
        changeHref: section.changeHref,
        changeLabel: section.changeLabel,
      };
      if (workItem.status === "fix") fix.push(workItem);
      else if (workItem.status === "provide") provide.push(workItem);
      else verify.push(workItem);
    }
  }

  const score = totalCount === 0 ? 100 : Math.round((confirmedCount / totalCount) * 100);
  return { score, totalCount, confirmedCount, thingsLeft: totalCount - confirmedCount, fix, provide, verify };
}
