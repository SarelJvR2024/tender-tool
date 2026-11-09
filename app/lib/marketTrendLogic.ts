/**
 * Pure gating logic for the market-tendering trend (migration 0062,
 * market_trend_for_tags()) - "once we get winning prices ... start
 * building market tendering trends for similar future projects" (Sarel).
 * No Supabase/React/Next imports, same split as pack-review-logic.ts: the
 * honesty rule (below MIN_SAMPLE comparable awards, show nothing) lives
 * here as a pure function so it is unit-testable without a database;
 * marketPricing.ts's loadMarketTrend() is a thin Supabase-reading shell
 * around it.
 */

/** Below this many comparable tenders a trend is not shown at all - same
 * threshold (and same reasoning) as MIN_SAMPLE in marketPricing.ts: thin
 * enough to reuse, not invent a second number. "We stop, we never guess"
 * applies to a trend line exactly as it does to a missing field. */
export const MARKET_TREND_MIN_SAMPLE = 5;

export type MarketTrend = {
  n: number;
  dateFrom: string | null;
  dateTo: string | null;
  pctOfEstimate: { n: number; median: number | null };
  bidderCount: { n: number; median: number | null };
  bbbeeLevelCounts: Record<string, number>;
};

export type MarketTrendRow = {
  n: number;
  date_from: string | null;
  date_to: string | null;
  pct_of_estimate_n: number;
  pct_of_estimate_median: number | string | null;
  bidder_count_n: number;
  bidder_count_median: number | string | null;
  bbbee_level_counts: Record<string, number> | null;
};

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turns one market_trend_for_tags() row into a MarketTrend, or null below
 * the minimum sample. Four gates, not one:
 *  - the overall award count (`row.n`) must clear MARKET_TREND_MIN_SAMPLE
 *    before anything is shown at all;
 *  - the price-vs-estimate figure is additionally gated on ITS OWN sample
 *    (`pct_of_estimate_n`), since most comparable awards have no stated
 *    estimate to compare against even once the overall count clears the
 *    first gate - never show a percentage built on a handful of real
 *    estimates just because the headline count looks big;
 *  - the bidder-count figure is gated the same way, on `bidder_count_n`
 *    (2026-11-04: migration 0062's own function comment and
 *    bidder_rows CTE - `where bidder_count > 0` - already document and
 *    produce this as a separate, often-thinner sample than `n`, exactly
 *    like pct_of_estimate_n; this caller just wasn't applying the gate
 *    it to, so market-context.tsx could show "Typically N bidders" off
 *    a one- or two-award sample even once the headline count looked
 *    big enough);
 *  - the B-BBEE level distribution is gated the same way again, on the SUM
 *    of its own counts (standing review, 2026-11-09: migration 0062's
 *    `bbbee_rows` CTE is filtered to `where winner_bbbee_points is not
 *    null` - the exact same "thinner than n" shape as bidder_rows/
 *    pct_rows - but, unlike those two, the SQL function returns no
 *    `bbbee_level_n` column for it at all, and this caller was passing
 *    `bbbee_level_counts` through unconditionally; market-context.tsx's own
 *    render gate was only `bbbeeTotal > 0`, so a tender with n=30 headline
 *    awards but only 1 of them carrying a recorded B-BBEE level rendered
 *    "Winning B-BBEE level, 1 award: ..." right next to "Based on 30
 *    comparable past awards" - the identical bidder-count bug fixed above,
 *    on the one remaining per-field sample this function wasn't yet
 *    applying MIN_SAMPLE to. No `bbbee_level_n` column exists to read, so
 *    the gate sums the counts themselves - exactly what the sole caller
 *    already did at render time to label the total, just too late to
 *    suppress a too-thin one).
 */
export function gateMarketTrend(row: MarketTrendRow | null, minSample = MARKET_TREND_MIN_SAMPLE): MarketTrend | null {
  if (!row || row.n < minSample) return null;
  const bbbeeLevelCounts = row.bbbee_level_counts ?? {};
  const bbbeeTotal = Object.values(bbbeeLevelCounts).reduce((s, c) => s + c, 0);
  return {
    n: row.n,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    pctOfEstimate: {
      n: row.pct_of_estimate_n,
      median: row.pct_of_estimate_n >= minSample ? num(row.pct_of_estimate_median) : null,
    },
    bidderCount: {
      n: row.bidder_count_n,
      median: row.bidder_count_n >= minSample ? num(row.bidder_count_median) : null,
    },
    bbbeeLevelCounts: bbbeeTotal >= minSample ? bbbeeLevelCounts : {},
  };
}
