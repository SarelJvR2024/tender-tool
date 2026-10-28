import { describe, expect, it } from "vitest";
import { byBuyer, byCategory, byProvince, ownPosition, tenderFrequencyTrend, type Bidder, type MarketRow, type TenderOutcome } from "./marketPricing";

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
    bidders,
    bidders_source: "sanral_register",
    register_columns: 1,
    bidder_count: bidders.length,
    priced_bidder_count: bidders.length,
    median_bid_zar: null,
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
});

describe("byBuyer / byProvince", () => {
  it("groups by the exact buyer name, skipping rows with no buyer recorded", () => {
    const rows = [row({ buyer: "SANRAL" }), row({ buyer: "SANRAL" }), row({ buyer: null })];
    const breakdown = byBuyer(rows);
    expect(breakdown).toEqual([{ key: "SANRAL", label: "SANRAL", n: 2, benchmark: expect.anything() }]);
  });

  it("groups by province the same way, independently of buyer", () => {
    const rows = [row({ province: "Gauteng" }), row({ province: "Gauteng" }), row({ province: "Western Cape" })];
    const breakdown = byProvince(rows);
    expect(breakdown.map((b) => b.key)).toEqual(["Gauteng", "Western Cape"]);
    expect(breakdown[0].n).toBe(2);
  });
});
