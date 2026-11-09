import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tenderTimeline } from "./tenderTimeline";

// Frozen, unambiguous instant - safely mid-day in both UTC and SAST (SAST =
// UTC+2), nowhere near either timezone's own midnight - not the ambient wall
// clock. Previously daysFromNow() below built its "N days from today"
// fixture off the real host clock's own local (effectively UTC, no TZ env
// set) calendar day, while tenderTimeline()'s underlying daysUntil() call
// computes "today" as the real SAST calendar day; those two disagree by
// exactly one day during the real 00:00-02:00 SAST window, making these
// tests genuinely flaky at that hour regardless of any code change. Freezing
// the clock (both the fixture dates below AND the function-under-test's own
// ambient `new Date()` call, via the beforeEach/afterEach pair) to one
// instant where UTC-today and SAST-today are the same calendar day makes the
// day-count unambiguous at any real wall-clock time.
const FROZEN_NOW = new Date("2026-06-15T10:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function daysFromNow(days: number): string {
  const d = new Date(FROZEN_NOW);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

describe("tenderTimeline", () => {
  it("a compulsory briefing far out and a closing date far out are both 'far'", () => {
    const result = tenderTimeline({
      closingDate: daysFromNow(30),
      briefingDate: daysFromNow(20),
      briefingCompulsory: true,
    });
    expect(result).toHaveLength(2);
    expect(result.find((m) => m.key === "briefing")?.urgency).toBe("far");
    expect(result.find((m) => m.key === "closing")?.urgency).toBe("far");
  });

  it("a non-compulsory briefing is never surfaced, even if it's close", () => {
    const result = tenderTimeline({
      closingDate: daysFromNow(30),
      briefingDate: daysFromNow(1),
      briefingCompulsory: false,
    });
    expect(result.find((m) => m.key === "briefing")).toBeUndefined();
    expect(result).toHaveLength(1);
  });

  it("no briefing date at all - only the closing milestone appears, no crash", () => {
    const result = tenderTimeline({ closingDate: daysFromNow(10), briefingDate: null, briefingCompulsory: true });
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("closing");
  });

  it("neither date on file - an empty list, not an error", () => {
    expect(tenderTimeline({ closingDate: null, briefingDate: null, briefingCompulsory: true })).toEqual([]);
  });

  it("a closing date already past reads 'past', not a false 'urgent'", () => {
    const result = tenderTimeline({ closingDate: daysFromNow(-3), briefingDate: null, briefingCompulsory: null });
    expect(result[0].urgency).toBe("past");
    expect(result[0].daysLeft).toBe(-3);
  });

  it("urgency bands match DeadlineChip's own thresholds at the boundaries", () => {
    const at = (days: number) =>
      tenderTimeline({ closingDate: daysFromNow(days), briefingDate: null, briefingCompulsory: null })[0].urgency;
    expect(at(0)).toBe("urgent");
    expect(at(6)).toBe("urgent");
    expect(at(7)).toBe("soon");
    expect(at(14)).toBe("soon");
    expect(at(15)).toBe("far");
  });
});
