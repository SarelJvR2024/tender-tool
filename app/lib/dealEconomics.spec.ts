import { describe, expect, it } from "vitest";
import { clientLabel, needsCreditFallbackOption } from "./dealEconomics";

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

// Standing review finding, 2026-11-09 (Finding 304): clientLabel() had NO
// test coverage at all before this - the exact gap that let app/pipeline/
// page.tsx's own inline copy of this rule drift away from it unnoticed
// (missing the family === "UNKNOWN" exclusion added here from day one,
// 2026-10-17) for three weeks. These cases pin the real rule, including the
// one app/pipeline/page.tsx got wrong: "UNKNOWN" is a genuine, still-written
// tenders.family value (migration 0001's own column comment; set by
// engine/intake/classify_tender.py whenever a real SANRAL workbook is found
// but engine/fingerprint.py can't tell Conventional from RRM apart) that is
// deliberately NOT one of lib/pastSubmissionReuse.ts's own canonical
// SANRAL_PACK_FAMILIES - every other "is this tender SANRAL" check in this
// app already agrees it isn't SANRAL, same as this function.
describe("clientLabel", () => {
  it("uses the real buyer when one is on file, regardless of family", () => {
    expect(clientLabel("Transnet", "Conventional Consultant Tender")).toBe("Transnet");
    expect(clientLabel("Transnet", null)).toBe("Transnet");
  });

  it("falls back to SANRAL for a known SANRAL sub-family with no buyer on file", () => {
    expect(clientLabel(null, "Conventional Consultant Tender")).toBe("SANRAL");
    expect(clientLabel(null, "RRM Consultant Tender")).toBe("SANRAL");
  });

  it("falls back to (unknown buyer), NOT SANRAL, for family UNKNOWN with no buyer on file - the real gap app/pipeline/page.tsx's own inline copy of this rule missed", () => {
    expect(clientLabel(null, "UNKNOWN")).toBe("(unknown buyer)");
  });

  it("falls back to (unknown buyer) for a general-family tender with no buyer on file", () => {
    expect(clientLabel(null, "General (non-SANRAL)")).toBe("(unknown buyer)");
  });

  it("falls back to (unknown buyer) when there is no buyer and no family at all", () => {
    expect(clientLabel(null, null)).toBe("(unknown buyer)");
  });
});
