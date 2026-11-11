import { describe, expect, it } from "vitest";
import { groupCardsByStage, IN_PROGRESS_STAGES, NEXT_STAGES, OUTCOME_FORM_STAGES, PIPELINE_STAGES, type PipelineStage } from "./pipeline";

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

describe("groupCardsByStage", () => {
  type TestCard = { id: string; stage: PipelineStage; stageChangedAt: string | null };
  const card = (id: string, stage: PipelineStage, stageChangedAt: string | null): TestCard => ({ id, stage, stageChangedAt });

  it("sorts the briefing_shortlisted column most-recent-first, same as submitted/won/lost - the real bug: the pre-fix inline version in pipeline/page.tsx hand-listed only [\"submitted\", \"won\", \"lost\"], written in the exact same commit that added the briefing_shortlisted column, so that column silently kept its input order instead", () => {
    const cards = [
      card("old", "briefing_shortlisted", "2026-01-01T00:00:00Z"),
      card("new", "briefing_shortlisted", "2026-06-01T00:00:00Z"),
      card("mid", "briefing_shortlisted", "2026-03-01T00:00:00Z"),
    ];
    const byStage = groupCardsByStage(cards);
    expect(byStage.briefing_shortlisted.map((c) => c.id)).toEqual(["new", "mid", "old"]);
  });

  it("sorts submitted/won/lost most-recent-first too - the already-correct siblings, unaffected by the fix", () => {
    const cards = [
      card("old", "submitted", "2026-01-01T00:00:00Z"),
      card("new", "submitted", "2026-06-01T00:00:00Z"),
      card("oldWon", "won", "2026-01-01T00:00:00Z"),
      card("newWon", "won", "2026-06-01T00:00:00Z"),
    ];
    const byStage = groupCardsByStage(cards);
    expect(byStage.submitted.map((c) => c.id)).toEqual(["new", "old"]);
    expect(byStage.won.map((c) => c.id)).toEqual(["newWon", "oldWon"]);
  });

  it("leaves 'open work' columns (found/assessing/building) in input order - they sort by closing date, via the caller's own query order, not here", () => {
    const cards = [
      card("first", "building", "2026-01-01T00:00:00Z"),
      card("second", "building", "2026-06-01T00:00:00Z"),
    ];
    const byStage = groupCardsByStage(cards);
    expect(byStage.building.map((c) => c.id)).toEqual(["first", "second"]);
  });

  it("every card lands in exactly its own stage's column, every PIPELINE_STAGES column present even when empty", () => {
    const cards = [card("a", "found", null), card("b", "lost", "2026-02-02T00:00:00Z")];
    const byStage = groupCardsByStage(cards);
    for (const stage of PIPELINE_STAGES) expect(byStage[stage]).toBeDefined();
    expect(byStage.found.map((c) => c.id)).toEqual(["a"]);
    expect(byStage.lost.map((c) => c.id)).toEqual(["b"]);
    expect(byStage.assessing).toEqual([]);
  });
});
