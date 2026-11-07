import { describe, expect, it } from "vitest";
import { needsCreditFallbackOption } from "./dealEconomics";

// Regression coverage for the EconomicsForm data-loss bug (QA finding,
// 2026-11-07): the "Credit for the submission" <select> in
// app/app/pipeline/economics-form.tsx must keep an already-credited person
// selectable even when they are missing from the loaded `people` list -
// whether that's because the `people` read failed (a discarded Supabase
// error on the calling page: app/app/pipeline/page.tsx or
// app/app/pipeline/pricing/page.tsx) or the person was since removed.
// Without this, the <select>'s defaultValue matches no <option>, the
// browser silently falls back to "Nobody yet", and saving ANY other field
// on this always-whole-row form (price, VAT, commission...) resubmits
// person_id="" and wipes the real credit assignment - saveTenderEconomics
// (app/app/pipeline/actions.ts) always writes submitted_by_person_id
// straight from the submitted form field, on every save.
describe("needsCreditFallbackOption", () => {
  it("is false when nobody is credited yet", () => {
    expect(needsCreditFallbackOption(null, [])).toBe(false);
    expect(needsCreditFallbackOption(null, [{ id: "p1" }])).toBe(false);
  });

  it("is false when the credited person is in the loaded list (the normal, happy path)", () => {
    expect(needsCreditFallbackOption("p1", [{ id: "p1" }, { id: "p2" }])).toBe(false);
  });

  it("is true when someone is credited but the people list came back empty - the discarded-read-error shape this finding fixes", () => {
    expect(needsCreditFallbackOption("p1", [])).toBe(true);
  });

  it("is true when someone is credited but isn't in an otherwise non-empty list (since removed)", () => {
    expect(needsCreditFallbackOption("p1", [{ id: "p2" }, { id: "p3" }])).toBe(true);
  });
});
