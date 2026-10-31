import { describe, expect, it } from "vitest";
import { deadlineReminderCandidates, reminderThresholdFor, DEADLINE_REMINDER_EXCLUDED_STAGES, type DeadlineReminderTenderRow } from "./deadlineReminders";

describe("reminderThresholdFor", () => {
  it("matches exactly 3 days and 1 day (24 hours), nothing else", () => {
    expect(reminderThresholdFor(3)).toBe(3);
    expect(reminderThresholdFor(1)).toBe(1);
    expect(reminderThresholdFor(2)).toBeNull();
    expect(reminderThresholdFor(0)).toBeNull();
    expect(reminderThresholdFor(14)).toBeNull();
    expect(reminderThresholdFor(-1)).toBeNull();
  });
});

describe("deadlineReminderCandidates", () => {
  // QA Finding, 2026-10-22: scripts/send-deadline-reminders.ts used to read
  // only tender.tender_packs[0].company_id - a shared/public tender tracked
  // by more than one company (ordinary, not contrived: tender_packs is
  // unique(company_id, tender_id), not unique(tender_id)) silently lost
  // every reminder except the first company's.
  const tender: DeadlineReminderTenderRow = {
    id: "tender-1",
    contract_no: "SANRAL/1234",
    description: null,
    closing_date: "2026-11-01",
    tender_packs: [
      { company_id: "company-a", pipeline_stage: "assessing" },
      { company_id: "company-b", pipeline_stage: "building" },
    ],
  };
  const daysUntilFn = () => 3; // inside the 3-day threshold for every call below

  it("produces one candidate per company tracking the SAME tender, not just the first", () => {
    const candidates = deadlineReminderCandidates([tender], daysUntilFn);
    expect(candidates.map((c) => c.companyId).sort()).toEqual(["company-a", "company-b"]);
    expect(candidates.every((c) => c.tender.id === "tender-1" && c.daysLeft === 3 && c.threshold === 3)).toBe(true);
  });

  it("a tender with no tracking company at all yields no candidates (not a crash)", () => {
    const untracked: DeadlineReminderTenderRow = { ...tender, id: "tender-2", tender_packs: [] };
    expect(deadlineReminderCandidates([untracked], daysUntilFn)).toEqual([]);
  });

  it("outside the window or off-threshold still yields nothing, for every tracking company", () => {
    expect(deadlineReminderCandidates([tender], () => 14)).toEqual([]); // inside DEADLINE_WINDOW_DAYS, not a threshold day
    expect(deadlineReminderCandidates([tender], () => null)).toEqual([]); // no closing date on file
  });

  // Sarel, 2026-10-30: a submitted (or later) bid's own closing deadline has
  // already been met - reminding about it again is pointless, not helpful.
  it("submission-suppression: excludes submitted/briefing_shortlisted/won/lost for that one company, keeps a still-active co-pursuer", () => {
    expect(DEADLINE_REMINDER_EXCLUDED_STAGES).toEqual(["submitted", "briefing_shortlisted", "won", "lost"]);
    for (const stage of DEADLINE_REMINDER_EXCLUDED_STAGES) {
      const mixed: DeadlineReminderTenderRow = {
        ...tender,
        id: `tender-${stage}`,
        tender_packs: [{ company_id: "company-a", pipeline_stage: stage }, { company_id: "company-b", pipeline_stage: "assessing" }],
      };
      const candidates = deadlineReminderCandidates([mixed], daysUntilFn);
      expect(candidates.map((c) => c.companyId)).toEqual(["company-b"]);
    }
  });

  it("keeps found/assessing/building - still-active stages, not suppressed", () => {
    for (const stage of ["found", "assessing", "building"]) {
      const active: DeadlineReminderTenderRow = { ...tender, id: `tender-${stage}`, tender_packs: [{ company_id: "company-a", pipeline_stage: stage }] };
      expect(deadlineReminderCandidates([active], daysUntilFn)).toHaveLength(1);
    }
  });
});
