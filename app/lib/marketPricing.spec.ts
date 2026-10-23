import { describe, expect, it, vi } from "vitest";
import { byBuyer, byCategory, byProvince, fetchAllRows, tenderFrequencyTrend, type MarketRow } from "./marketPricing";

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

describe("fetchAllRows", () => {
  // Found live, 2026-10-23: this project's PostgREST caps every response at
  // 1000 rows (db-max-rows) no matter what .limit() a client requests - a
  // direct check against the real table confirmed .limit(5000) still only
  // ever returned rows 0-999 of 39,536. loadMarketOutcomes()/loadSegment()
  // used to trust a bare .limit() and silently read a ~2.5% sample as if it
  // were the whole table. These tests simulate that exact server behavior
  // (a page() stub that never returns more than 1000 rows, however wide a
  // range is requested) rather than asserting against the real network.
  const PAGE_CAP = 1000;
  function serverThatCapsAt(totalRows: number) {
    return vi.fn(async (from: number, to: number) => {
      const wanted = Array.from({ length: Math.min(to - from + 1, totalRows - from) }, (_, i) => from + i).filter((i) => i < totalRows);
      const capped = wanted.slice(0, PAGE_CAP);
      return { data: capped, error: null };
    });
  }

  it("keeps paging past a single 1000-row server cap until the real data runs out", async () => {
    const page = serverThatCapsAt(2500);
    const { rows, error } = await fetchAllRows<number>(page, 10_000);
    expect(error).toBeNull();
    expect(rows).toHaveLength(2500);
    expect(rows[0]).toBe(0);
    expect(rows[2499]).toBe(2499);
  });

  it("never requests more than maxRows even if the server has more", async () => {
    const page = serverThatCapsAt(10_000);
    const { rows } = await fetchAllRows<number>(page, 2500);
    expect(rows).toHaveLength(2500);
  });

  it("stops after one page when the real table is smaller than the page size", async () => {
    const page = serverThatCapsAt(42);
    const { rows } = await fetchAllRows<number>(page, 10_000);
    expect(rows).toHaveLength(42);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("surfaces an error from any page and keeps whatever was already fetched", async () => {
    const page = vi
      .fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => i), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "connection reset" } });
    const { rows, error } = await fetchAllRows<number>(page, 10_000);
    expect(error).toBe("connection reset");
    expect(rows).toHaveLength(1000);
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
