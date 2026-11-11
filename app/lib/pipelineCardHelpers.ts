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

// SAST is UTC+2 with no DST - the same fact lib/dates.ts's closingDayOf()
// and lib/analyticsLogic.ts's monthKey() already rely on, duplicated here
// as its own local constant rather than imported, matching this codebase's
// own established convention for this exact shift (lib/analyticsLogic.ts,
// lib/marketPricing.ts and lib/savingsCounterData.ts each keep their own
// identical copy rather than sharing one).
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/**
 * Finding 428 (2026-11-11): is `dateStr` (a `timestamptz` read back over
 * PostgREST as a UTC ISO string, e.g. `tender_packs.submitted_at`) in the
 * same calendar month as `now`, in real South African (SAST) time - never
 * a naive `getUTCFullYear()`/`getUTCMonth()` comparison of the two raw,
 * un-shifted UTC instants. The exact Finding 413/414/426 bug class
 * (naive-UTC month anchoring), independently present at a 4th site: Bids
 * board's own header-strip "Submitted this month" stat (app/pipeline/
 * page.tsx) compared `d.getUTCFullYear()/getUTCMonth()` against
 * `now.getUTCFullYear()/getUTCMonth()` directly, with no SAST shift at
 * all. For the first ~2 hours of every real SAST calendar month (SAST
 * 00:00-01:59, i.e. UTC 22:00-23:59 the prior day), `now`'s raw UTC month
 * is still the PREVIOUS month, so the stat silently counted the previous
 * month's submissions as "this month" instead of the real new month's
 * (which should read 0 if nothing has been submitted yet). Confirmed live
 * before this fix: at the real SAST instant 2026-12-01T00:30 (UTC
 * 2026-11-30T22:30Z), a card submitted 2026-11-15 - plainly a November,
 * not December, submission - was counted into "submitted this month".
 */
export function isSameSastMonth(dateStr: string, now: Date): boolean {
  const d = new Date(new Date(dateStr).getTime() + SAST_OFFSET_MS);
  const nowSast = new Date(now.getTime() + SAST_OFFSET_MS);
  return d.getUTCFullYear() === nowSast.getUTCFullYear() && d.getUTCMonth() === nowSast.getUTCMonth();
}
