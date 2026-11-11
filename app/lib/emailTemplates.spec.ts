// Regression test for QA Finding 403 (2026-11-11): widening
// lib/deadlineReminders.ts's reminderThresholdFor() from an exact
// calendar-day match to a bounded range (so a missed/late cron run can
// catch up) means a "3-day threshold" send can now genuinely happen with
// daysLeft=2, not only exactly 3. deadlineReminderEmail()'s own subject
// line used to be hardcoded to "Closing in 3 days"/"Closing in 24 hours"
// purely off an urgent/not-urgent split, independent of the real daysLeft -
// so a catch-up send for daysLeft=2 would have shipped a subject claiming
// 3 days left when only 2 genuinely remained, overstating how much time is
// actually left. Fixed to read the real daysLeft, same as the body text
// already did.
import { describe, expect, it } from "vitest";
import { deadlineReminderEmail } from "./emailTemplates.ts";

const base = { contractLabel: "SANRAL/1234", closingDate: "2026-11-20", appUrl: "https://app.example", tenderId: "tender-1" };

describe("deadlineReminderEmail subject", () => {
  it("exact 3-day threshold: subject says 3 days", () => {
    const email = deadlineReminderEmail({ ...base, daysLeft: 3 });
    expect(email.subject).toBe("Closing in 3 days: SANRAL/1234");
  });

  // The real, previously-impossible case this fix is for: a missed-run
  // catch-up send for the 3-day threshold firing a day late, with daysLeft
  // already down to 2.
  it("catch-up send one day late (daysLeft=2, still the 3-day threshold): subject says 2 days, not 3", () => {
    const email = deadlineReminderEmail({ ...base, daysLeft: 2 });
    expect(email.subject).toBe("Closing in 2 days: SANRAL/1234");
    expect(email.subject).not.toContain("3 days");
  });

  it("exact 1-day threshold (24 hours): subject says 24 hours, not a day count", () => {
    const email = deadlineReminderEmail({ ...base, daysLeft: 1 });
    expect(email.subject).toBe("Closing in 24 hours: SANRAL/1234");
  });

  it("closing today or overdue: subject says so plainly", () => {
    expect(deadlineReminderEmail({ ...base, daysLeft: 0 }).subject).toBe("Closing today: SANRAL/1234");
    expect(deadlineReminderEmail({ ...base, daysLeft: -1 }).subject).toBe("Closing today: SANRAL/1234");
  });

  it("body text (whenText) was already dynamic and is unaffected by this fix", () => {
    const email = deadlineReminderEmail({ ...base, daysLeft: 2 });
    expect(email.text).toContain("closes in 2 days");
  });
});
