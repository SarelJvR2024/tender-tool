import { HashAwareLink } from "./hash-aware-link";
import { Info } from "lucide-react";
import { loadGeneralPackReviewSnapshot } from "./general-pack-review-data";
import { confirmGeneralPackReview } from "./general-pack-review-actions";
import { reviewStatusToBidTask, type ReviewStatus } from "./pack-review-logic";
import { matchStrengthStatus } from "./general-pack-review-logic";
import type { BidTaskStatus } from "./bid-task-status";
import { formatDateTime } from "@/lib/dates";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * General (non-SANRAL) tender Pack Review: the confirm-before-compile
 * screen SANRAL tenders already have (pack-review.tsx, migration 0059,
 * Sarel 2026-10-18) extended to general tenders - a standing QA finding
 * noted it was missing there. Same idea, general-tender-shaped inputs:
 * company details & tender questions, the chosen signatory, supporting
 * documents, the roles this tender names with who's tagged and whether they
 * have a CV (person_role_eligibility, not SANRAL's per-position
 * tender_pack_assignments), company experience evidence, and office
 * location. No Form B7, no two-envelope structure - those are SANRAL-only.
 *
 * Mounted inside GeneralTenderWorkspace (general-workspace.tsx), directly
 * above its "Generate the pack" section, which now requires this review to
 * have happened first - see general-actions.ts's requestGeneralPack().
 *
 * Styling intentionally mirrors pack-review.tsx's own inline styles (same
 * card look used throughout the Tender Workspace) - not imported from there
 * since that file is SANRAL-only by convention and exports no shared
 * components, only server-rendered JSX.
 */

// The Product promise's own Verify/Provide/Fix grouping (app/AGENTS.md),
// collapsed from this screen's 5-way ReviewStatus via pack-review-logic.ts's
// reviewStatusToBidTask() - see that function's own comment for exactly
// which of the 5 values becomes which of these 3. Duplicated from
// pack-review.tsx rather than shared, same as this file's own header
// comment already explains for its styling in general ("not imported from
// there since that file is SANRAL-only by convention and exports no shared
// components").
const TASK_STYLE: Record<BidTaskStatus, { label: string; className: string }> = {
  verify: { label: "Verify", className: "bg-success/10 text-success" },
  provide: { label: "Provide", className: "bg-warning/10 text-warning" },
  fix: { label: "Fix", className: "bg-destructive/10 text-destructive" },
};

function Pill({ status }: { status: ReviewStatus }) {
  const s = TASK_STYLE[reviewStatusToBidTask(status)];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${s.className}`}>
      {s.label}
    </span>
  );
}

const STRENGTH_STYLE: Record<"strong" | "check" | "low", string> = {
  strong: "bg-muted text-muted-foreground",
  check: "bg-warning/10 text-warning",
  low: "bg-destructive/10 text-destructive",
};

/**
 * Small, quiet note on an item's extraction match strength - never "AI
 * confidence" (engine/general/requirements.py's score is regex/heuristic,
 * not LLM-backed). Deliberately a small badge, not a banner: at the low end
 * it just means "worth double-checking yourself", not that anything is
 * broken.
 *
 * Never shown alongside a "Fix" pill (System Admin/Tender Workspace brief,
 * 2026-10-25: eliminate "Fix ... Strong match ... No CSD supplier number on
 * file"-style contradictions). Confidence here measures how confidently the
 * requirement's own TEXT was extracted from the RFP - it says nothing about
 * whether the company's own data satisfies it, so pairing a high "Strong
 * match" reading with a "Fix" (missing/blocking) status reads as the two
 * signals disagreeing when they're actually answering different questions.
 * Exported so general-workspace.tsx's returnables list (lib/generalTender.ts's
 * ReturnableCheck, same confidence/confidence_reason engine) can reuse this
 * exact badge rather than a second, re-implemented copy.
 */
export function MatchStrengthBadge({
  confidence,
  reason,
  hideWhenBlocking,
}: {
  confidence: number | null | undefined;
  reason: string | null | undefined;
  /** true when the item this badge would sit beside is already in a "Fix"/blocking state - suppresses the badge entirely rather than showing a confusing pair. */
  hideWhenBlocking?: boolean;
}) {
  if (hideWhenBlocking) return null;
  const strength = matchStrengthStatus(confidence);
  if (!strength) return null;
  return (
    <span
      title={reason || undefined}
      className={`inline-flex items-center rounded-full px-[7px] py-px text-[10.5px] font-semibold whitespace-nowrap ${STRENGTH_STYLE[strength.tier]}`}
    >
      {strength.label}
    </span>
  );
}

function SummaryChip({ count, label, className }: { count: number; label: string; className: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${className}`}>
      {count} {label}
    </span>
  );
}

export async function GeneralPackReview({ tenderId }: { tenderId: string }) {
  const snapshot = await loadGeneralPackReviewSnapshot(tenderId);

  if (!snapshot.mapped) {
    return null; // this tender's documents haven't been read yet - nothing to preview
  }

  const allItems = snapshot.sections.flatMap((s) => s.items);
  if (allItems.length === 0 && snapshot.sections.every((s) => !s.error)) {
    return null; // nothing this tender's own forms ask for beyond documents/roles already shown elsewhere
  }
  const confirmedCount = allItems.filter((i) => i.status === "confirmed").length;
  const toLookAtCount = allItems.length - confirmedCount;

  return (
    <div id="general-pack-review" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
      <div className="mb-0.5 flex items-center gap-1.5">
        <div className="text-[15px] font-bold text-foreground">Pack review - confirm before you compile</div>
        <Tooltip>
          <TooltipTrigger
            aria-label="What this review covers"
            className="inline-flex size-4 flex-none items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <Info className="size-3.5" aria-hidden />
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-left font-normal">
            Everything identified to go into this tender&apos;s submission pack: company details, tender questions,
            the signature, supporting documents, the roles this tender names and who&apos;s tagged for them (with
            their CVs), company experience evidence, and office location. Check each section, use the link to jump
            to where it&apos;s edited, then confirm below - &quot;Generate submission pack&quot; needs this review
            first.
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="mb-3.5 text-xs text-muted-foreground">
        Company details, documents, people and signature - check each section below, then confirm.
      </div>

      {allItems.length > 0 && (
        <div className="mb-3.5 flex flex-wrap gap-2">
          {toLookAtCount === 0 ? (
            <SummaryChip count={confirmedCount} label="confirmed - ready to compile" className="bg-success/10 text-success" />
          ) : (
            <>
              {confirmedCount > 0 && <SummaryChip count={confirmedCount} label="confirmed" className="bg-success/10 text-success" />}
              <SummaryChip count={toLookAtCount} label={toLookAtCount === 1 ? "item to look at" : "items to look at"} className="bg-warning/10 text-warning" />
            </>
          )}
        </div>
      )}

      {snapshot.reviewed && (
        <div className="mb-3 rounded-lg border border-success/30 bg-success/10 px-3.5 py-2 text-xs text-success">
          Reviewed {(formatDateTime(snapshot.reviewed.reviewedAt) ?? "—")}
          {snapshot.reviewed.reviewedBy ? ` by ${snapshot.reviewed.reviewedBy}` : ""}. Review again any time - the list
          below always reflects what&apos;s on file right now.
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {snapshot.sections.map((s) => (
          <details key={s.key} open={s.error !== null || s.items.some((i) => i.status !== "confirmed")} className="rounded-lg border border-border bg-card">
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs font-bold text-foreground">
              <span className="flex flex-wrap items-center gap-2">
                {s.title}
                {!s.error && (
                  <span className="font-normal text-muted-foreground">
                    {s.items.length} item{s.items.length === 1 ? "" : "s"}
                    {s.items.some((i) => i.status !== "confirmed") ? ` - ${s.items.filter((i) => i.status !== "confirmed").length} to look at` : " - all confirmed"}
                  </span>
                )}
              </span>
              <HashAwareLink href={s.changeHref} className="text-[11px] font-semibold text-accent">
                {s.changeLabel} &rarr;
              </HashAwareLink>
            </summary>
            <div className="px-3 pb-2.5">
              {s.error ? (
                <div className="py-1.5 text-xs text-destructive">{s.error}</div>
              ) : s.items.length === 0 ? (
                <div className="py-1.5 text-xs text-muted-foreground">Nothing to show yet.</div>
              ) : (
                s.items.map((item) => (
                  <div key={item.key} className="flex items-start gap-2 border-t border-border py-1.5 text-xs">
                    <span className="mt-px flex-none">
                      <Pill status={item.status} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <div className="font-semibold break-words text-foreground">
                          {item.label}
                          {item.value && <span className="font-normal text-muted-foreground"> &middot; {item.value}</span>}
                        </div>
                        <MatchStrengthBadge
                          confidence={item.confidence}
                          reason={item.confidenceReason}
                          hideWhenBlocking={reviewStatusToBidTask(item.status) === "fix"}
                        />
                      </div>
                      {item.note && <div className="break-words text-muted-foreground">{item.note}</div>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </details>
        ))}
      </div>

      <form action={confirmGeneralPackReview} className="mt-3.5 flex items-center gap-2.5">
        <input type="hidden" name="tender_id" value={tenderId} />
        <button
          type="submit"
          className="min-h-10 cursor-pointer rounded-lg border-none bg-foreground px-4 text-sm font-semibold whitespace-nowrap text-white"
        >
          I&apos;ve reviewed this
        </button>
        <span className="text-[11px] text-muted-foreground">Records that you looked at this list before generating a pack.</span>
      </form>
    </div>
  );
}
