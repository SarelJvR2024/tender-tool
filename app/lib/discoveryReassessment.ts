/**
 * A Discovery verdict a re-assessment made worse (migration 0055,
 * engine/discovery/discovery_downgrades.py - the same fit order:
 * strong_fit > possible > needs_review > not_a_fit). Sarel, 2026-10-17: "When
 * evaluation downgrades opportunity it must be flagged."
 */

export const FIT_RANK: Record<string, number> = { strong_fit: 3, possible: 2, needs_review: 1, not_a_fit: 0 };

export const VERDICT_LABEL: Record<string, string> = {
  strong_fit: "Strong fit",
  possible: "Possible",
  needs_review: "Needs review",
  not_a_fit: "Not a fit",
  closed: "Closed",
};

export const DOWNGRADE_COLUMNS =
  "downgraded_from, downgraded_at, downgrade_cause, reasons_before, downgrade_acknowledged_at, downgrade_acknowledged_by";

export type Downgrade = {
  downgraded_from: string | null;
  downgraded_at: string | null;
  downgrade_cause: string | null;
  reasons_before: string[] | null;
  downgrade_acknowledged_at: string | null;
  downgrade_acknowledged_by: string | null;
};

/** Ever downgraded (and not recovered since): the "was ..." marker shows. */
export function isDowngraded(d: Partial<Downgrade> | null | undefined): boolean {
  return !!d?.downgraded_from;
}

/** Downgraded and nobody in the company has marked it seen yet: the banner shows. */
export function isOpenDowngrade(d: Partial<Downgrade> | null | undefined): boolean {
  return !!d?.downgraded_from && !d.downgrade_acknowledged_at;
}

export function verdictLabel(v: string | null | undefined): string {
  return (v && VERDICT_LABEL[v]) || v || "-";
}

export function causeLine(cause: string | null | undefined): string {
  if (cause === "profile_changed") return "Your company profile changed since this tender was first scored, so it was scored again.";
  if (cause === "retry_after_error") return "The earlier scoring had failed; it was scored again.";
  return "This tender was scored again.";
}

// Pipeline stages at which the company is actively working on the tender
// (the same set the tender-update watch alerts, 0039/0048/0106). 'bidding'
// is the pre-0105 legacy value (see lib/pipeline.ts's LEGACY_BIDDING_STAGE) -
// kept here so a not-yet-backfilled row doesn't silently drop out of this
// list; harmless, unreachable once 0105 has run. 'briefing_shortlisted' was
// missing from this list for a few hours after 0105 introduced it (Finding
// 111/112, a sibling QA pass, 2026-10-31) - a tender at that stage is
// awaiting an outcome exactly like 'submitted' already is, which this list
// deliberately keeps for the same reason.
export const ACTIVE_PURSUIT_STAGES = ["found", "assessing", "building", "bidding", "submitted", "briefing_shortlisted"];
