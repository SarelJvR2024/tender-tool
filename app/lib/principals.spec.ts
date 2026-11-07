import { describe, expect, it } from "vitest";
import { needsPersonFallbackOption } from "./principals";

// Regression coverage for the Directors & shareholders register data-loss
// bug (QA Finding 177, 2026-11-07): the "Also one of your people (CV)?"
// <select> in app/app/company/principals/page.tsx's PrincipalForm must keep
// an already-linked person selectable even when they are missing from the
// loaded `people` list - whether that's because the `people` read failed (a
// previously-discarded Supabase error on the calling page) or the person was
// since removed. Without this, the <select>'s defaultValue matches no
// <option>, the browser silently falls back to "No", and saving ANY other
// field on this form (position, ownership %, ...) resubmits person_id=""
// and wipes the real company_principals.person_id link -
// savePrincipal() (app/app/company/principals/actions.ts) always writes
// person_id straight from the submitted form field, on every edit save.
// Same shape as app/lib/dealEconomics.ts's needsCreditFallbackOption()
// (Finding 175).
describe("needsPersonFallbackOption", () => {
  it("is false when nobody is linked yet", () => {
    expect(needsPersonFallbackOption(null, [])).toBe(false);
    expect(needsPersonFallbackOption(null, [{ id: "p1" }])).toBe(false);
  });

  it("is false when the linked person is in the loaded list (the normal, happy path)", () => {
    expect(needsPersonFallbackOption("p1", [{ id: "p1" }, { id: "p2" }])).toBe(false);
  });

  it("is true when someone is linked but the people list came back empty - the discarded-read-error shape this finding fixes", () => {
    expect(needsPersonFallbackOption("p1", [])).toBe(true);
  });

  it("is true when someone is linked but isn't in an otherwise non-empty list (since removed)", () => {
    expect(needsPersonFallbackOption("p1", [{ id: "p2" }, { id: "p3" }])).toBe(true);
  });
});
