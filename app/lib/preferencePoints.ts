// PPPFA / Preferential Procurement Regulations, 2022 preference-points
// calculator - the free "B-BBEE preference points calculator" lead-magnet
// tool (/tools/bee-preference-points).
//
// `tenderCompliance.ts` already TRACKS a company's B-BBEE level and flags
// preference-point risk conceptually (e.g. "you would score 0 of the
// 10/20 preference points"), and `engine/discovery/score_outlook.py`
// parses a buyer's own B-BBEE points table when published - but neither
// COMPUTES the price-points formula itself anywhere (confirmed by grep
// for "Pmin"/"Ps =" across app/ and engine/ before writing this). This is
// the first place the actual regulation formula is implemented.
//
// Source: Preferential Procurement Regulations, 2022 (GG 47452, Notice
// 2721 of 4 Nov 2022, in force 16 Jan 2023) - see
// docs/specs/Tender-Regulatory-Compliance-Review.md §2.1, read before
// building this rather than re-deriving the formula:
//   - reg 4 (80/20 system, Rand value <= R50 million inclusive of all
//     taxes): Ps = 80 x (1 - (Pt - Pmin) / Pmin); max 20 points for
//     specific goals; total rounded to 2 decimals.
//   - reg 5 (90/10 system, > R50 million): Ps = 90 x (1 - (Pt - Pmin) / Pmin);
//     max 10 points for specific goals.
//   Ps = points for price, Pt = price of tender under consideration,
//   Pmin = price of the lowest acceptable tender.
//
// The PPR 2022 itself sets no B-BBEE points table - "each organ of state
// chooses its own specific goals" (reg 3(1), Review §2.1: "No B-BBEE
// points table"). What this tool uses for the specific-goals side is the
// B-BBEE-status-level table that Treasury's own SBD 6.1 "Preference
// Points Claim Form (in terms of PPR 2022)" publishes and that the large
// majority of organs of state (incl. SANRAL - see
// `_bbbee_points_by_level()` in engine/discovery/score_outlook.py,
// accepted only when Level 1 reads exactly 10/20) adopt unchanged. A
// buyer can legally publish a different table for a different specific
// goal (veteran-owned, locality, youth, etc.) - this tool is explicitly
// the common case, not a guarantee for every tender; the UI says so.

export const PPR_2022_THRESHOLD_ZAR = 50_000_000; // reg 4/5: "Rand value", inclusive of all taxes

export type PreferenceSystem = "80/20" | "90/10";

/** Which system applies, purely from contract value - reg 4 (<= R50m)
 * vs reg 5 (> R50m). A buyer can still state the system explicitly on
 * the tender itself (reg 3(2)); this is the fallback/default read. */
export function systemForValue(contractValueZarInclVat: number): PreferenceSystem {
  return contractValueZarInclVat <= PPR_2022_THRESHOLD_ZAR ? "80/20" : "90/10";
}

/** Max price points (Ps's own maximum, at Pt = Pmin) and max specific-goals
 * points for each system. */
export function maxPoints(system: PreferenceSystem): { maxPricePoints: number; maxGoalsPoints: number } {
  return system === "80/20" ? { maxPricePoints: 80, maxGoalsPoints: 20 } : { maxPricePoints: 90, maxGoalsPoints: 10 };
}

/** reg 4 / reg 5 price-points formula: Ps = system-max x (1 - (Pt - Pmin) / Pmin).
 * Pmin must be > 0 (it's the lowest acceptable tender's price). Returns
 * the result rounded to 2 decimals, per the regulation's own rounding
 * rule, and never above the system's max (a tender priced below Pmin -
 * which shouldn't happen since Pmin is defined as the lowest - is capped
 * rather than allowed to exceed the max point by a rounding fluke). */
export function pricePoints(system: PreferenceSystem, tenderPriceZar: number, lowestAcceptablePriceZar: number): number {
  if (lowestAcceptablePriceZar <= 0) {
    throw new Error("lowestAcceptablePriceZar (Pmin) must be greater than 0");
  }
  const { maxPricePoints } = maxPoints(system);
  const raw = maxPricePoints * (1 - (tenderPriceZar - lowestAcceptablePriceZar) / lowestAcceptablePriceZar);
  const capped = Math.min(raw, maxPricePoints);
  return Math.round(capped * 100) / 100;
}

// Treasury SBD 6.1 "in terms of PPR 2022" B-BBEE status-level table - see
// file header for why this (not the PPR 2022 regulations themselves) is
// the source. Keyed by B-BBEE status level 1-8; "non_compliant" for a
// contributor with no valid B-BBEE status / level.
export type BeeLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | "non_compliant";

const BEE_POINTS_TABLE: Record<BeeLevel, { points8020: number; points9010: number }> = {
  1: { points8020: 20, points9010: 10 },
  2: { points8020: 18, points9010: 9 },
  3: { points8020: 14, points9010: 7 },
  4: { points8020: 12, points9010: 5 },
  5: { points8020: 8, points9010: 4 },
  6: { points8020: 6, points9010: 3 },
  7: { points8020: 4, points9010: 2 },
  8: { points8020: 2, points9010: 1 },
  non_compliant: { points8020: 0, points9010: 0 },
};

/** B-BBEE specific-goals points for a given level under the given system,
 * from the SBD 6.1 standard table (see file header). No valid proof on
 * file is the caller's job to pass as "non_compliant" - per SBD 6.1 and
 * R.396 Book 1, a missing/invalid B-BBEE certificate scores 0, it does
 * not disqualify the bid (same rule `tenderCompliance.ts`'s B-BBEE row
 * already states). */
export function beeGoalsPoints(system: PreferenceSystem, level: BeeLevel): number {
  const row = BEE_POINTS_TABLE[level];
  return system === "80/20" ? row.points8020 : row.points9010;
}

export type PreferencePointsResult = {
  system: PreferenceSystem;
  pricePoints: number;
  beeGoalsPoints: number;
  totalPoints: number; // rounded to 2 decimals, per reg 4/5
  maxPricePoints: number;
  maxGoalsPoints: number;
};

/** One-call convenience: given a contract value (decides 80/20 vs 90/10
 * per reg 4/5, unless overridden), a tender's own price, the lowest
 * acceptable tender's price, and a B-BBEE level, returns the full
 * points breakdown. `system` can be passed explicitly when the tender
 * document states which system applies (reg 3(1)/3(2)) rather than
 * leaving it to the R50m default. */
export function calculatePreferencePoints(input: {
  contractValueZarInclVat: number;
  tenderPriceZar: number;
  lowestAcceptablePriceZar: number;
  beeLevel: BeeLevel;
  system?: PreferenceSystem;
}): PreferencePointsResult {
  const system = input.system ?? systemForValue(input.contractValueZarInclVat);
  const { maxPricePoints, maxGoalsPoints } = maxPoints(system);
  const ps = pricePoints(system, input.tenderPriceZar, input.lowestAcceptablePriceZar);
  const goals = beeGoalsPoints(system, input.beeLevel);
  return {
    system,
    pricePoints: ps,
    beeGoalsPoints: goals,
    totalPoints: Math.round((ps + goals) * 100) / 100,
    maxPricePoints,
    maxGoalsPoints,
  };
}
