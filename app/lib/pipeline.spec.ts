import { describe, expect, it } from "vitest";
import { IN_PROGRESS_STAGES, PIPELINE_STAGES } from "./pipeline";

describe("IN_PROGRESS_STAGES", () => {
  it("is exactly found + assessing + building (+ the pre-0105 legacy 'bidding' value) - the single source of truth for every 'Active bids' stat", () => {
    expect(IN_PROGRESS_STAGES).toEqual(["found", "assessing", "building", "bidding"]);
  });

  it("excludes submitted/won/lost - a bid that's handed in or decided is no longer 'active work'", () => {
    for (const stage of PIPELINE_STAGES) {
      if (stage === "submitted" || stage === "won" || stage === "lost") {
        expect(IN_PROGRESS_STAGES as readonly string[]).not.toContain(stage);
      }
    }
  });
});
