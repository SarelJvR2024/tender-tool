import { describe, expect, it } from "vitest";
import { briefingReminderCandidates, briefingThresholdFor, BRIEFING_REMINDER_EXCLUDED_STAGES, type BriefingReminderTenderRow } from "./briefingReminders";

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
    tender_packs: [{ company_id: "company-a", pipeline_stage: "assessing" }, { company_id: "company-b", pipeline_stage: "building" }],
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

  // Finding (standing solution-architect review): a company already past
  // this milestone - submitted, briefing_shortlisted, won or lost - should
  // not get a "briefing in 5 days/24 hours" nag, the same
  // excluded/closed-stage rule lib/deadlineReminders.ts
  // (DEADLINE_REMINDER_EXCLUDED_STAGES), lib/clarificationWindowReminders.ts
  // (isClarificationCandidate) and lib/printCutoffReminders.ts
  // (CLOSED_STAGES) each already apply. Pre-fix, this file had no
  // pipeline_stage field on BriefingReminderTenderRow['tender_packs'] at
  // all, so every one of these stages still produced a candidate.
  it("excludes a company whose pack is already submitted/briefing_shortlisted/won/lost, same as the sibling reminders", () => {
    for (const stage of BRIEFING_REMINDER_EXCLUDED_STAGES) {
      const t: BriefingReminderTenderRow = {
        ...tender,
        id: `tender-${stage}`,
        tender_packs: [{ company_id: "company-closed", pipeline_stage: stage }, { company_id: "company-open", pipeline_stage: "assessing" }],
      };
      const candidates = briefingReminderCandidates([t], daysUntilFn);
      expect(candidates.map((c) => c.companyId)).toEqual(["company-open"]);
    }
  });

  it("still fires for every stage NOT in the excluded list", () => {
    for (const stage of ["found", "assessing", "building"] as const) {
      const t: BriefingReminderTenderRow = { ...tender, id: `tender-${stage}`, tender_packs: [{ company_id: "company-a", pipeline_stage: stage }] };
      expect(briefingReminderCandidates([t], daysUntilFn).map((c) => c.companyId)).toEqual(["company-a"]);
    }
  });
});
