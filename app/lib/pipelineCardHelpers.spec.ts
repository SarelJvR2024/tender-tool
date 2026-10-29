import { describe, expect, it } from "vitest";
import { packHealthStatusFromReadiness, primaryActionLabel } from "./pipelineCardHelpers";

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

  it("a blocked pre-submission tender shows the real mandatory-item count, not a generic label", () => {
    expect(primaryActionLabel("bidding", { status: "blocked", score: 60, confirmedCount: 3, totalCount: 5, fixCount: 2 })).toBe("Fix returnables (2) →");
  });

  it("a tender with no workspace started yet reads 'Start workspace'", () => {
    expect(primaryActionLabel("found", { status: "not_started", score: 0, confirmedCount: 0, totalCount: 0, fixCount: 0 })).toBe("Start workspace →");
  });

  it("an in-progress or ready pre-submission tender reads 'Continue workspace'", () => {
    expect(primaryActionLabel("bidding", { status: "in_progress", score: 50, confirmedCount: 1, totalCount: 2, fixCount: 0 })).toBe("Continue workspace →");
    expect(primaryActionLabel("bidding", { status: "ready", score: 100, confirmedCount: 2, totalCount: 2, fixCount: 0 })).toBe("Continue workspace →");
    expect(primaryActionLabel("bidding", null)).toBe("Continue workspace →");
  });
});
