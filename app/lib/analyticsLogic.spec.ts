import { describe, expect, it } from "vitest";
import { buildWinLossTrend, monthKey, monthLabel } from "./analyticsLogic";

describe("monthKey", () => {
  it("extracts the YYYY-MM prefix of an ISO timestamp", () => {
    expect(monthKey("2026-10-22T14:00:00Z")).toBe("2026-10");
  });
});

describe("buildWinLossTrend", () => {
  it("includes every month in the window, even ones with zero decisions", () => {
    const now = new Date(2026, 9, 22); // Oct 2026, 0-indexed month
    const trend = buildWinLossTrend([], 3, now);
    expect(trend.map((p) => p.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(trend.every((p) => p.won === 0 && p.lost === 0)).toBe(true);
  });

  it("buckets entries into the correct month", () => {
    const now = new Date(2026, 9, 22);
    const entries = [
      { stage: "won" as const, decidedAt: "2026-09-05T00:00:00Z" },
      { stage: "lost" as const, decidedAt: "2026-09-18T00:00:00Z" },
      { stage: "won" as const, decidedAt: "2026-10-01T00:00:00Z" },
    ];
    const trend = buildWinLossTrend(entries, 3, now);
    expect(trend).toEqual([
      { month: "2026-08", won: 0, lost: 0 },
      { month: "2026-09", won: 1, lost: 1 },
      { month: "2026-10", won: 1, lost: 0 },
    ]);
  });

  it("ignores entries outside the window rather than throwing or wrapping them in", () => {
    const now = new Date(2026, 9, 22);
    const entries = [{ stage: "won" as const, decidedAt: "2025-01-01T00:00:00Z" }];
    const trend = buildWinLossTrend(entries, 3, now);
    expect(trend.every((p) => p.won === 0)).toBe(true);
  });

  it("handles a single-month window", () => {
    const now = new Date(2026, 9, 22);
    const trend = buildWinLossTrend([{ stage: "won", decidedAt: "2026-10-10T00:00:00Z" }], 1, now);
    expect(trend).toEqual([{ month: "2026-10", won: 1, lost: 0 }]);
  });
});

describe("monthLabel", () => {
  it("formats a YYYY-MM key as a short month + 2-digit year", () => {
    expect(monthLabel("2026-10")).toBe("Oct 26");
  });
});
