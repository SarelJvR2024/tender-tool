import { describe, expect, it } from "vitest";
import { scoreOutlookChips } from "./scoreOutlookChips";

describe("scoreOutlookChips", () => {
  it("returns nothing for a null outlook (pre-0013 rows, or metadata-only tenders)", () => {
    expect(scoreOutlookChips(null)).toEqual([]);
  });

  it("returns nothing when every sub-field is absent or unresolved", () => {
    expect(
      scoreOutlookChips({
        preference_system: { system: "not_found", reason: "x" },
        specific_goals: { basis: "not_found", bases: [], points_estimate: null, reason: "x" } as never,
        functionality: { present: null, threshold: null, reason: "x" },
        locality: { match: null },
      }),
    ).toEqual([]);
  });

  it("renders a real preference-system chip, never fabricating a split that wasn't found", () => {
    const chips = scoreOutlookChips({ preference_system: { system: "90/10", reason: "stated in the document" } });
    expect(chips).toEqual([{ label: "Price 90/10", tone: "success", title: "stated in the document" }]);
  });

  it("flags an ambiguous preference system as a warning, not a resolved fact", () => {
    const chips = scoreOutlookChips({ preference_system: { system: "ambiguous", reason: "both options printed" } });
    expect(chips[0]).toMatchObject({ label: "Price split: ambiguous", tone: "warning" });
  });

  it("shows the real functionality threshold when the document states one", () => {
    const chips = scoreOutlookChips({ functionality: { present: true, threshold: 70, reason: "min 70 to qualify" } });
    expect(chips[0]).toEqual({ label: "Functionality ≥ 70", tone: "warning", title: "min 70 to qualify" });
  });

  it("shows a plain functionality gate when present but no threshold was stated", () => {
    const chips = scoreOutlookChips({ functionality: { present: true, threshold: null, reason: "judged by committee" } });
    expect(chips[0]).toMatchObject({ label: "Functionality gate" });
  });

  it("marks 'no functionality gate' as good news (success tone), not a warning", () => {
    const chips = scoreOutlookChips({ functionality: { present: false, threshold: null, reason: "price and specific goals only" } });
    expect(chips[0]).toMatchObject({ label: "No functionality gate", tone: "success" });
  });

  it("shows a real specific-goals points estimate when the profile actually answers it", () => {
    const chips = scoreOutlookChips({ specific_goals: { bases: ["bbbee_level"], points_estimate: "16 of 20", reason: "level 2 on file" } as never });
    expect(chips[0]).toMatchObject({ label: "Specific goals: 16 of 20", tone: "success" });
  });

  it("never fabricates a number for specific goals it can't compute - flags 'check manually' instead", () => {
    const chips = scoreOutlookChips({ specific_goals: { bases: ["locality"], points_estimate: null, reason: "rows not answered by the company record" } as never });
    expect(chips[0]).toMatchObject({ label: "Specific goals: check manually", tone: "warning" });
  });

  it("shows a matched locality chip with its real point value", () => {
    const chips = scoreOutlookChips({ locality: { match: { status: "matched", points: 5, reason: "office in X matches" } } });
    expect(chips[0]).toEqual({ label: "Locality: matched (5pt)", tone: "success", title: "office in X matches" });
  });

  it("shows a no-match locality chip without inventing points", () => {
    const chips = scoreOutlookChips({ locality: { match: { status: "no_match", points: 0, reason: "no office in the preferred area" } } });
    expect(chips[0]).toMatchObject({ label: "Locality: no match", tone: "muted" });
  });

  it("stays silent on an 'unknown' locality match (no office data) rather than showing a misleading chip", () => {
    expect(scoreOutlookChips({ locality: { match: { status: "unknown", points: null, reason: "no offices on file" } } })).toEqual([]);
  });

  it("combines every real signal into one ordered chip list", () => {
    const chips = scoreOutlookChips({
      preference_system: { system: "80/20", reason: "stated" },
      functionality: { present: true, threshold: 70, reason: "min 70" },
      specific_goals: { bases: ["bbbee_level"], points_estimate: "3 of 20", reason: "level on file" } as never,
      locality: { match: { status: "matched", points: 4, reason: "office match" } },
    });
    expect(chips.map((c) => c.label)).toEqual(["Price 80/20", "Functionality ≥ 70", "Specific goals: 3 of 20", "Locality: matched (4pt)"]);
  });
});
