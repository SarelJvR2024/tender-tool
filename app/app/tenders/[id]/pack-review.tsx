import Link from "next/link";
import { loadPackReviewSnapshot, type ReviewStatus } from "./pack-review-data";
import { confirmPackReview } from "./pack-review-actions";
import { PackChecklist } from "./pack-checklist";
import { reviewStatusToBidTask } from "./pack-review-logic";
import type { BidTaskStatus } from "./bid-task-status";

/**
 * Pack Review: the pre-compile screen Sarel asked for (2026-10-18) - "share
 * the full list of info, answers, signatures, documents, CVs, alternative
 * options etc to show what is identified to be used to compile the pack so
 * the company have an easy way to confirm or change it". One sub-section per
 * category, each item with a status pill and a "Change" link that jumps to
 * the existing editable card for it, plus one overall "I've reviewed this"
 * confirm action (pack_review_confirmations, migration 0059).
 *
 * Lives on the Tender Workspace page, directly above SubmissionPack
 * (submission-pack.tsx), which now requires this review to have happened
 * before it will let "Generate submission pack" fire - see actions.ts's
 * requestSubmissionPack().
 */

// The Product promise's own Verify/Provide/Fix grouping (app/AGENTS.md),
// collapsed from this screen's 5-way ReviewStatus via pack-review-logic.ts's
// reviewStatusToBidTask() - see that function's own comment for exactly
// which of the 5 values becomes which of these 3.
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

// At-a-glance totals across every section, same idea as the summary chips on
// the facts card above and the vault-health chips on the Company page - a
// screen built to answer "can I compile this pack" should lead with that
// answer, not make you expand every section to add it up yourself.
function SummaryChip({ count, label, className }: { count: number; label: string; className: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${className}`}>
      {count} {label}
    </span>
  );
}

export async function PackReview({ tenderId }: { tenderId: string }) {
  const snapshot = await loadPackReviewSnapshot(tenderId);

  if (!snapshot.mapped) {
    return null; // family's returnable list isn't mapped - nothing to preview (same gate as compliance-data.ts's own packReadiness.checked)
  }

  const allItems = snapshot.sections.flatMap((s) => s.items);
  const confirmedCount = allItems.filter((i) => i.status === "confirmed").length;
  const toLookAtCount = allItems.length - confirmedCount;

  return (
    <div id="pack-review" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
      <div className="mb-0.5 text-[15px] font-bold text-foreground">Pack review - confirm before you compile</div>
      <div className="mb-3.5 text-xs text-muted-foreground">
        Everything identified to go into this tender&apos;s submission pack: company data, key positions and CVs, form
        answers, the signature, supporting documents, Form B7, and the JV/typical-share field if set. Check each
        section, use &quot;Change&quot; to jump to where it&apos;s edited, then confirm below - &quot;Generate submission
        pack&quot; needs this review first.
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
          Reviewed {new Date(snapshot.reviewed.reviewedAt).toLocaleString()}
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
              <Link href={s.changeHref} className="text-[11px] font-semibold text-accent">
                {s.changeLabel} &rarr;
              </Link>
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
                      <div className="font-semibold break-words text-foreground">
                        {item.label}
                        {item.value && <span className="font-normal text-muted-foreground"> &middot; {item.value}</span>}
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

      <PackChecklist rows={snapshot.checklist} title="What's identified to go into this pack" />

      <form action={confirmPackReview} className="mt-3.5 flex items-center gap-2.5">
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
