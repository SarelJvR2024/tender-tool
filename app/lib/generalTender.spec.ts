import { describe, expect, it } from "vitest";
import { needsSignatoryFallbackOption } from "./generalTender";

// Regression coverage for the general-workspace.tsx "Who signs this bid?"
// (SBD/MBD 1, q.key "signatory_person_id") data-loss bug (Finding 436): the
// person-type question's <select> in app/app/tenders/[id]/general-workspace.tsx
// must keep an already-chosen signatory selectable even when they are
// missing from the loaded `people` list - whether that's because the
// `people` read failed (a discarded Supabase error on the calling page,
// GeneralTenderWorkspace()'s own `const people = (peopleRows ?? []) as
// Person[];`) or for any other reason the chosen person isn't in this
// render's list. Without this, the <select>'s defaultValue matches no
// <option>, the browser silently falls back to the "Choose who signs…"
// placeholder (value ""), and saving ANY other answer on this same
// always-whole-batch form (general-actions.ts's saveGeneralAnswers(), one
// <form> covering every question and company field under one "Save
// answers" button) resubmits q:signatory_person_id="" - which that
// function treats as an explicit clear, deleting the real, previously-saved
// tender_answers row outright, with no error shown ("Answers saved.").
// Same shape, same reason, as dealEconomics.ts's needsCreditFallbackOption()
// (Finding 175) and registrations.ts's needsHolderFallbackOption()
// (Finding 177).
describe("needsSignatoryFallbackOption", () => {
  it("is false when nobody has been chosen yet", () => {
    expect(needsSignatoryFallbackOption(null, [])).toBe(false);
    expect(needsSignatoryFallbackOption(null, [{ id: "p1" }])).toBe(false);
  });

  it("is false when the chosen person is in the loaded list (the normal, happy path)", () => {
    expect(needsSignatoryFallbackOption("p1", [{ id: "p1" }, { id: "p2" }])).toBe(false);
  });

  it("is true when someone is chosen but the people list came back empty - the discarded-read-error shape this finding fixes", () => {
    expect(needsSignatoryFallbackOption("p1", [])).toBe(true);
  });

  it("is true when someone is chosen but isn't in an otherwise non-empty list (since removed, or just missing from this render)", () => {
    expect(needsSignatoryFallbackOption("p1", [{ id: "p2" }, { id: "p3" }])).toBe(true);
  });
});
