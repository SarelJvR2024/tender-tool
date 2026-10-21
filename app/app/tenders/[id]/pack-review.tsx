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

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

// The Product promise's own Verify/Provide/Fix grouping (app/AGENTS.md),
// collapsed from this screen's 5-way ReviewStatus via pack-review-logic.ts's
// reviewStatusToBidTask() - see that function's own comment for exactly
// which of the 5 values becomes which of these 3.
const TASK_STYLE: Record<BidTaskStatus, { label: string; bg: string; color: string }> = {
  verify: { label: "Verify", bg: "#DCFCE7", color: "#15803D" },
  provide: { label: "Provide", bg: "#FEF3C7", color: "#B45309" },
  fix: { label: "Fix", bg: "#FEE2E2", color: "#B91C1C" },
};

function Pill({ status }: { status: ReviewStatus }) {
  const s = TASK_STYLE[reviewStatusToBidTask(status)];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

// At-a-glance totals across every section, same idea as the summary chips on
// the facts card above and the vault-health chips on the Company page - a
// screen built to answer "can I compile this pack" should lead with that
// answer, not make you expand every section to add it up yourself.
function SummaryChip({ count, label, bg, color }: { count: number; label: string; bg: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: bg, color }}>
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
    <div id="pack-review" style={card}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>Pack review - confirm before you compile</div>
      <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 14 }}>
        Everything identified to go into this tender&apos;s submission pack: company data, key positions and CVs, form
        answers, the signature, supporting documents, Form B7, and the JV/typical-share field if set. Check each
        section, use &quot;Change&quot; to jump to where it&apos;s edited, then confirm below - &quot;Generate submission
        pack&quot; needs this review first.
      </div>

      {allItems.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {toLookAtCount === 0 ? (
            <SummaryChip count={confirmedCount} label="confirmed - ready to compile" bg="#DCFCE7" color="#15803D" />
          ) : (
            <>
              {confirmedCount > 0 && <SummaryChip count={confirmedCount} label="confirmed" bg="#DCFCE7" color="#15803D" />}
              <SummaryChip count={toLookAtCount} label={toLookAtCount === 1 ? "item to look at" : "items to look at"} bg="#FEF3C7" color="#B45309" />
            </>
          )}
        </div>
      )}

      {snapshot.reviewed && (
        <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 9, padding: "8px 14px", marginBottom: 12, fontSize: 12, color: "#15803D" }}>
          Reviewed {new Date(snapshot.reviewed.reviewedAt).toLocaleString()}
          {snapshot.reviewed.reviewedBy ? ` by ${snapshot.reviewed.reviewedBy}` : ""}. Review again any time - the list
          below always reflects what&apos;s on file right now.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {snapshot.sections.map((s) => (
          <details key={s.key} open={s.error !== null || s.items.some((i) => i.status !== "confirmed")} style={{ border: "1px solid #E3E6EA", borderRadius: 9, background: "#FFFFFF" }}>
            <summary style={{ cursor: "pointer", padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "#16233B", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {s.title}
                {!s.error && (
                  <span style={{ fontWeight: 400, color: "#8A93A0" }}>
                    {s.items.length} item{s.items.length === 1 ? "" : "s"}
                    {s.items.some((i) => i.status !== "confirmed") ? ` - ${s.items.filter((i) => i.status !== "confirmed").length} to look at` : " - all confirmed"}
                  </span>
                )}
              </span>
              <Link href={s.changeHref} style={{ color: "#D97706", fontWeight: 600, fontSize: 11 }}>
                {s.changeLabel} &rarr;
              </Link>
            </summary>
            <div style={{ padding: "0 12px 10px" }}>
              {s.error ? (
                <div style={{ color: "#B91C1C", fontSize: 12, padding: "6px 0" }}>{s.error}</div>
              ) : s.items.length === 0 ? (
                <div style={{ color: "#8A93A0", fontSize: 12, padding: "6px 0" }}>Nothing to show yet.</div>
              ) : (
                s.items.map((item) => (
                  <div key={item.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderTop: "1px solid #E3E6EA", fontSize: 12 }}>
                    <span style={{ flex: "0 0 auto", marginTop: 1 }}>
                      <Pill status={item.status} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ color: "#16233B", fontWeight: 600, wordBreak: "break-word" }}>
                        {item.label}
                        {item.value && <span style={{ color: "#5B6472", fontWeight: 400 }}> &middot; {item.value}</span>}
                      </div>
                      {item.note && <div style={{ color: "#5B6472", wordBreak: "break-word" }}>{item.note}</div>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </details>
        ))}
      </div>

      <PackChecklist rows={snapshot.checklist} title="What's identified to go into this pack" />

      <form action={confirmPackReview} style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
        <input type="hidden" name="tender_id" value={tenderId} />
        <button
          type="submit"
          style={{ minHeight: 40, padding: "0 16px", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          I&apos;ve reviewed this
        </button>
        <span style={{ fontSize: 11, color: "#8A93A0" }}>Records that you looked at this list before generating a pack.</span>
      </form>
    </div>
  );
}
