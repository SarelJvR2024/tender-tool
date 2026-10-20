import Link from "next/link";
import { loadGeneralPackReviewSnapshot } from "./general-pack-review-data";
import { confirmGeneralPackReview } from "./general-pack-review-actions";
import { PackChecklist } from "./pack-checklist";
import type { ReviewStatus } from "./pack-review-logic";
import { matchStrengthStatus } from "./general-pack-review-logic";

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

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };

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

const STRENGTH_STYLE: Record<"strong" | "check" | "low", { bg: string; color: string }> = {
  strong: { bg: "#F1F5F9", color: "#5B6472" },
  check: { bg: "#FEF3C7", color: "#B45309" },
  low: { bg: "#FEE2E2", color: "#B91C1C" },
};

/**
 * Small, quiet note on an item's extraction match strength - never "AI
 * confidence" (engine/general/requirements.py's score is regex/heuristic,
 * not LLM-backed). Deliberately a small badge, not a banner: at the low end
 * it just means "worth double-checking yourself", not that anything is
 * broken.
 */
function MatchStrengthBadge({ confidence, reason }: { confidence: number | null | undefined; reason: string | null | undefined }) {
  const strength = matchStrengthStatus(confidence);
  if (!strength) return null;
  const s = STRENGTH_STYLE[strength.tier];
  return (
    <span
      title={reason || undefined}
      style={{ display: "inline-flex", alignItems: "center", padding: "1px 7px", borderRadius: 100, fontSize: 10.5, fontWeight: 600, background: s.bg, color: s.color, whiteSpace: "nowrap" }}
    >
      {strength.label}
    </span>
  );
}

function SummaryChip({ count, label, bg, color }: { count: number; label: string; bg: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: bg, color }}>
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
    <div id="general-pack-review" style={card}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>Pack review - confirm before you compile</div>
      <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 14 }}>
        Everything identified to go into this tender&apos;s submission pack: company details, tender questions, the
        signature, supporting documents, the roles this tender names and who&apos;s tagged for them (with their CVs),
        company experience evidence, and office location. Check each section, use the link to jump to where it&apos;s
        edited, then confirm below - &quot;Generate submission pack&quot; needs this review first.
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
                    <span style={{ flex: "0 0 auto", marginTop: 1, display: "flex", gap: 5, flexWrap: "wrap" }}>
                      <Pill status={item.status} />
                      <MatchStrengthBadge confidence={item.confidence} reason={item.confidenceReason} />
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

      <form action={confirmGeneralPackReview} style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
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
