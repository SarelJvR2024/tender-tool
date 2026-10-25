import { describe, it, expect } from "vitest";
import { suggestForPosition, type CandidateScore } from "./positionSuggestions";

function candidate(overrides: Partial<CandidateScore>): CandidateScore {
  return {
    person_id: "p1",
    name: "Jane Doe",
    score: 6,
    years_experience: 10,
    ecsa_level: null,
    matched: null,
    missing: null,
    specialism_warning: false,
    rationale: "",
    ...overrides,
  };
}

describe("suggestForPosition's matchPercent (Tender Workspace overhaul, item 4)", () => {
  it("is a real percentage of matched/(matched+missing) keywords, not score rescaled", () => {
    const result = suggestForPosition({
      positionCode: "RE",
      description: "Resident Engineer",
      candidateScores: [candidate({ matched: ["pavement", "materials"], missing: ["drainage"] })],
      tags: [],
      peopleIds: new Set(["p1"]),
    });
    expect(result.suggestion?.matchPercent).toBe(67); // 2 of 3
  });

  it("is null when there are no specific keywords to measure against at all", () => {
    const result = suggestForPosition({
      positionCode: "RE",
      description: "Resident Engineer",
      candidateScores: [candidate({ matched: null, missing: null })],
      tags: [],
      peopleIds: new Set(["p1"]),
    });
    expect(result.suggestion?.matchPercent).toBeNull();
  });

  it("is 100 when every keyword matched and none are missing", () => {
    const result = suggestForPosition({
      positionCode: "RE",
      description: "Resident Engineer",
      candidateScores: [candidate({ matched: ["pavement"], missing: [] })],
      tags: [],
      peopleIds: new Set(["p1"]),
    });
    expect(result.suggestion?.matchPercent).toBe(100);
  });
});
