import { describe, it, expect } from "vitest";
import { looksLikeExistingProject, needsSelectFallbackOption, personFieldDefaultTick, type ProposedValue } from "./cvExtraction";

function pv(value: string | null, verified: boolean, warnings: string[] = []): ProposedValue {
  return { value, evidence: null, verified, warnings };
}

// Finding 445: app/app/my-cv/page.tsx (the employee self-service "confirm
// this AI-extracted CV" screen) ticked every proposed field's checkbox
// unconditionally (`defaultChecked`, a literal boolean, no `verified` or
// current-value check at all) - a complete bypass of the human-in-the-loop
// gate people/[id]/cv-review.tsx's own inline defaultTick formula already
// enforces for the identical cv_extraction_results data. This shared
// function is that formula, factored out so both screens read the same
// decision and can never independently drift on it again.
describe("personFieldDefaultTick", () => {
  it("ticks a verified value with nothing on file yet", () => {
    expect(personFieldDefaultTick(pv("Jane Dlamini", true), null)).toBe(true);
  });

  it("does NOT tick an unverified (low-confidence/unterraced) value, even with nothing on file - the exact gap my-cv/page.tsx had", () => {
    expect(personFieldDefaultTick(pv("Professional Engineer", false), null)).toBe(false);
  });

  it("does NOT tick a verified value that would silently replace a different value already on file", () => {
    expect(personFieldDefaultTick(pv("0821234567", true), "0837654321")).toBe(false);
  });

  it("does NOT tick when the proposed value is empty", () => {
    expect(personFieldDefaultTick(pv("", true), null)).toBe(false);
    expect(personFieldDefaultTick(pv(null, true), null)).toBe(false);
  });

  it("does NOT tick when the proposed value is already the same as what's on file (nothing to apply)", () => {
    expect(personFieldDefaultTick(pv("ECSA123", true), "ECSA123")).toBe(false);
  });

  it("ticks a verified value when what's on file is blank (empty string, not null) - not a 'replaces' case", () => {
    expect(personFieldDefaultTick(pv("ECSA123", true), "")).toBe(true);
  });
});

// Finding 466: people/[id]/page.tsx's manual "edit this person" form
// rendered ecsa_level/highest_level as a free-text <input>, unlike the two
// other real consumers of this exact field pair (cv-review.tsx, my-cv/
// page.tsx) which already constrain to the real SANRAL option list via a
// <select>. Switching the manual form to a <select> needs this helper so a
// pre-existing, non-canonical value already on file is never silently
// replaced by the browser's own "select the first option" behaviour the
// moment the form is saved for an unrelated reason - same shape as Finding
// 175's needsCreditFallbackOption()/Finding 177's needsHolderFallbackOption().
describe("needsSelectFallbackOption", () => {
  it("is false when nothing is on file (null) - the blank option covers it", () => {
    expect(needsSelectFallbackOption(null, ["Professional Engineer", "Unregistered"])).toBe(false);
  });

  it("is false when the stored value is an empty string", () => {
    expect(needsSelectFallbackOption("", ["Professional Engineer", "Unregistered"])).toBe(false);
  });

  it("is false when the stored value is exactly one of the real options", () => {
    expect(needsSelectFallbackOption("Professional Engineer", ["Professional Engineer", "Unregistered"])).toBe(false);
  });

  it("is true for a free-text value that predates the <select> and isn't a real SANRAL option - the exact case that must not be silently wiped on save", () => {
    expect(needsSelectFallbackOption("Pr Eng", ["Professional Engineer", "Unregistered"])).toBe(true);
  });

  it("is case-sensitive, same as the real SANRAL dropdown match this mirrors (engine/sanral_fill.py normalises separately; this is purely the UI fallback decision)", () => {
    expect(needsSelectFallbackOption("professional engineer", ["Professional Engineer", "Unregistered"])).toBe(true);
  });
});

// Standing QA pass, 2026-11-06: looksLikeExistingProject() is the CV-review
// page's pre-tick heuristic for "this proposed project is probably already
// on file" (app/people/[id]/cv-review.tsx) - when it says yes, the "Add this
// project" checkbox starts UNTICKED, so a reviewer who trusts the flag and
// doesn't compare the two projects by hand never adds it. Its own header
// comment says this must "never hide" a genuinely new project - a false
// positive here is a silent-data-loss risk, not a cosmetic nuisance.
describe("looksLikeExistingProject", () => {
  it("does not treat two different projects as the same one just because they share a completion year", () => {
    // Reproduces the real failure mode: a bare "2024" in both strings was
    // being used as if it were a contract/project number. A company that
    // finishes more than one project in the same year is the common case,
    // not an edge case - before the fix this returned true.
    const existing = ["ABC Municipality - Reservoir Project, completed 2024"];
    const proposed = "XYZ Municipality Water Treatment Plant Upgrade, 2024";
    expect(looksLikeExistingProject(proposed, existing)).toBe(false);
  });

  it("still matches on a real shared contract/project number embedding a year", () => {
    // "2024/15" squashes to "202415" (6 chars) - longer than a bare year, so
    // it stays a real signal, unaffected by the bare-year exclusion.
    const existing = ["Mzansi Water Board - Contract 2024/15 Pipeline Upgrade"];
    const proposed = "Mzansi Water Board, Contract 2024/15";
    expect(looksLikeExistingProject(proposed, existing)).toBe(true);
  });

  it("still matches when the whole client/contract line is identical", () => {
    const existing = ["City of Tshwane - WTW Refurbishment PO 9981"];
    expect(looksLikeExistingProject("City of Tshwane - WTW Refurbishment PO 9981", existing)).toBe(true);
  });

  it("still matches on a genuine non-year 4+ digit project number", () => {
    const existing = ["eThekwini Municipality, Contract 8842 Road Resurfacing"];
    const proposed = "eThekwini Municipality - Contract 8842";
    expect(looksLikeExistingProject(proposed, existing)).toBe(true);
  });

  it("does not match two unrelated projects with no shared number at all", () => {
    const existing = ["City Power - Substation Upgrade, Contract 5567"];
    const proposed = "Rand Water - Reservoir Lining, Contract 3321";
    expect(looksLikeExistingProject(proposed, existing)).toBe(false);
  });

  it("does not match on a number that only appears by concatenating two unrelated adjacent tokens in the existing line", () => {
    // squash() strips every separator, so "N1-234/2019" squashes to
    // "n12342019" - which happens to CONTAIN "1234" purely because "N1" runs
    // into "234" when the hyphen is stripped. A genuinely unrelated proposed
    // project whose own contract number really is "1234" must not match
    // just because that coincidental substring exists somewhere in the
    // existing line's squashed text (Finding 244).
    const existing = ["SANRAL N1-234/2019 Upgrade of N1 Western Bypass"];
    const proposed = "Joburg Water Contract 1234 Reservoir Upgrade";
    expect(looksLikeExistingProject(proposed, existing)).toBe(false);
  });
});
