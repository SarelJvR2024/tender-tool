import { describe, expect, it } from "vitest";
import { isSameSastMonth, packHealthStatusFromReadiness, primaryActionLabel } from "./pipelineCardHelpers";

describe("packHealthStatusFromReadiness", () => {
  it("a mandatory unconfirmed item (fixCount > 0) is always blocked, even at a high score", () => {
    expect(packHealthStatusFromReadiness(90, 1)).toBe("blocked");
  });

  it("100% with zero mandatory gaps is ready", () => {
    expect(packHealthStatusFromReadiness(100, 0)).toBe("ready");
  });

  it("anything below 100% with zero mandatory gaps is in_progress", () => {
    expect(packHealthStatusFromReadiness(78, 0)).toBe("in_progress");
    expect(packHealthStatusFromReadiness(0, 0)).toBe("in_progress");
  });
});

describe("primaryActionLabel", () => {
  it("submitted/won/lost always read 'View bid pack', regardless of pack health", () => {
    expect(primaryActionLabel("submitted", null)).toBe("View bid pack →");
    expect(primaryActionLabel("won", { status: "blocked", score: 50, confirmedCount: 1, totalCount: 2, fixCount: 1 })).toBe("View bid pack →");
    expect(primaryActionLabel("lost", null)).toBe("View bid pack →");
  });

  it("briefing_shortlisted also reads 'View bid pack' - it's already submitted, same as submitted/won/lost (found 2026-11-02: packHealth is always null here, so this used to fall through to 'Continue workspace')", () => {
    expect(primaryActionLabel("briefing_shortlisted", null)).toBe("View bid pack →");
  });

  it("a blocked pre-submission tender shows the real mandatory-item count, not a generic label", () => {
    expect(primaryActionLabel("building", { status: "blocked", score: 60, confirmedCount: 3, totalCount: 5, fixCount: 2 })).toBe("Fix returnables (2) →");
  });

  it("a tender with no workspace started yet reads 'Start workspace'", () => {
    expect(primaryActionLabel("found", { status: "not_started", score: 0, confirmedCount: 0, totalCount: 0, fixCount: 0 })).toBe("Start workspace →");
  });

  it("an in-progress or ready pre-submission tender reads 'Continue workspace'", () => {
    expect(primaryActionLabel("assessing", { status: "in_progress", score: 50, confirmedCount: 1, totalCount: 2, fixCount: 0 })).toBe("Continue workspace →");
    expect(primaryActionLabel("building", { status: "ready", score: 100, confirmedCount: 2, totalCount: 2, fixCount: 0 })).toBe("Continue workspace →");
    expect(primaryActionLabel("assessing", null)).toBe("Continue workspace →");
  });
});

describe("isSameSastMonth (Finding 428)", () => {
  it("during the first ~2 hours of a real SAST month, a submission from the END of the PREVIOUS SAST month is correctly NOT 'this month'", () => {
    // Real SAST instant: 2026-12-01T00:30 (UTC 2026-11-30T22:30Z) - already December in SA.
    const now = new Date("2026-11-30T22:30:00.000Z");
    // Submitted 2026-11-30T20:00Z = 2026-11-30T22:00 SAST - genuinely still November in SAST.
    expect(isSameSastMonth("2026-11-30T20:00:00.000Z", now)).toBe(false);
  });

  it("the exact live RED case: a plain mid-November submission must not be counted as December's, even though both read as UTC-November at the comparison instant", () => {
    const now = new Date("2026-11-30T22:30:00.000Z"); // SAST: 2026-12-01T00:30 (real December)
    expect(isSameSastMonth("2026-11-15T10:00:00.000Z", now)).toBe(false);
  });

  it("a submission made just after real SAST midnight on the 1st IS counted as this (the new) month", () => {
    const now = new Date("2026-11-30T22:30:00.000Z"); // SAST: 2026-12-01T00:30 (real December)
    // Submitted at UTC 2026-11-30T22:15Z = SAST 2026-12-01T00:15 - genuinely December.
    expect(isSameSastMonth("2026-11-30T22:15:00.000Z", now)).toBe(true);
  });

  it("ordinary same-month case, well away from any midnight boundary", () => {
    const now = new Date("2026-11-15T12:00:00.000Z");
    expect(isSameSastMonth("2026-11-02T08:00:00.000Z", now)).toBe(true);
    expect(isSameSastMonth("2026-10-31T20:00:00.000Z", now)).toBe(false);
  });
});
