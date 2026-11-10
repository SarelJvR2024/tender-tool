import { describe, expect, it } from "vitest";
import { matchLocality, type CompanyOffice, type LocalityRow } from "./locality";

function office(partial: Partial<CompanyOffice>): CompanyOffice {
  return {
    id: "1",
    label: null,
    office_kind: "head_office",
    province: "Western Cape",
    district_municipality: null,
    local_municipality: null,
    town: null,
    street_address: null,
    proof_type: null,
    proof_date: null,
    notes: null,
    ...partial,
  };
}

function row(partial: Partial<LocalityRow>): LocalityRow {
  return {
    area: "",
    level: "municipality",
    province: null,
    points: 5,
    system: null,
    kind: "specific_goals",
    ...partial,
  };
}

describe("matchLocality", () => {
  it("does not match a district whose name happens to contain a different, unrelated area's name as a run of bare letters", () => {
    // Confirmed live on the Python side (engine/discovery/score_outlook.py's
    // own _norm_area_words() docstring, 2026-10-21): an office in Kannaland
    // (Western Cape) was scored as matching a tender's locality row for Nala
    // (a Free State local municipality, nothing to do with Kannaland) purely
    // because the bare letters "nala" sit inside "kannaland". Same bug shape
    // reproduced here on the TS mirror.
    const rows = [row({ area: "Nala", points: 5, system: "90/10" })];
    const offices = [office({ district_municipality: "Kannaland" })];
    const m = matchLocality(rows, offices);
    expect(m.status).toBe("no_match");
  });

  it("still matches a genuine whole-word-contained name ('City of Tshwane' vs 'Tshwane')", () => {
    const rows = [row({ area: "Tshwane", points: 5 })];
    const offices = [office({ local_municipality: "City of Tshwane" })];
    const m = matchLocality(rows, offices);
    expect(m.status).toBe("matched");
    expect(m.points).toBe(5);
  });

  it("still matches an exact province row", () => {
    const rows = [row({ area: "Gauteng", level: "province", province: "Gauteng", points: 10 })];
    const offices = [office({ province: "Gauteng" })];
    const m = matchLocality(rows, offices);
    expect(m.status).toBe("matched");
    expect(m.points).toBe(10);
  });

  it("still tolerates a tender's own misspelling of a real municipality (Levenshtein ratio)", () => {
    // TN051/2026's own points table misspells "Dawid Kruiper" as "Dawid Kruper".
    const rows = [row({ area: "Dawid Kruper", points: 20 })];
    const offices = [office({ local_municipality: "Dawid Kruiper" })];
    const m = matchLocality(rows, offices);
    expect(m.status).toBe("matched");
    expect(m.points).toBe(20);
  });

  it("reports no_match (not a false positive) when no office is anywhere near the required area", () => {
    const rows = [row({ area: "Nala", points: 5 })];
    const offices = [office({ province: "Gauteng", district_municipality: "City of Tshwane" })];
    const m = matchLocality(rows, offices);
    expect(m.status).toBe("no_match");
    expect(m.points).toBe(0);
  });

  it("reports unknown with no offices on file", () => {
    const m = matchLocality([row({ area: "Nala" })], []);
    expect(m.status).toBe("unknown");
    expect(m.points).toBeNull();
  });

  // Finding 306 (2026-11-10): similar()'s similarity ratio used to be a
  // plain Levenshtein (edit-distance) ratio instead of a port of Python's
  // difflib.SequenceMatcher.ratio() (Ratcliff/Obershelp, matching BLOCKS of
  // characters) - a different metric from the one
  // engine/discovery/score_outlook.py's own _area_matches() uses for the
  // identical 0.85 threshold, despite this file's header comment claiming
  // "same rules". The two metrics mostly agree but diverge right around
  // 0.85: "Ditsobotla" (a real North West local municipality - this app's
  // own canonical SA-municipality list, engine/discovery/
  // test_score_outlook.py) against the plausible single-transposition typo
  // "Ditsobolta" (the same kind of buyer misspelling the Dawid Kruper/
  // Kruiper case above already covers) - difflib's real ratio is 0.900
  // (matches); the old Levenshtein ratio here was 0.800 (did not match).
  it("tolerates a plausible transposition typo of a real municipality the same way the Python engine does (Ditsobotla/Ditsobolta)", () => {
    const rows = [row({ area: "Ditsobolta", points: 15 })];
    const offices = [office({ local_municipality: "Ditsobotla" })];
    const m = matchLocality(rows, offices);
    expect(m.status).toBe("matched");
    expect(m.points).toBe(15);
  });
});
