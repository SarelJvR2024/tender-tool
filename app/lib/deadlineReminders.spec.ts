import { describe, expect, it } from "vitest";
import { reminderThresholdFor } from "./deadlineReminders";

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
