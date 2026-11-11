import { describe, expect, it } from "vitest";
import { deadlineReminderCandidates, reminderThresholdFor, DEADLINE_REMINDER_EXCLUDED_STAGES, type DeadlineReminderTenderRow } from "./deadlineReminders";

describe("reminderThresholdFor", () => {
  it("matches 3 days and 1 day (24 hours) exactly", () => {
    expect(reminderThresholdFor(3)).toBe(3);
    expect(reminderThresholdFor(1)).toBe(1);
  });

  // QA Finding 403, 2026-11-11: pre-fix, this matched ONLY 3 or ONLY 1 -
  // daysLeft===2 (between the two thresholds) got nothing, so a cron run
  // (scripts/send-deadline-reminders.ts) missed or delayed on exactly the
  // day a tender's countdown hit 3 permanently lost that tender/company's
  // "closing in 3 days" warning: the very next day's daysLeft (2) matched no
  // threshold at all, and every day after that only moves further away.
  // Same shape/fix as lib/trialLifecycle.ts's trialDay7Candidates()
  // (Finding 387) and lib/clarificationWindowReminders.ts's
  // clarificationThresholdFor() (Finding 401) - safe to widen with no
  // change to send frequency, since record_deadline_reminder_sent()'s own
  // dedupe key (migration 0080) has no day/date component.
  it("catches up a missed/late run: daysLeft=2 (between the thresholds) now resolves to the 3-day threshold, not nothing", () => {
    expect(reminderThresholdFor(2)).toBe(3);
  });

  it("still does not fire outside the two windows", () => {
    expect(reminderThresholdFor(0)).toBeNull(); // closing today/overdue - out of scope, same as pre-fix
    expect(reminderThresholdFor(14)).toBeNull();
    expect(reminderThresholdFor(4)).toBeNull(); // just above the 3-day window's own floor-less upper bound
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

  // QA Finding 403: a missed/late cron run on the exact day daysLeft hit 3
  // used to permanently lose that candidate - daysLeft=2 the next day
  // matched neither threshold. Now it still produces a (threshold 3)
  // candidate, catching the run up instead of silently dropping it forever.
  it("catches up a missed run at the candidate level: daysLeft=2 still yields a threshold-3 candidate", () => {
    const candidates = deadlineReminderCandidates([tender], () => 2);
    expect(candidates.map((c) => c.companyId).sort()).toEqual(["company-a", "company-b"]);
    expect(candidates.every((c) => c.daysLeft === 2 && c.threshold === 3)).toBe(true);
  });
});
