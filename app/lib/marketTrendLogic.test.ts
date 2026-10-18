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

test("gateMarketTrend: string numerics from Postgres (numeric/percentile_cont) are coerced to real numbers", () => {
  const trend = gateMarketTrend(row({ n: 8, pct_of_estimate_n: 8, pct_of_estimate_median: "0.87" as unknown as number, bidder_count_median: "5.5" as unknown as number }));
  assert.ok(trend);
  assert.equal(trend!.pctOfEstimate.median, 0.87);
  assert.equal(trend!.bidderCount.median, 5.5);
});

test("gateMarketTrend: B-BBEE level distribution is passed through as-is, defaulting to empty rather than invented", () => {
  const withLevels = gateMarketTrend(row({ n: 6, bbbee_level_counts: { "1": 4, "2": 2 } }));
  assert.deepEqual(withLevels!.bbbeeLevelCounts, { "1": 4, "2": 2 });
  const withoutLevels = gateMarketTrend(row({ n: 6, bbbee_level_counts: null }));
  assert.deepEqual(withoutLevels!.bbbeeLevelCounts, {});
});

test("gateMarketTrend: a custom minimum sample is honoured (callers should not need to invent a second constant)", () => {
  assert.equal(gateMarketTrend(row({ n: 2 }), 3), null);
  assert.ok(gateMarketTrend(row({ n: 3 }), 3));
});
