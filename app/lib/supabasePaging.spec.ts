import { describe, expect, it, vi } from "vitest";
import { fetchAllRows } from "./supabasePaging";

// Found live, 2026-10-23 (PR #111): this project's PostgREST caps every
// response at 1000 rows (db-max-rows) no matter what .limit() a client
// requests - a direct check against the real table confirmed .limit(5000)
// still only ever returned rows 0-999 of 39,536. Moved here from
// marketPricing.spec.ts when fetchAllRows itself moved to its own shared
// module (lib/supabasePaging.ts), so every other heavy read (dashboard,
// analytics) can reuse the same fix instead of re-discovering it. These
// tests simulate that exact server behavior (a page() stub that never
// returns more than 1000 rows, however wide a range is requested) rather
// than asserting against the real network.
const PAGE_CAP = 1000;
function serverThatCapsAt(totalRows: number) {
  return vi.fn(async (from: number, to: number) => {
    const wanted = Array.from({ length: Math.min(to - from + 1, totalRows - from) }, (_, i) => from + i).filter((i) => i < totalRows);
    const capped = wanted.slice(0, PAGE_CAP);
    return { data: capped, error: null };
  });
}

describe("fetchAllRows", () => {
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

  it("would silently cap at 1000 rows without pagination - the exact bug this fixes", async () => {
    // Regression guard for the PR #111 pattern applied to dashboard/analytics'
    // own "tenders" reads: a naive single .range(0, maxRows-1) call (what the
    // old un-paginated code effectively did) returns only PAGE_CAP rows from
    // a bigger table; fetchAllRows must return the real total instead.
    const page = serverThatCapsAt(1800);
    const naiveSingleRequest = await page(0, 9999);
    expect(naiveSingleRequest.data).toHaveLength(1000); // the bug: silently truncated
    const { rows } = await fetchAllRows<number>(page, 10_000);
    expect(rows).toHaveLength(1800); // the fix: the real count
  });
});
