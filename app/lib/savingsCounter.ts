/**
 * Time and cost saved counter (spec §9, Tender-Ready-Claude-Spec_v1.md).
 * Calculation only - pure functions, no Supabase call inside any of them
 * (same convention as readiness.ts): every caller fetches its own rows
 * (company baseline, savings_counted_steps for the relevant period) and
 * passes them in, so the one place the formula lives can be unit-tested
 * without a database.
 *
 * "Default hours per step are placeholders until the owner supplies timed
 * figures from a real tender" (§9) - the values below are round, invented
 * numbers chosen only to be directionally plausible, not measured. Replace
 * them once Sarel times a real tender end to end.
 */

export type SavingsStepKey =
  | "compliance_check"
  | "vault_documents_filled"
  | "cvs_tailored"
  | "cover_page"
  | "template_filled"
  | "pack_assembled";

export const SAVINGS_STEP_HOURS: Record<SavingsStepKey, { hours: number; reason: string }> = {
  compliance_check: { hours: 2, reason: "Compliance check run and reviewed" },
  vault_documents_filled: { hours: 3, reason: "Vault documents auto-filled from your company profile" },
  cvs_tailored: { hours: 4, reason: "CVs tailored to this tender" },
  cover_page: { hours: 1, reason: "Cover page assembled" },
  template_filled: { hours: 5, reason: "Client template or SANRAL schedule filled" },
  pack_assembled: { hours: 2, reason: "Final submission pack assembled" },
};

export const SAVINGS_STEP_ORDER: SavingsStepKey[] = [
  "compliance_check",
  "vault_documents_filled",
  "cvs_tailored",
  "cover_page",
  "template_filled",
  "pack_assembled",
];

/** True if this step has already been counted for this tender (the actual enforcement is the DB's own unique constraint on savings_counted_steps - this is the same check expressed as a pure predicate, for callers that already have the counted-keys list in hand, e.g. to grey out a step in the UI rather than attempt a doomed insert). */
export function stepAlreadyCounted(countedStepKeys: readonly string[], stepKey: SavingsStepKey): boolean {
  return countedStepKeys.includes(stepKey);
}

/** One tender's total hours saved, capped at the company's own baseline (§9.2: "Hours saved per tender ≤ company baseline"). `rawStepHours` is the list of per-step hour SNAPSHOTS already counted for this one tender (savings_counted_steps.hours), not re-derived from SAVINGS_STEP_HOURS, so a later retune of the config never rewrites a past tender's own figure. */
export function hoursSavedForTender(rawStepHours: readonly number[], baselineHoursPerTender: number): number {
  const total = rawStepHours.reduce((sum, h) => sum + h, 0);
  return Math.min(total, Math.max(0, baselineHoursPerTender));
}

export type SavingsTotals = {
  hoursSaved: number;
  randSaved: number;
  tendersCounted: number;
};

/** Totals across a period (this month / all time) from already-capped per-tender hours (each produced by hoursSavedForTender). */
export function aggregateSavings(perTenderHours: readonly number[], hourlyCostZar: number): SavingsTotals {
  const hoursSaved = perTenderHours.reduce((sum, h) => sum + h, 0);
  return {
    hoursSaved,
    randSaved: Math.round(hoursSaved * Math.max(0, hourlyCostZar)),
    tendersCounted: perTenderHours.length,
  };
}

/**
 * "Room for N more tenders without hiring" (§9.2/§9.3): floor(hours saved in
 * period ÷ (baseline hours − average hours saved per tender)), guarded
 * against divide-by-zero. The denominator is the hours a tender STILL costs
 * after Tender Ready's help - if that's zero or negative (the average saved
 * already meets or exceeds the whole baseline, or there's nothing to divide
 * by because no tender has been counted yet), there is no well-defined
 * "extra capacity" number, so this returns 0 rather than Infinity/NaN.
 */
export function extraCapacity(hoursSavedInPeriod: number, tendersCounted: number, baselineHoursPerTender: number): number {
  if (tendersCounted <= 0) return 0;
  const avgHoursSavedPerTender = hoursSavedInPeriod / tendersCounted;
  const remainingHoursPerTender = baselineHoursPerTender - avgHoursSavedPerTender;
  if (!Number.isFinite(remainingHoursPerTender) || remainingHoursPerTender <= 0) return 0;
  const extra = hoursSavedInPeriod / remainingHoursPerTender;
  return Number.isFinite(extra) ? Math.floor(extra) : 0;
}

/** SA Rand formatting per spec §9.3/§6 ("R27 900", "R20 000 000") - a plain space thousands separator, not a comma, and never negative/decimal. */
export function formatRand(amount: number): string {
  const rounded = Math.max(0, Math.round(amount));
  return "R" + rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
