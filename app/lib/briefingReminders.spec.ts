import { describe, expect, it } from "vitest";
import { briefingReminderCandidates, briefingThresholdFor, type BriefingReminderTenderRow } from "./briefingReminders";

describe("briefingThresholdFor", () => {
  it("matches exactly 5 days and 1 day (24 hours), nothing else", () => {
    expect(briefingThresholdFor(5)).toBe(5);
    expect(briefingThresholdFor(1)).toBe(1);
    expect(briefingThresholdFor(4)).toBeNull();
    expect(briefingThresholdFor(0)).toBeNull();
    expect(briefingThresholdFor(14)).toBeNull();
    expect(briefingThresholdFor(-1)).toBeNull();
  });
});

describe("briefingReminderCandidates", () => {
  const tender: BriefingReminderTenderRow = {
    id: "tender-1",
    contract_no: "SANRAL/1234",
    description: null,
    briefing_date: "2026-11-05",
    briefing_time: "10:00",
    tender_packs: [{ company_id: "company-a" }, { company_id: "company-b" }],
  };
  const daysUntilFn = () => 5;

  it("one candidate per company tracking the same tender, same as the closing-date reminder's own fix", () => {
    const candidates = briefingReminderCandidates([tender], daysUntilFn);
    expect(candidates.map((c) => c.companyId).sort()).toEqual(["company-a", "company-b"]);
    expect(candidates.every((c) => c.daysLeft === 5 && c.threshold === 5)).toBe(true);
  });

  it("no briefing date on file -> no candidates", () => {
    expect(briefingReminderCandidates([{ ...tender, briefing_date: null }], () => null)).toEqual([]);
  });

  it("off-threshold day counts yield nothing", () => {
    expect(briefingReminderCandidates([tender], () => 3)).toEqual([]);
  });

  it("a tender with no tracking company yields no candidates", () => {
    expect(briefingReminderCandidates([{ ...tender, tender_packs: [] }], daysUntilFn)).toEqual([]);
  });
});
