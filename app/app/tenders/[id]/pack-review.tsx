import Link from "next/link";
import { loadPackReviewSnapshot, type ReviewStatus } from "./pack-review-data";
import { confirmPackReview } from "./pack-review-actions";
import { PackChecklist } from "./pack-checklist";

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

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

const STATUS_STYLE: Record<ReviewStatus, { label: string; bg: string; color: string }> = {
  confirmed: { label: "Confirmed", bg: "#DCFCE7", color: "#15803D" },
  needs_input: { label: "Needs input", bg: "#FEF3C7", color: "#B45309" },
  assumed_default: { label: "Assumed default", bg: "#FEF3C7", color: "#B45309" },
  warning: { label: "Warning", bg: "#FEE2E2", color: "#B91C1C" },
  missing: { label: "Missing", bg: "#FEE2E2", color: "#B91C1C" },
};

function Pill({ status }: { status: ReviewStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

export async function PackReview({ tenderId }: { tenderId: string }) {
  const snapshot = await loadPackReviewSnapshot(tenderId);

  if (!snapshot.mapped) {
    return null; // family's returnable list isn't mapped - nothing to preview (same gate as compliance-data.ts's own packReadiness.checked)
  }

  return (
    <div id="pack-review" style={card}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>Pack review - confirm before you compile</div>
      <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 14 }}>
        Everything identified to go into this tender&apos;s submission pack: company data, key positions and CVs, form
        answers, the signature, supporting documents, Form B7, and the JV/typical-share field if set. Check each
        section, use &quot;Change&quot; to jump to where it&apos;s edited, then confirm below - &quot;Generate submission
        pack&quot; needs this review first.
      </div>

      {snapshot.reviewed && (
        <div style={{ background: "#DCFCE7", border: "1px solid #86EFAC", borderRadius: 9, padding: "8px 14px", marginBottom: 12, fontSize: 12, color: "#15803D" }}>
          Reviewed {new Date(snapshot.reviewed.reviewedAt).toLocaleString()}
          {snapshot.reviewed.reviewedBy ? ` by ${snapshot.reviewed.reviewedBy}` : ""}. Review again any time - the list
          below always reflects what&apos;s on file right now.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {snapshot.sections.map((s) => (
          <details key={s.key} open={s.error !== null || s.items.some((i) => i.status !== "confirmed")} style={{ border: "1px solid #E5E1D5", borderRadius: 9, background: "#F6F5F1" }}>
            <summary style={{ cursor: "pointer", padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "#16233B", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                {s.title}
                {!s.error && (
                  <span style={{ fontWeight: 400, color: "#9A9684" }}>
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
                <div style={{ color: "#9A9684", fontSize: 12, padding: "6px 0" }}>Nothing to show yet.</div>
              ) : (
                s.items.map((item) => (
                  <div key={item.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", borderTop: "1px solid #E5E1D5", fontSize: 12 }}>
                    <span style={{ flex: "0 0 auto", marginTop: 1 }}>
                      <Pill status={item.status} />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ color: "#16233B", fontWeight: 600, wordBreak: "break-word" }}>
                        {item.label}
                        {item.value && <span style={{ color: "#6B6758", fontWeight: 400 }}> &middot; {item.value}</span>}
                      </div>
                      {item.note && <div style={{ color: "#6B6758", wordBreak: "break-word" }}>{item.note}</div>}
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
        <span style={{ fontSize: 11, color: "#9A9684" }}>Records that you looked at this list before generating a pack.</span>
      </form>
    </div>
  );
}
