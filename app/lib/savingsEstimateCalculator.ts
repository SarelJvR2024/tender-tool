/**
 * Marketing "estimate your own savings" calculator (homepage). A visitor
 * types in their own tenders/month, hours/tender and hourly rate - there is
 * no real tender behind this, so it's a deliberately simpler, self-
 * contained model than lib/savingsCounter.ts's real per-tender counter
 * (which counts actual completed pack steps).
 *
 * Every annual figure here is derived directly from its own monthly figure
 * (x12), never recomputed a second way - that's what makes
 * annualExtraCapacity mathematically impossible to contradict
 * monthlyExtraCapacity, which a previous version of this calculator did not
 * guarantee (it showed "+11 extra tenders a month" from one formula with no
 * corresponding, consistent annual figure at all).
 */

/** Fraction of a tender's administrative assembly (compliance docs, CV formatting, returnables compilation) Tender Ready removes. A product constant, not a visitor input. */
export const ADMIN_TIME_SAVED_FRACTION = 0.75;

export type SavingsEstimateInputs = {
  tendersPerMonth: number;
  hoursPerTender: number;
  hourlyRate: number;
};

export type SavingsEstimate = {
  adminHoursSavedPerTender: number;
  monthlyHoursSaved: number;
  annualHoursSaved: number;
  monthlyRandSaved: number;
  annualRandSaved: number;
  monthlyExtraCapacity: number;
  annualExtraCapacity: number;
};

export function calculateSavingsEstimate(inputs: SavingsEstimateInputs): SavingsEstimate {
  const tendersPerMonth = Math.max(0, inputs.tendersPerMonth);
  const hoursPerTender = Math.max(0, inputs.hoursPerTender);
  const hourlyRate = Math.max(0, inputs.hourlyRate);

  const adminHoursSavedPerTender = Math.round(hoursPerTender * ADMIN_TIME_SAVED_FRACTION);
  const monthlyHoursSaved = tendersPerMonth * adminHoursSavedPerTender;
  const annualHoursSaved = monthlyHoursSaved * 12;
  const monthlyRandSaved = monthlyHoursSaved * hourlyRate;
  const annualRandSaved = annualHoursSaved * hourlyRate;
  // hoursPerTender = 0 has no well-defined "extra tenders relative to
  // baseline effort" ratio - 0 rather than NaN/Infinity, same guard
  // discipline as lib/savingsCounter.ts's own extraCapacity().
  const monthlyExtraCapacity = hoursPerTender > 0 ? Number((monthlyHoursSaved / hoursPerTender).toFixed(1)) : 0;
  const annualExtraCapacity = Math.round(monthlyExtraCapacity * 12);

  return {
    adminHoursSavedPerTender,
    monthlyHoursSaved,
    annualHoursSaved,
    monthlyRandSaved,
    annualRandSaved,
    monthlyExtraCapacity,
    annualExtraCapacity,
  };
}
