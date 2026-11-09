import { describe, it, expect } from "vitest";
import { looksLikeExistingProject } from "./cvExtraction";

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
