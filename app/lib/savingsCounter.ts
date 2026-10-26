/**
 * Time and cost saved counter (spec §9, Tender-Ready-Claude-Spec_v1.md;
 * reworked 2026-10-26 per the "Capacity Unlocked" brief). Calculation only -
 * pure functions, no Supabase call inside any of them (same convention as
 * readiness.ts): every caller fetches its own rows (company baseline,
 * savings_counted_steps for the relevant period) and passes them in, so the
 * one place the formula lives can be unit-tested without a database.
 *
 * Model change (2026-10-26): the previous version summed six separately
 * configured per-step hour values (compliance check, vault documents, CVs,
 * cover page, template, pack assembly) and capped the total at the
 * company's baseline. The brief replaces that with a single, simpler flat
 * figure per completed tender: baseline manual hours minus however long the
 * same work actually takes inside Tender Ready, once a tender's pack is
 * generated. This is a deliberate simplification, not a bug fix - the old
 * per-step list is gone (nothing elsewhere renders it any more), and a
 * completed tender's own hours-saved snapshot is written once as a single
 * `savings_counted_steps` row (same table, same once-per-tender unique
 * constraint, just one step key now instead of six).
 */

/**
 * "Default hours per tender are placeholders until the owner supplies timed
 * figures from a real tender" (§9) - round, invented numbers chosen only to
 * be directionally plausible, not measured.
 */
export const DEFAULT_BASELINE_HOURS_PER_TENDER = 20;
export const DEFAULT_BASELINE_HOURLY_COST_ZAR = 450;

/**
 * How long the same tender takes once prepared inside Tender Ready
 * (prefilled returnables, instant vault documents, auto-assembled pack) -
 * a product characteristic, not a per-company setting, so unlike the two
 * baseline figures above this is NOT stored on `companies` or editable in
 * Company Settings; it's a fixed, documented placeholder until a real
 * timed tender gives a measured figure to replace it with.
 */
export const DEFAULT_TIME_SPENT_HOURS_PER_TENDER = 5;

// Company-editable ranges (Company Settings' own number inputs and
// lib/companyProfileUpdate.ts's server-side validation both enforce these -
// a company's own baseline, not a universal average, but still bounded so a
// stray typo (2 hours? R45 000/hour?) can't quietly produce an absurd
// savings figure).
export const BASELINE_HOURS_MIN = 10;
export const BASELINE_HOURS_MAX = 40;
export const HOURLY_COST_MIN_ZAR = 250;
export const HOURLY_COST_MAX_ZAR = 1500;

/**
 * One completed tender's hours saved: the company's own baseline (how long
 * the work takes manually) minus the time actually spent inside Tender
 * Ready. Never negative - a baseline at or below the time-spent figure
 * means this tender's own numbers show no saving, not a fabricated one.
 */
export function hoursSavedPerCompletedTender(
  baselineHoursPerTender: number,
  timeSpentHoursPerTender: number = DEFAULT_TIME_SPENT_HOURS_PER_TENDER,
): number {
  return Math.max(0, baselineHoursPerTender - timeSpentHoursPerTender);
}

export type SavingsTotals = {
  hoursSaved: number;
  randSaved: number;
  tendersCounted: number;
};

/** Totals across a period (this month / all time) from already-computed per-tender hours-saved snapshots (each produced by hoursSavedPerCompletedTender at the moment a tender's pack was generated). */
export function aggregateSavings(perTenderHours: readonly number[], hourlyCostZar: number): SavingsTotals {
  const hoursSaved = perTenderHours.reduce((sum, h) => sum + h, 0);
  return {
    hoursSaved,
    randSaved: Math.round(hoursSaved * Math.max(0, hourlyCostZar)),
    tendersCounted: perTenderHours.length,
  };
}

/**
 * "Room for N more tenders without hiring": the saved hours in a period,
 * expressed as a whole number of extra tenders at the company's own full
 * baseline cost per tender. Deliberately the conservative reading (divides
 * by the FULL baseline, not by however little a tender now costs inside
 * Tender Ready) - "no exaggerated numbers" is this feature's own stated
 * rule, and dividing by the smaller remaining-cost figure would overstate
 * capacity. Guarded against divide-by-zero/negative exactly like the rest
 * of this module: an invalid baseline returns 0, never Infinity/NaN.
 */
export function extraCapacity(hoursSavedInPeriod: number, baselineHoursPerTender: number): number {
  if (!Number.isFinite(baselineHoursPerTender) || baselineHoursPerTender <= 0) return 0;
  if (!Number.isFinite(hoursSavedInPeriod) || hoursSavedInPeriod <= 0) return 0;
  return Math.floor(hoursSavedInPeriod / baselineHoursPerTender);
}

/** SA Rand formatting per spec §9.3/§6 ("R27 900", "R20 000 000") - a plain space thousands separator, not a comma, and never negative/decimal. Deliberately NOT lib/formatZAR.ts's canonical formatter - see that file's own header comment for why this counter keeps its own, already-spec-pinned format. */
export function formatRand(amount: number): string {
  const rounded = Math.max(0, Math.round(amount));
  return "R" + rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/**
 * Spec v3 §18, Sarel's own answer (2026-10-22): no real measured data exists
 * behind 20h/R450 - it must stay a visibly-flagged proposed default the
 * user can confirm or change, never presented as fact. `resolveBaseline()`
 * is the one place that decides "is this company's own confirmed number, or
 * did we fall back to the placeholder" - every caller (the Home/Analytics
 * summary, the per-tender breakdown) must use this, not its own silent `??`,
 * so the two surfaces can't quietly disagree on which case they're in.
 */
export type ResolvedBaseline = {
  hoursPerTender: number;
  hourlyCostZar: number;
  /** True when either value came from the placeholder default, not the company's own confirmed baseline. */
  isDefault: boolean;
};

export function resolveBaseline(
  hoursPerTender: number | null | undefined,
  hourlyCostZar: number | null | undefined,
): ResolvedBaseline {
  const isDefault = hoursPerTender == null || hourlyCostZar == null;
  return {
    hoursPerTender: hoursPerTender ?? DEFAULT_BASELINE_HOURS_PER_TENDER,
    hourlyCostZar: hourlyCostZar ?? DEFAULT_BASELINE_HOURLY_COST_ZAR,
    isDefault,
  };
}
