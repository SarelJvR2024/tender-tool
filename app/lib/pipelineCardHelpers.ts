import type { PipelineStage } from "./pipeline";

// Extracted from app/pipeline/page.tsx (2026-10-29) so the pure branching
// logic behind the Bids board's "Pack health" badge and "Action" link has a
// test file - the established pattern in this codebase (lib/scoreOutlookChips.ts,
// lib/documentExpiry.ts) for logic that would otherwise live untested inside
// a server component page.

export type PackHealthStatus = "not_started" | "blocked" | "in_progress" | "ready";

export type PackHealth = { status: PackHealthStatus; score: number; confirmedCount: number; totalCount: number; fixCount: number };

/**
 * Pack health status (Sarel's own ask: "replace all '-' dashes" with a real
 * Pack Ready / In Progress / Blocked signal). `fixCount` is
 * computeTenderReadiness()'s own `fix.length` - a MANDATORY, unconfirmed
 * item (bid-task-status.ts's classifyComplianceItem(): "mandatory and not
 * yet confirmed"), which already covers an expired or missing SARS TCS
 * PIN/COID letter among others. A real disqualification risk always wins
 * over the plain percentage - a tender at 90% with one expired mandatory
 * document is "Blocked", not "nearly ready".
 *
 * `hasUnreadSection` (standing review, 2026-11-06): computeTenderReadiness()
 * excludes any section whose own read failed from both `score` and
 * `fix.length` - so a section holding a real mandatory gap that just failed
 * to load this render can make `fixCount === 0` and `score === 100` look
 * identical to a genuinely clean tender. Without this flag, this board's
 * own "Pack Ready" badge - a claim stronger than a plain percentage - could
 * show on a transient read blip. Pass it whenever the caller's own
 * TenderReadiness has it; defaults to false only for callers that don't
 * have a TenderReadiness to check (kept optional so this isn't a breaking
 * change for them).
 */
export function packHealthStatusFromReadiness(score: number, fixCount: number, hasUnreadSection = false): PackHealthStatus {
  if (fixCount > 0) return "blocked";
  if (hasUnreadSection) return "in_progress";
  if (score === 100) return "ready";
  return "in_progress";
}

/**
 * The right-hand "Action" link/button per row (item 6: "an explicit
 * right-hand action button", not just the whole row being a click target).
 * Real states only: a submitted/won/lost tender's pack is done; a blocked
 * one carries a real mandatory-item count; a not-started one hasn't been
 * opened at all; everything else is still a workspace to continue.
 */
export function primaryActionLabel(stage: PipelineStage, packHealth: PackHealth | null): string {
  // briefing_shortlisted (0105) is also "done" for this purpose - already
  // submitted, now awaiting the buyer's briefing/shortlist decision - the
  // same reason submitted/won/lost already return here. Found 2026-11-02:
  // missing before this, so a briefing_shortlisted card (whose packHealth is
  // always null - page.tsx's own biddingCards only computes it for
  // assessing/building) fell through to "Continue workspace →", as if the
  // pack still needed work.
  if (stage === "submitted" || stage === "briefing_shortlisted" || stage === "won" || stage === "lost") return "View bid pack →";
  if (packHealth?.status === "blocked") return `Fix returnables (${packHealth.fixCount}) →`;
  if (packHealth?.status === "not_started") return "Start workspace →";
  return "Continue workspace →";
}
