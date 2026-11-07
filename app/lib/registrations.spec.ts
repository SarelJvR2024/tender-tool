import { describe, expect, it } from "vitest";
import { needsHolderFallbackOption } from "./registrations";

// Regression coverage for the Registrations register data-loss bug (QA
// Finding 177, 2026-11-07): HeldForm's "Held by" <select> in
// app/app/company/registrations/page.tsx must keep an already-selected
// person/director holder selectable even when they are missing from the
// loaded `holders` list - whether that's because the `people` or
// `company_principals` read failed (previously fully-discarded Supabase
// errors on the calling page) or the holder was since removed. Without
// this, the <select>'s defaultValue matches no <option>, the browser
// silently falls back to "The company", and saving ANY other field on this
// form (expiry date, certificate...) resubmits holder="company" and
// reassigns a real person/director-held registration to the company -
// saveHeldRegistration() (app/app/company/registrations/actions.ts) always
// writes person_id/principal_id straight from the submitted "holder" field,
// on every save.
describe("needsHolderFallbackOption", () => {
  it("is false for the company holder, regardless of the loaded list", () => {
    expect(needsHolderFallbackOption("company", [])).toBe(false);
    expect(needsHolderFallbackOption("company", [{ value: "person:p1" }])).toBe(false);
  });

  it("is false when the current holder is in the loaded list (the normal, happy path)", () => {
    expect(needsHolderFallbackOption("person:p1", [{ value: "person:p1" }, { value: "person:p2" }])).toBe(false);
  });

  it("is true when the holder is a person/director but the holders list came back empty - the discarded-read-error shape this finding fixes", () => {
    expect(needsHolderFallbackOption("person:p1", [])).toBe(true);
  });

  it("is true for a principal holder missing from an otherwise non-empty list (since removed)", () => {
    expect(needsHolderFallbackOption("principal:x1", [{ value: "person:p2" }, { value: "person:p3" }])).toBe(true);
  });
});
