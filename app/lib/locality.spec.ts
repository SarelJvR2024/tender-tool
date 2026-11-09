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
});
