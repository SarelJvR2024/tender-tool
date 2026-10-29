// Extracted from app/discovery/page.tsx (2026-10-29) so this pure mapping has
// a test file - the established pattern in this codebase (lib/documentExpiry.ts,
// lib/discoveryPagination.ts) for logic that would otherwise live untested
// inside a server component page.
//
// "How it's scored": structured chips (Sarel's own ask, Ticket 3 - "a
// structured Functionality Scorecard and Qualification Breakdown" instead of
// generic text like "Functionality scored first - minimum 70 to qualify for
// price"). Reads ONLY the fields engine/discovery/score_outlook.py already
// computes and returns real numbers for (preference_system.system,
// functionality.present/threshold, specific_goals.points_estimate,
// locality.match) - no per-category weight is invented for tenders this
// engine can't actually score per-category yet (see that module's own header
// comment on why FUNCTIONALITY is reported, not estimated, outside SANRAL).
// Each chip's `title` carries the same plain-language `reason` score_outlook
// .py already writes - one source of truth for the "why", not a second copy
// of its logic.

export type ScoreOutlook = {
  preference_system?: { system: "80/20" | "90/10" | "ambiguous" | "not_found"; reason: string } | null;
  specific_goals?: { bases: string[]; points_estimate: string | null; reason: string } | null;
  functionality?: { present: boolean | null; threshold: number | null; sanral_methodology?: boolean; reason: string } | null;
  locality?: { match: { status: "matched" | "no_match" | "unknown"; points: number | null; reason: string } | null } | null;
} | null;

export const SCORE_CHIP_CLASS = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  muted: "bg-muted text-muted-foreground",
} as const;

export type ScoreOutlookChip = { label: string; tone: keyof typeof SCORE_CHIP_CLASS; title: string };

export function scoreOutlookChips(outlook: ScoreOutlook): ScoreOutlookChip[] {
  if (!outlook) return [];
  const chips: ScoreOutlookChip[] = [];

  const pref = outlook.preference_system;
  if (pref?.system === "80/20" || pref?.system === "90/10") {
    chips.push({ label: `Price ${pref.system}`, tone: "success", title: pref.reason });
  } else if (pref?.system === "ambiguous") {
    chips.push({ label: "Price split: ambiguous", tone: "warning", title: pref.reason });
  }

  const func = outlook.functionality;
  if (func?.present === true) {
    chips.push({
      label: func.threshold ? `Functionality ≥ ${func.threshold}` : "Functionality gate",
      tone: "warning",
      title: func.reason,
    });
  } else if (func?.present === false) {
    chips.push({ label: "No functionality gate", tone: "success", title: func.reason });
  }

  const goals = outlook.specific_goals;
  if (goals?.points_estimate) {
    chips.push({ label: `Specific goals: ${goals.points_estimate}`, tone: "success", title: goals.reason });
  } else if (goals?.bases?.length) {
    chips.push({ label: "Specific goals: check manually", tone: "warning", title: goals.reason });
  }

  const locMatch = outlook.locality?.match;
  if (locMatch?.status === "matched") {
    chips.push({ label: `Locality: matched${locMatch.points ? ` (${locMatch.points}pt)` : ""}`, tone: "success", title: locMatch.reason });
  } else if (locMatch?.status === "no_match") {
    chips.push({ label: "Locality: no match", tone: "muted", title: locMatch.reason });
  }

  return chips;
}
