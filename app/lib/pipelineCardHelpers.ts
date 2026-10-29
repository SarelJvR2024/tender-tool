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
 */
export function packHealthStatusFromReadiness(score: number, fixCount: number): PackHealthStatus {
  if (fixCount > 0) return "blocked";
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
  if (stage === "submitted" || stage === "won" || stage === "lost") return "View bid pack →";
  if (packHealth?.status === "blocked") return `Fix returnables (${packHealth.fixCount}) →`;
  if (packHealth?.status === "not_started") return "Start workspace →";
  return "Continue workspace →";
}
