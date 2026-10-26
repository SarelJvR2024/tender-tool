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

describe("suggestForPosition's noSuitableCandidate (QA finding, 2026-10-26)", () => {
  it("never suggests a candidate with no ECSA level, no years' experience and no matched keyword", () => {
    const result = suggestForPosition({
      positionCode: "RE",
      description: "Resident Engineer",
      candidateScores: [candidate({ score: 0, years_experience: null, ecsa_level: null, matched: null, missing: null })],
      tags: [],
      peopleIds: new Set(["p1"]),
    });
    expect(result.suggestion).toBeNull();
    expect(result.alternatives).toEqual([]);
    expect(result.noSuitableCandidate).toBe(true);
  });

  it("is false when nothing was ranked at all (nobody eligible) - a different, already-handled case", () => {
    const result = suggestForPosition({
      positionCode: "RE",
      description: "Resident Engineer",
      candidateScores: [],
      tags: [],
      peopleIds: new Set(),
    });
    expect(result.noSuitableCandidate).toBe(false);
  });

  it("is false once at least one ranked candidate has real evidence", () => {
    const result = suggestForPosition({
      positionCode: "RE",
      description: "Resident Engineer",
      candidateScores: [
        candidate({ person_id: "p1", score: 0, years_experience: null, ecsa_level: null, matched: null }),
        candidate({ person_id: "p2", score: 6, years_experience: 10, ecsa_level: "Professional Engineer" }),
      ],
      tags: [],
      peopleIds: new Set(["p1", "p2"]),
    });
    expect(result.noSuitableCandidate).toBe(false);
    expect(result.suggestion?.id).toBe("p2");
  });
});
