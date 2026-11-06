import { describe, expect, it } from "vitest";
import { IN_PROGRESS_STAGES, NEXT_STAGES, OUTCOME_FORM_STAGES, PIPELINE_STAGES } from "./pipeline";

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

describe("OUTCOME_FORM_STAGES", () => {
  it("is exactly submitted, briefing_shortlisted, won, lost - the real-world bug this guards against: 2026-11-06 found that briefing_shortlisted was reachable via NEXT_STAGES.submitted but missing from OutcomeForm's own hand-listed stage check, so a tender moved through it got plain Won/Lost buttons with no outcome form at all", () => {
    expect(OUTCOME_FORM_STAGES as readonly string[]).toEqual(
      expect.arrayContaining(["submitted", "briefing_shortlisted", "won", "lost"]),
    );
    expect(OUTCOME_FORM_STAGES).toHaveLength(4);
  });

  it("covers every stage NEXT_STAGES can move straight to won/lost from - the structural invariant that makes the bug above impossible to reintroduce by adding a new path to won/lost without also wiring OutcomeForm up to it", () => {
    for (const stage of PIPELINE_STAGES) {
      const canReachAnOutcome = NEXT_STAGES[stage].some((next) => next === "won" || next === "lost");
      if (canReachAnOutcome) {
        expect(OUTCOME_FORM_STAGES as readonly string[]).toContain(stage);
      }
    }
  });

  it("excludes found/assessing/building - no outcome exists yet that far back", () => {
    for (const stage of ["found", "assessing", "building"] as const) {
      expect(OUTCOME_FORM_STAGES as readonly string[]).not.toContain(stage);
    }
  });
});
