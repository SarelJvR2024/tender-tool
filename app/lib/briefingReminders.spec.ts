import { describe, expect, it } from "vitest";
import { briefingReminderCandidates, briefingThresholdFor, BRIEFING_REMINDER_EXCLUDED_STAGES, type BriefingReminderTenderRow } from "./briefingReminders";

describe("briefingThresholdFor", () => {
  it("matches the full 5-day window down to just above 1 day", () => {
    expect(briefingThresholdFor(5)).toBe(5);
    expect(briefingThresholdFor(4)).toBe(5);
    expect(briefingThresholdFor(3)).toBe(5);
    expect(briefingThresholdFor(2)).toBe(5);
  });

  it("matches the 1-day (24 hour) window", () => {
    expect(briefingThresholdFor(1)).toBe(1);
  });

  it("stays out of scope above the 5-day window, at/below the briefing itself, and for a stale negative value", () => {
    expect(briefingThresholdFor(14)).toBeNull();
    expect(briefingThresholdFor(6)).toBeNull();
    expect(briefingThresholdFor(0)).toBeNull();
    expect(briefingThresholdFor(-1)).toBeNull();
  });

  // QA Finding 404 (2026-11-11): pre-fix, this was a bare
  // `[5, 1].includes(daysLeft)` exact match - a GitHub Actions cron run
  // that skipped or ran late on the one calendar day daysLeft was exactly
  // 5 (e.g. caught up a day late, at daysLeft=4) lost that tender/
  // company's briefing-session warning for good, since no later day's
  // daysLeft could ever match either threshold again. The dedupe key
  // (`record_operational_alert_sent()`, migration 0092) is
  // `alert_type, tender_id, company_id, threshold_key` where threshold_key
  // is the THRESHOLD ("5"/"1"), not daysLeft, so widening this window to a
  // catch-up range changes nothing about send frequency - still exactly
  // one email per (tender, company, threshold) ever.
  it("catches up a missed cron run - a day-late send at daysLeft=4 still resolves to the 5-day threshold, not nothing", () => {
    expect(briefingThresholdFor(4)).toBe(5);
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
    expect(briefingReminderCandidates([tender], () => 14)).toEqual([]);
  });

  it("a day inside the 5-day catch-up window still yields a candidate at threshold 5 (QA Finding 404)", () => {
    const candidates = briefingReminderCandidates([tender], () => 3);
    expect(candidates.every((c) => c.daysLeft === 3 && c.threshold === 5)).toBe(true);
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
