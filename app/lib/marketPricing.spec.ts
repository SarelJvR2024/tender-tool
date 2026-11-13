import { describe, expect, it } from "vitest";
import {
  benchmark,
  byBuyer,
  byCategory,
  byProvince,
  fieldReliable,
  loadOutcomesForTenders,
  loadSegment,
  MIN_SAMPLE,
  ownPosition,
  tenderFrequencyTrend,
  type Bidder,
  type MarketRow,
  type Segment,
  type TenderOutcome,
} from "./marketPricing";

/** A minimal, otherwise-"empty" market row - every field a real
 * public_tender_outcomes row has, defaulted to its own honest "nothing here"
 * value, so each test only states what it actually cares about. */
function row(overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    id: "id",
    status: "awarded",
    award_date: null,
    closing_date: null,
    winner_name: null,
    winner_amount_zar: null,
    winner_count: 1,
    bidder_count: 0,
    priced_bidder_count: 0,
    winner_rank: null,
    winner_vs_median: null,
    lowest_bid_won: null,
    register_columns: 1,
    sources: ["sanral_awarded"],
    categories: [],
    buyer: null,
    province: null,
    ...overrides,
  };
}

describe("tenderFrequencyTrend", () => {
  it("includes every month in the window, even ones with zero tenders", () => {
    const now = new Date(2026, 9, 22); // Oct 2026, 0-indexed month
    const trend = tenderFrequencyTrend([], 3, now);
    expect(trend.map((p) => p.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(trend.every((p) => p.count === 0)).toBe(true);
  });

  it("buckets by award_date when present", () => {
    const now = new Date(2026, 9, 22);
    const rows = [row({ award_date: "2026-09-05" }), row({ award_date: "2026-09-18" }), row({ award_date: "2026-10-01" })];
    const trend = tenderFrequencyTrend(rows, 3, now);
    expect(trend).toEqual([
      { month: "2026-08", count: 0 },
      { month: "2026-09", count: 2 },
      { month: "2026-10", count: 1 },
    ]);
  });

  it("falls back to closing_date when award_date is null (not yet awarded)", () => {
    const now = new Date(2026, 9, 22);
    const trend = tenderFrequencyTrend([row({ award_date: null, closing_date: "2026-09-10" })], 3, now);
    expect(trend.find((p) => p.month === "2026-09")?.count).toBe(1);
  });

  it("drops a row with neither date rather than guessing which month it belongs to", () => {
    const now = new Date(2026, 9, 22);
    const trend = tenderFrequencyTrend([row({ award_date: null, closing_date: null })], 3, now);
    expect(trend.every((p) => p.count === 0)).toBe(true);
  });

  // Finding 426: `now` straddling the SAST month boundary (real instant
  // 2026-11-30T23:30:00Z = 2026-12-01 01:30 SAST, already December) used to
  // anchor the trailing window on November (the Node process's own naive
  // UTC calendar), not the real SAST December - a control case well inside
  // December (not near any boundary) proves this isn't a blanket "always
  // add a month" fix.
  it("anchors the current month on the real SAST calendar, not the process's naive UTC one", () => {
    const now = new Date("2026-11-30T23:30:00.000Z"); // real SAST: 2026-12-01 01:30
    const trend = tenderFrequencyTrend([], 3, now);
    expect(trend.map((p) => p.month)).toEqual(["2026-10", "2026-11", "2026-12"]);
  });

  it("counts a genuine December award made during the SAST-midnight UTC lag window, not just a non-boundary one", () => {
    const now = new Date("2026-11-30T23:30:00.000Z"); // real SAST: 2026-12-01 01:30
    const rows = [row({ award_date: "2026-12-01" }), row({ award_date: "2026-11-15" })];
    const trend = tenderFrequencyTrend(rows, 3, now);
    expect(trend).toEqual([
      { month: "2026-10", count: 0 },
      { month: "2026-11", count: 1 },
      { month: "2026-12", count: 1 },
    ]);
  });

  it("still reads December correctly well inside the month, away from any boundary (control, not a blanket month-add)", () => {
    const now = new Date("2026-12-15T10:00:00.000Z");
    const trend = tenderFrequencyTrend([row({ award_date: "2026-12-10" })], 3, now);
    expect(trend.map((p) => p.month)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(trend.find((p) => p.month === "2026-12")?.count).toBe(1);
  });
});

describe("byCategory", () => {
  it("counts a tender in every category it carries, not just the first", () => {
    const rows = [row({ categories: ["roads_civil", "professional_services"] }), row({ categories: ["roads_civil"] })];
    const breakdown = byCategory(rows, (slug) => slug.toUpperCase());
    const roads = breakdown.find((b) => b.key === "roads_civil");
    const prof = breakdown.find((b) => b.key === "professional_services");
    expect(roads?.n).toBe(2);
    expect(prof?.n).toBe(1);
    expect(roads?.label).toBe("ROADS_CIVIL");
  });

  it("a tender with no categories at all joins no group", () => {
    const breakdown = byCategory([row({ categories: [] })], (s) => s);
    expect(breakdown).toEqual([]);
  });

  it("sorts groups by sample size, largest first", () => {
    const rows = [
      row({ categories: ["small"] }),
      ...Array.from({ length: 3 }, () => row({ categories: ["big"] })),
    ];
    const breakdown = byCategory(rows, (s) => s);
    expect(breakdown.map((b) => b.key)).toEqual(["big", "small"]);
  });
});

// fetchAllRows's own tests moved to lib/supabasePaging.spec.ts when the
// helper itself moved to its own shared module (lib/supabasePaging.ts) -
// see that file for why (so dashboard/analytics could reuse this exact fix).

/** A minimal, otherwise-"empty" register entry - a bidder with one priced column. */
function bidder(name: string, amount: number, overrides: Partial<Bidder> = {}): Bidder {
  return { name, amounts: [{ column: "Price", amount_zar: amount, amount_raw: String(amount) }], ...overrides };
}

/** A minimal TenderOutcome - a single-column register with the given bidders. */
function outcome(bidders: Bidder[], overrides: Partial<TenderOutcome> = {}): TenderOutcome {
  return {
    id: "id",
    outcome_key: "sanral:1",
    reference: null,
    buyer: null,
    title: null,
    project_type: null,
    procurement_type: null,
    province: null,
    categories: [],
    competitive: true,
    status: "register_published",
    closing_date: null,
    award_date: null,
    winner_name: null,
    winner_amount_zar: null,
    winner_points: null,
    winner_count: bidders.length,
    buyer_key: null,
    winner_key: null,
    is_panel_award: false,
    pricing_excluded: false,
    pricing_exclusion_reasons: [],
    bidders,
    bidders_source: "sanral_register",
    register_columns: 1,
    bidder_count: bidders.length,
    priced_bidder_count: bidders.length,
    low_bid_zar: null,
    median_bid_zar: null,
    high_bid_zar: null,
    winner_rank: null,
    winner_vs_median: null,
    lowest_bid_won: null,
    winner_match_basis: null,
    data_notes: [],
    sources: ["sanral_closed"],
    source_urls: [],
    attribution: null,
    refreshed_at: "2026-10-28T00:00:00Z",
    ...overrides,
  };
}

describe("ownPosition", () => {
  // OUTLIER_FACTOR excludes a bid >5x (or <1/5) the field's median from
  // field.amounts/median/low/high - correct for the aggregate, but when the
  // excluded bid is the COMPANY'S OWN it must not also drop out of "of" (the
  // field size rank is read against): otherwise rank can read past of
  // ("rank 4 of 3"), a contradiction no honest display should ever show.
  it("never reports a rank past the field size when the company's own price is itself an outlier", () => {
    const you = bidder("You Pty Ltd", 700); // 100,105,110 median 107.5; 700 > 107.5*5
    const o = outcome([bidder("A", 100), bidder("B", 110), bidder("C", 105), you]);
    const pos = ownPosition(o, ["You Pty Ltd"], 700);
    expect(pos.found).toBe("name_and_price");
    expect(pos.rank).not.toBeGreaterThan(pos.of);
  });

  it("counts the company's own outlier bid in the field size, not just the other bidders", () => {
    const you = bidder("You Pty Ltd", 10); // 1/10th of the 100/105/110 median - also an outlier
    const o = outcome([bidder("A", 100), bidder("B", 110), bidder("C", 105), you]);
    const pos = ownPosition(o, ["You Pty Ltd"], 10);
    expect(pos.rank).toBe(1);
    expect(pos.of).toBe(4); // 4 real bids on this tender, including yours
  });

  /** A batch-register bidder priced on only SOME of the register's columns -
   * amount_zar is null for every column it didn't bid on, same shape
   * award_outcomes.parse_opening_register() produces (one amounts[] entry per
   * "Amount..." header column, for every row, blank cells included as a null
   * amount_zar rather than a shorter array) - see that function's own
   * zip(header[1:], r[1:]) loop. */
  function amt(v: number | null) {
    return { column: "Amount", amount_zar: v, amount_raw: v !== null ? String(v) : null };
  }

  it("on a batch register, a company found by NAME ONLY (its own recorded price doesn't match any column - the documented VAT-basis-mismatch case) reads the contract-1 column by default even when the bidder's own real priced column is a different one, and reports position/rank against the WRONG contract", () => {
    // Register for a 2-contract batch tender. Contract 1 (column 0): three
    // cheap bids. Contract 2 (column 1): "You" is the cheapest of four real
    // bids, priced far higher than contract 1's bids (different scope).
    const o = outcome(
      [
        { name: "A", amounts: [amt(1000), amt(null)] },
        { name: "B", amounts: [amt(1010), amt(null)] },
        { name: "C", amounts: [amt(1020), amt(null)] },
        { name: "D", amounts: [amt(null), amt(5000)] },
        { name: "E", amounts: [amt(null), amt(5100)] },
        { name: "F", amounts: [amt(null), amt(5200)] },
        { name: "You Pty Ltd", amounts: [amt(null), amt(4000)] }, // only ever bid contract 2, and is its lowest bid
      ],
      { register_columns: 2 },
    );
    // Recorded price is VAT-inclusive (4000 * 1.15); the register amount
    // above is excl. VAT - the exact "found under your name, price differs"
    // case the findings doc's own caveat #2 names, not a contrived input.
    const pos = ownPosition(o, ["You Pty Ltd"], 4600);
    expect(pos.found).toBe("name");
    // The bidder's own amounts array has exactly one priced column (index 1,
    // contract 2) - that is the one unambiguous column this entry could be
    // read on, not contract 1's.
    expect(pos.column).toBe(1);
    expect(pos.price).toBe(4000); // the real, published contract-2 figure for this bidder
    expect(pos.rank).toBe(1); // lowest of contract 2's 4 real bids
    expect(pos.of).toBe(4);
  });
});

describe("byBuyer / byProvince", () => {
  it("groups by the exact buyer name, skipping rows with no buyer recorded", () => {
    const rows = [row({ buyer: "SANRAL" }), row({ buyer: "SANRAL" }), row({ buyer: null })];
    const breakdown = byBuyer(rows);
    expect(breakdown).toEqual([{ key: "SANRAL", label: "SANRAL", n: 2, benchmark: expect.anything() }]);
  });

  it("merges SANRAL's two known raw buyer strings (own-site vs eTenders' organ_of_State) into one group - found 2026-11-02", () => {
    const rows = [
      row({ buyer: "SANRAL" }),
      row({ buyer: "South African National Roads Agency Soc Limited (SANRAL)" }),
      row({ buyer: "The South African National Roads Agency SOC Ltd" }),
    ];
    const breakdown = byBuyer(rows);
    expect(breakdown).toEqual([{ key: "SANRAL", label: "SANRAL", n: 3, benchmark: expect.anything() }]);
  });

  it("does not merge an unrelated buyer whose name happens to share words with SANRAL's", () => {
    const rows = [row({ buyer: "SANRAL" }), row({ buyer: "Passenger Rail Agency of South Africa" })];
    const breakdown = byBuyer(rows);
    expect(breakdown.map((b) => b.key).sort()).toEqual(["Passenger Rail Agency of South Africa", "SANRAL"]);
  });

  it("groups by province the same way, independently of buyer", () => {
    const rows = [row({ province: "Gauteng" }), row({ province: "Gauteng" }), row({ province: "Western Cape" })];
    const breakdown = byProvince(rows);
    expect(breakdown.map((b) => b.key)).toEqual(["Gauteng", "Western Cape"]);
    expect(breakdown[0].n).toBe(2);
  });
});

// Standing solution-architect review, 2026-11-07u: these two Supabase reads
// (the tender_market_outcomes() RPC, then the public_tender_outcomes select)
// were already correctly captured and returned as `error` HERE - but
// app/app/analytics/page.tsx's own call site destructured only
// `{ byTender: outcomesByTender }`, discarding `error` entirely, same bug
// class as savingsCounterData.ts's own fix just above in this review
// (fetchSavingsCounterSummary) and the briefing-attendance section this
// very analytics page already gets right a few lines below its own
// pricing section. A real RPC/table failure made the "Pricing trends & who
// you compete against" section render the ordinary "Not enough published
// outcomes matched yet" empty state - indistinguishable from the genuine
// no-data case - instead of an error. Fixed in page.tsx (captures `error`,
// renders ErrorState when set, same pattern as its own briefingTasksError
// handling three sections above). This test locks in the data contract the
// fix depends on: loadOutcomesForTenders() itself must keep returning a
// real `error` and an EMPTY (not partial) byTender on either read failing,
// not something page.tsx needs to re-derive.
function makeRpcChain(resp: { data: unknown; error: { message: string } | null }) {
  return Promise.resolve(resp);
}
function makeSelectChain(resp: { data: unknown; error: { message: string } | null }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "in"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (r: typeof resp) => void) => resolve(resp);
  return chain;
}
function makeOutcomesSupabase(
  rpcResp: { data: unknown; error: { message: string } | null },
  selectResp: { data: unknown; error: { message: string } | null },
) {
  return {
    rpc: () => makeRpcChain(rpcResp),
    from: () => makeSelectChain(selectResp),
  } as unknown as Parameters<typeof loadOutcomesForTenders>[0];
}

describe("loadOutcomesForTenders", () => {
  it("returns a real error and an empty map (not a false 'nothing published' result) when the RPC fails", async () => {
    const supabase = makeOutcomesSupabase({ data: null, error: { message: "rpc timeout" } }, { data: [], error: null });
    const { byTender, error } = await loadOutcomesForTenders(supabase, ["t1"]);
    expect(error).toBe("rpc timeout");
    expect(byTender.size).toBe(0);
  });

  it("returns a real error and an empty map when the public_tender_outcomes select fails, even though the RPC itself succeeded", async () => {
    const supabase = makeOutcomesSupabase(
      { data: [{ tender_id: "t1", outcome_id: "o1" }], error: null },
      { data: null, error: { message: "connection reset" } },
    );
    const { byTender, error } = await loadOutcomesForTenders(supabase, ["t1"]);
    expect(error).toBe("connection reset");
    expect(byTender.size).toBe(0);
  });

  it("the genuine 'nothing published yet' case still returns error: null with an empty map - not conflated with a failure", async () => {
    const supabase = makeOutcomesSupabase({ data: [], error: null }, { data: [], error: null });
    const { byTender, error } = await loadOutcomesForTenders(supabase, ["t1"]);
    expect(error).toBeNull();
    expect(byTender.size).toBe(0);
  });
});

// loadSegment() itself had zero test coverage before this pass (confirmed by
// grep) even though it is now a second real call site of this exact
// "loadX() must keep returning a real `error`, not swallow it" contract:
// app/app/discovery/page.tsx's own per-card indicative-pricing badge calls it
// directly (not through loadOutcomesForTenders) and - unlike every other
// non-critical Supabase read on that same page - used to drop its error with
// no `console.error` at all, the exact asymmetry this review tracks (see
// page.tsx's own fix comment at that call site). This locks in that
// loadSegment() -> fetchAllRows() genuinely surfaces a real `error` string on
// a query failure rather than collapsing it to an empty, indistinguishable-
// from-"no data" result - the data contract that fix's `console.error`
// branch depends on.
const SEGMENT: Segment = { key: "all", label: "All buyers", sanralOnly: false, buyer: null, categories: ["roads"] };
function makeSegmentSupabase(resp: { data: unknown; error: { message: string } | null }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "overlaps", "like", "ilike"]) chain[m] = () => chain;
  chain.range = () => Promise.resolve(resp);
  return { from: () => chain } as unknown as Parameters<typeof loadSegment>[0];
}

describe("loadSegment", () => {
  it("returns a real error (not a false-empty result) when the public_tender_outcomes query fails", async () => {
    const supabase = makeSegmentSupabase({ data: null, error: { message: "connection reset" } });
    const { rows, error } = await loadSegment(supabase, SEGMENT);
    expect(error).toBe("connection reset");
    expect(rows).toEqual([]);
  });

  it("the genuine 'nothing published yet' case still returns error: null with an empty array", async () => {
    const supabase = makeSegmentSupabase({ data: [], error: null });
    const { rows, error } = await loadSegment(supabase, SEGMENT);
    expect(error).toBeNull();
    expect(rows).toEqual([]);
  });
});

describe("fieldReliable / benchmark's per-field sample gate (Finding 239)", () => {
  it("rejects a field whose own n hasn't cleared MIN_SAMPLE, independent of any other count", () => {
    expect(fieldReliable(MIN_SAMPLE - 1)).toBe(false);
    expect(fieldReliable(MIN_SAMPLE)).toBe(true);
    expect(fieldReliable(1, MIN_SAMPLE)).toBe(false);
  });

  it("benchmark()'s own sibling fields can each be far thinner than the headline n that gates whether anything is shown at all - exactly the shape market-intelligence/page.tsx and analytics/page.tsx missed (market-context.tsx's MetricRow+sampleStrength() already got this right)", () => {
    // 5 rows clears the headline MIN_SAMPLE - but only ONE has a priced,
    // single-winner contract (feeding contractSize), and none carry a
    // priced_bidder_count/lowest_bid_won/winner_vs_median value at all.
    const rows: MarketRow[] = [
      row({ id: "1", winner_count: 1, winner_amount_zar: 1_000_000, winner_name: "A" }),
      row({ id: "2", winner_count: 3 }),
      row({ id: "3", winner_count: 3 }),
      row({ id: "4", winner_count: 3 }),
      row({ id: "5", winner_count: 3 }),
    ];
    const b = benchmark(rows);
    expect(b.n).toBeGreaterThanOrEqual(MIN_SAMPLE); // headline gate alone would pass
    expect(fieldReliable(b.contractSize.n)).toBe(false); // but this one field must not be shown
    expect(fieldReliable(b.bidders.n)).toBe(false);
    expect(fieldReliable(b.lowestWon.n)).toBe(false);
    expect(fieldReliable(b.winnerVsMedian.n)).toBe(false);
  });
});
