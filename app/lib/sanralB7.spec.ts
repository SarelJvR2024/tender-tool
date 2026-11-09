import { describe, expect, it } from "vitest";
import { checkPlan, totalPercentInRange, type TargetedEnterprise } from "./sanralB7";

// QA pass, 2026-11-08: checkPlan() bounded each Targeted Enterprise's own
// percentage 0-100 individually, but never checked the SUM across TEs - a
// plan with two TEs each individually valid (60% and 55%) totalled 115% of
// the contract price with no error or warning anywhere, a factually
// impossible allocation most likely from a data-entry mistake. No spec file
// existed for this module before this (confirmed by grep) - scoped here to
// just this new check, not a full rewrite of untested prior behaviour.
// engine/sanral_b7.py's check_plan() has the identical fix, same pass.

const te = (overrides: Partial<TargetedEnterprise> = {}): TargetedEnterprise => ({
  name: "Named TE",
  to_be_identified: false,
  size: "EME",
  pct_of_contract: 10,
  pct_excl_provisional: 10,
  black_ownership_pct: 100,
  bee_level: 1,
  head_office: null,
  in_project_province: "YES",
  consulting_engineering_firm: null,
  tax_reference: null,
  ...overrides,
});

describe("checkPlan - Targeted Enterprise total percentage", () => {
  it("warns when two individually-valid TE percentages total over 100%", () => {
    const { errors, warnings } = checkPlan(
      {
        mode: "subcontract",
        waiver_quote: null,
        comments: null,
        targeted_enterprises: [
          te({ name: "A", pct_excl_provisional: 60, pct_of_contract: 60 }),
          te({ name: "B", pct_excl_provisional: 55, pct_of_contract: 55 }),
        ],
      },
      { status: "required", needsPlan: true, reason: "" },
    );
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes("more than the whole contract has been allocated"))).toBe(true);
  });

  it("does not warn when the total is exactly 100%", () => {
    const { warnings } = checkPlan(
      {
        mode: "subcontract",
        waiver_quote: null,
        comments: null,
        targeted_enterprises: [te({ name: "A", pct_excl_provisional: 100, pct_of_contract: 100 })],
      },
      { status: "required", needsPlan: true, reason: "" },
    );
    expect(warnings.some((w) => w.includes("more than the whole contract"))).toBe(false);
  });

  it("still warns below the 30% policy minimum, unaffected by the new check", () => {
    const { errors, warnings } = checkPlan(
      {
        mode: "subcontract",
        waiver_quote: null,
        comments: null,
        targeted_enterprises: [te({ name: "A", pct_excl_provisional: 20, pct_of_contract: 20 })],
      },
      { status: "required", needsPlan: true, reason: "" },
    );
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes("below SANRAL's 30% minimum"))).toBe(true);
  });
});

// QA pass, 2026-11-09: subcontracting-plan-form.tsx's own live client-side
// total preview used to only check the lower bound (below 30% -> amber), so
// a total of 115% showed in GREEN ("all good") while typing - the exact
// opposite of the warning checkPlan() above already raises for the same
// total once saved. Extracted as this shared, single-source-of-truth
// function so the form's own preview and checkPlan()'s own warnings can
// never disagree about which band a total falls in again.
describe("totalPercentInRange", () => {
  it("is false below the policy minimum", () => {
    expect(totalPercentInRange(20)).toBe(false);
  });
  it("is true within the acceptable band", () => {
    expect(totalPercentInRange(30)).toBe(true);
    expect(totalPercentInRange(65)).toBe(true);
    expect(totalPercentInRange(100)).toBe(true);
  });
  it("is false once the total exceeds the whole contract (over 100%)", () => {
    expect(totalPercentInRange(115)).toBe(false);
  });
});
