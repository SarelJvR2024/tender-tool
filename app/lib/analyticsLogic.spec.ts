import { describe, expect, it } from "vitest";
import { buildWinLossTrend, monthKey, monthLabel } from "./analyticsLogic";

describe("monthKey", () => {
  it("extracts the YYYY-MM prefix of an ISO timestamp", () => {
    expect(monthKey("2026-10-22T14:00:00Z")).toBe("2026-10");
  });

  it("converts to SAST before reading the calendar month, not a naive UTC slice (Finding 413)", () => {
    // 2026-11-30T23:30:00Z is 2026-12-01 01:30 in SAST (UTC+2) - already
    // December in the only calendar that matters to a South African user,
    // even though the raw stored string's own first 7 characters still read
    // "2026-11".
    expect(monthKey("2026-11-30T23:30:00Z")).toBe("2026-12");
    // Not a blanket "always add a month" fix: the same clock time one day
    // earlier (2026-11-29T23:30:00Z = 2026-11-30 01:30 SAST) is still
    // genuinely November on both sides.
    expect(monthKey("2026-11-29T23:30:00Z")).toBe("2026-11");
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

  it("buckets a decision made just after SAST midnight into the real SAST month, not its raw UTC month (Finding 413)", () => {
    // "now" is comfortably 2026-12-01 in both UTC and SAST, so the window
    // itself is anchored correctly either way - this isolates the other
    // half of the bug: a stored decidedAt whose UTC string still reads
    // November despite being December 01:30 SAST used to fall outside every
    // bucket (silently dropped), not just the wrong one.
    const now = new Date("2026-12-01T10:00:00Z");
    const entries = [{ stage: "won" as const, decidedAt: "2026-11-30T23:30:00Z" }];
    const trend = buildWinLossTrend(entries, 1, now);
    expect(trend).toEqual([{ month: "2026-12", won: 1, lost: 0 }]);
  });

  it("anchors the window's own current month on SAST 'now', not the host process's UTC calendar month (Finding 413)", () => {
    // The real current instant, 2026-11-30T23:30:00Z, is already
    // 2026-12-01 in SAST - the most recent bucket must be December.
    const now = new Date("2026-11-30T23:30:00Z");
    const trend = buildWinLossTrend([], 2, now);
    expect(trend.map((p) => p.month)).toEqual(["2026-11", "2026-12"]);
  });
});

describe("monthLabel", () => {
  it("formats a YYYY-MM key as a short month + 2-digit year", () => {
    expect(monthLabel("2026-10")).toBe("Oct 26");
  });
});
