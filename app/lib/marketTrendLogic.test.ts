/**
 * Regression test for the market-trend honesty gate (marketTrendLogic.ts,
 * migration 0062's market_trend_for_tags()) - "once we get winning prices
 * ... start building market tendering trends for similar future projects"
 * (Sarel), on top of the existing public_tender_outcomes (0053) /
 * tender_scope_records (0060) work.
 *
 * Pure function, no Supabase, no network, no mocks - same "real logic, no
 * mocks" spirit as pack-review-logic.test.ts. Covers the two honesty gates
 * the build task asked for: the minimum-sample-size gate (no trend below
 * it) and the percentage-of-estimate figure firing only when a real stated
 * estimate exists in sufficient number.
 *
 * Run: node --experimental-strip-types --test app/lib/marketTrendLogic.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { MARKET_TREND_MIN_SAMPLE, gateMarketTrend, type MarketTrendRow } from "./marketTrendLogic.ts";

function row(overrides: Partial<MarketTrendRow> = {}): MarketTrendRow {
  return {
    n: MARKET_TREND_MIN_SAMPLE,
    date_from: "2025-01-01",
    date_to: "2025-06-01",
    pct_of_estimate_n: MARKET_TREND_MIN_SAMPLE,
    pct_of_estimate_median: 0.9,
    bidder_count_n: MARKET_TREND_MIN_SAMPLE,
    bidder_count_median: 4,
    bbbee_level_counts: { "1": 3, "2": 2 },
    ...overrides,
  };
}

test("gateMarketTrend: null row (no comparable awards at all) shows nothing", () => {
  assert.equal(gateMarketTrend(null), null);
});

test(`gateMarketTrend: below MARKET_TREND_MIN_SAMPLE (${MARKET_TREND_MIN_SAMPLE}) comparable awards shows nothing - we stop, we never guess`, () => {
  assert.equal(gateMarketTrend(row({ n: MARKET_TREND_MIN_SAMPLE - 1 })), null);
});

test("gateMarketTrend: exactly at the minimum sample shows a trend", () => {
  const trend = gateMarketTrend(row({ n: MARKET_TREND_MIN_SAMPLE }));
  assert.ok(trend);
  assert.equal(trend!.n, MARKET_TREND_MIN_SAMPLE);
});

test("gateMarketTrend: the pct-of-estimate figure fires only when a real stated estimate exists in a sufficient sample", () => {
  const trend = gateMarketTrend(row({ n: 20, pct_of_estimate_n: MARKET_TREND_MIN_SAMPLE, pct_of_estimate_median: 0.82 }));
  assert.ok(trend);
  assert.equal(trend!.pctOfEstimate.n, MARKET_TREND_MIN_SAMPLE);
  assert.equal(trend!.pctOfEstimate.median, 0.82);
});

test("gateMarketTrend: overall award count clears the gate but pct-of-estimate sample does not - no percentage is shown", () => {
  // Most comparable awards have no stated estimate at all (the common
  // case, per tender_scope_records.value_band_basis = 'unknown' for most
  // tenders) - a thinner sample than the overall award count, gated on its
  // own even once the headline count looks big enough.
  const trend = gateMarketTrend(row({ n: 30, pct_of_estimate_n: MARKET_TREND_MIN_SAMPLE - 1, pct_of_estimate_median: 0.75 }));
  assert.ok(trend);
  assert.equal(trend!.n, 30);
  assert.equal(trend!.pctOfEstimate.median, null, "never show a %-of-estimate figure built on too few real estimates");
  assert.equal(trend!.pctOfEstimate.n, MARKET_TREND_MIN_SAMPLE - 1);
});

test("gateMarketTrend: zero stated estimates among the comparable awards never fabricates a ratio", () => {
  const trend = gateMarketTrend(row({ n: 10, pct_of_estimate_n: 0, pct_of_estimate_median: null }));
  assert.ok(trend);
  assert.equal(trend!.pctOfEstimate.n, 0);
  assert.equal(trend!.pctOfEstimate.median, null);
});

test("gateMarketTrend: overall award count clears the gate but bidder-count sample does not - no bidder figure is shown", () => {
  // bidder_rows in market_trend_for_tags() (0062) is filtered to
  // `bidder_count > 0`, the same "often thinner than n" shape as
  // pct_of_estimate_n - a handful of awards with a recorded bidder count
  // must not produce a confident "Typically N bidders" once the headline
  // award count looks big enough on its own.
  const trend = gateMarketTrend(row({ n: 30, bidder_count_n: MARKET_TREND_MIN_SAMPLE - 1, bidder_count_median: 7 }));
  assert.ok(trend);
  assert.equal(trend!.n, 30);
  assert.equal(trend!.bidderCount.median, null, "never show a bidder-count figure built on too few recorded counts");
  assert.equal(trend!.bidderCount.n, MARKET_TREND_MIN_SAMPLE - 1);
});

test("gateMarketTrend: zero recorded bidder counts among the comparable awards never fabricates a median", () => {
  const trend = gateMarketTrend(row({ n: 10, bidder_count_n: 0, bidder_count_median: null }));
  assert.ok(trend);
  assert.equal(trend!.bidderCount.n, 0);
  assert.equal(trend!.bidderCount.median, null);
});

test("gateMarketTrend: bidder-count figure fires once its own sample clears the minimum, independent of pct_of_estimate's", () => {
  const trend = gateMarketTrend(row({ n: 20, bidder_count_n: MARKET_TREND_MIN_SAMPLE, bidder_count_median: 3 }));
  assert.ok(trend);
  assert.equal(trend!.bidderCount.n, MARKET_TREND_MIN_SAMPLE);
  assert.equal(trend!.bidderCount.median, 3);
});

test("gateMarketTrend: string numerics from Postgres (numeric/percentile_cont) are coerced to real numbers", () => {
  const trend = gateMarketTrend(row({ n: 8, pct_of_estimate_n: 8, pct_of_estimate_median: "0.87" as unknown as number, bidder_count_median: "5.5" as unknown as number }));
  assert.ok(trend);
  assert.equal(trend!.pctOfEstimate.median, 0.87);
  assert.equal(trend!.bidderCount.median, 5.5);
});

test("gateMarketTrend: B-BBEE level distribution is passed through as-is once its OWN sample clears the minimum, defaulting to empty rather than invented", () => {
  const withLevels = gateMarketTrend(row({ n: 6, bbbee_level_counts: { "1": 4, "2": 2 } }));
  assert.deepEqual(withLevels!.bbbeeLevelCounts, { "1": 4, "2": 2 });
  const withoutLevels = gateMarketTrend(row({ n: 6, bbbee_level_counts: null }));
  assert.deepEqual(withoutLevels!.bbbeeLevelCounts, {});
});

test("gateMarketTrend: overall award count clears the gate but the B-BBEE level sample does not - no level breakdown is shown", () => {
  // migration 0062's bbbee_rows CTE is filtered to `where winner_bbbee_points
  // is not null`, the same "often thinner than n" shape as bidder_rows/
  // pct_rows - most comparable awards have no recorded winning B-BBEE level.
  // There is no separate `bbbee_level_n` column to check (the SQL function
  // returns none), so the gate sums the level counts themselves.
  const trend = gateMarketTrend(row({ n: 30, bbbee_level_counts: { "2": 1 } }));
  assert.ok(trend);
  assert.equal(trend!.n, 30);
  assert.deepEqual(trend!.bbbeeLevelCounts, {}, "never show a B-BBEE level breakdown built on too few recorded levels");
});

test("gateMarketTrend: B-BBEE level breakdown fires once the SUM of its own counts clears the minimum, independent of n/pct_of_estimate/bidder_count", () => {
  const trend = gateMarketTrend(row({ n: 20, bbbee_level_counts: { "1": 3, "4": 2 } })); // sums to 5 = MIN_SAMPLE
  assert.ok(trend);
  assert.deepEqual(trend!.bbbeeLevelCounts, { "1": 3, "4": 2 });
});

test("gateMarketTrend: a custom minimum sample is honoured (callers should not need to invent a second constant)", () => {
  assert.equal(gateMarketTrend(row({ n: 2 }), 3), null);
  assert.ok(gateMarketTrend(row({ n: 3 }), 3));
});
