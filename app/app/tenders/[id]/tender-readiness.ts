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
  /**
   * True when at least one section's own data failed to read this pass
   * (`section.error` set). Standing review, 2026-11-06: excluding a failed
   * section's items from fix/provide/verify/totalCount - the only thing a
   * PURE function can honestly do, since it has no real items to classify -
   * has the exact same effect on every caller that gates on `fix.length`
   * (the Submit/pack-request button's own disabledReason, and
   * requestSubmissionPack()/requestGeneralJob()'s intended server-side
   * re-check) as silently treating that section as "fully confirmed,
   * nothing to fix": a real, disqualifying Fix item that happened to live
   * in the one section that failed to load this render becomes invisible to
   * fix.length, and `score` is computed only from the sections that DID
   * load, so it reads higher than the true picture too. This flag lets a
   * caller tell "fix.length is 0 because everything really is confirmed"
   * apart from "fix.length is 0 because part of the picture didn't load" -
   * any hard-stop gate built on this function MUST treat `hasUnreadSection`
   * the same as "can't tell, fail closed," not as "nothing to fix."
   */
  hasUnreadSection: boolean;
};

/**
 * Flattens a Pack Review snapshot's sections (SANRAL's PackReviewSnapshot or
 * general's GeneralPackReviewSnapshot - both built from the identical
 * ReviewSection/ReviewItem shape in pack-review-data.ts) into one Fix/
 * Provide/Verify view plus a 0-100 readiness score. Pure - no I/O, reads the
 * exact same section/item data the Pack Review card itself already renders,
 * so the score and the detailed card below it can never disagree.
 *
 * A section whose own data failed to load (`section.error`) contributes no
 * items to fix/provide/verify/totalCount - there's nothing real to classify
 * - but sets `hasUnreadSection` so a caller can tell this apart from a
 * genuinely clean section. See that field's own doc comment: a caller that
 * gates anything on `fix.length === 0` without also checking
 * `hasUnreadSection` recreates the exact "failed read reads as fully ready"
 * shape this whole review loop watches for.
 */
export function computeTenderReadiness(sections: ReviewSection[]): TenderReadiness {
  const fix: TenderWorkItem[] = [];
  const provide: TenderWorkItem[] = [];
  const verify: TenderWorkItem[] = [];
  let confirmedCount = 0;
  let totalCount = 0;
  let hasUnreadSection = false;

  for (const section of sections) {
    if (section.error) {
      hasUnreadSection = true;
      continue;
    }
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
  return { score, totalCount, confirmedCount, thingsLeft: totalCount - confirmedCount, fix, provide, verify, hasUnreadSection };
}
