import { describe, expect, it } from "vitest";
import { clarificationThresholdFor, clarificationWindowCandidates, isClarificationCandidate, type ClarificationTaskRow } from "./clarificationWindowReminders";

const BASE: ClarificationTaskRow = {
  id: "t1", company_id: "co1", tender_id: "ten1", description: "Submit clarification questions", due_date: null, status: "not_started", kind: "clarification",
};

function daysUntilFn(map: Record<string, number | null>) {
  return (dateStr: string | null) => (dateStr ? map[dateStr] ?? null : null);
}

const NOT_SUBMITTED = () => "found";

describe("clarificationThresholdFor", () => {
  it("matches exactly 10 and 2 days (the nominal thresholds)", () => {
    expect(clarificationThresholdFor(10)).toBe(10);
    expect(clarificationThresholdFor(2)).toBe(2);
  });

  // Finding 401: widened from an exact match to a range, same self-healing
  // shape as trialDay7Candidates() (Finding 387) - a missed/late daily cron
  // run can still catch up on a later day instead of permanently losing the
  // reminder for that threshold.
  it("still matches the 10-day threshold on a catch-up day between the two windows", () => {
    expect(clarificationThresholdFor(9)).toBe(10);
    expect(clarificationThresholdFor(5)).toBe(10);
    expect(clarificationThresholdFor(3)).toBe(10);
  });

  it("still matches the 2-day threshold on a catch-up day below it", () => {
    expect(clarificationThresholdFor(1)).toBe(2);
  });

  it("does not match above the 10-day window, at the 2-day floor, or below it", () => {
    expect(clarificationThresholdFor(11)).toBeNull();
    expect(clarificationThresholdFor(0)).toBeNull();
    expect(clarificationThresholdFor(-1)).toBeNull();
  });
});

describe("isClarificationCandidate - submission-suppression", () => {
  it("excludes submitted, won and lost", () => {
    expect(isClarificationCandidate("submitted")).toBe(false);
    expect(isClarificationCandidate("won")).toBe(false);
    expect(isClarificationCandidate("lost")).toBe(false);
  });

  it("keeps found, bidding, null and undefined (no tender_packs row at all)", () => {
    expect(isClarificationCandidate("found")).toBe(true);
    expect(isClarificationCandidate("bidding")).toBe(true);
    expect(isClarificationCandidate(null)).toBe(true);
    expect(isClarificationCandidate(undefined)).toBe(true);
  });
});

describe("clarificationWindowCandidates", () => {
  it("fires for a not_started clarification task exactly 10 days out", () => {
    const task = { ...BASE, due_date: "2026-12-01" };
    const result = clarificationWindowCandidates([task], daysUntilFn({ "2026-12-01": 10 }), NOT_SUBMITTED);
    expect(result).toEqual([{ task, daysLeft: 10, threshold: 10 }]);
  });

  it("fires for an in_progress task too - not done is the only status gate", () => {
    const task = { ...BASE, due_date: "2026-12-01", status: "in_progress" as const };
    const result = clarificationWindowCandidates([task], daysUntilFn({ "2026-12-01": 2 }), NOT_SUBMITTED);
    expect(result).toHaveLength(1);
  });

  it("does not fire for a done task", () => {
    const task = { ...BASE, due_date: "2026-12-01", status: "done" as const };
    const result = clarificationWindowCandidates([task], daysUntilFn({ "2026-12-01": 10 }), NOT_SUBMITTED);
    expect(result).toHaveLength(0);
  });

  it("does not fire for a non-clarification task kind", () => {
    const task = { ...BASE, due_date: "2026-12-01", kind: "briefing" };
    const result = clarificationWindowCandidates([task], daysUntilFn({ "2026-12-01": 10 }), NOT_SUBMITTED);
    expect(result).toHaveLength(0);
  });

  it("does not fire outside either threshold's window", () => {
    const task = { ...BASE, due_date: "2026-12-01" };
    const result = clarificationWindowCandidates([task], daysUntilFn({ "2026-12-01": 11 }), NOT_SUBMITTED);
    expect(result).toHaveLength(0);
  });

  it("fires for the 10-day threshold on a catch-up day, same as a missed cron run self-healing on the next one", () => {
    const task = { ...BASE, due_date: "2026-12-01" };
    const result = clarificationWindowCandidates([task], daysUntilFn({ "2026-12-01": 5 }), NOT_SUBMITTED);
    expect(result).toEqual([{ task, daysLeft: 5, threshold: 10 }]);
  });

  it("does not fire for a null due_date", () => {
    const result = clarificationWindowCandidates([BASE], daysUntilFn({}), NOT_SUBMITTED);
    expect(result).toHaveLength(0);
  });

  it("does not fire once the bid has been submitted, even if the due date would otherwise match", () => {
    const task = { ...BASE, due_date: "2026-12-01" };
    const result = clarificationWindowCandidates([task], daysUntilFn({ "2026-12-01": 10 }), () => "submitted");
    expect(result).toHaveLength(0);
  });

  it("still fires when there is no tender_packs row at all for this (company, tender)", () => {
    const task = { ...BASE, due_date: "2026-12-01" };
    const result = clarificationWindowCandidates([task], daysUntilFn({ "2026-12-01": 10 }), () => null);
    expect(result).toHaveLength(1);
  });
});
