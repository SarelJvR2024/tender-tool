import { describe, expect, it } from "vitest";
import { tenderTimeline } from "./tenderTimeline";

function daysFromNow(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
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
