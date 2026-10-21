import { describe, expect, it } from "vitest";
import {
  briefingStep,
  buyerFormStep,
  cidbGradingStep,
  formStep,
  formStepStatus,
  gapStep,
  unrepresentedGaps,
} from "./submission-plan-logic";
import type { ManifestForm, RequirementManifest } from "@/lib/generalTender";

function form(overrides: Partial<ManifestForm>): ManifestForm {
  return {
    code: "4",
    label: "SBD 4",
    title: "Declaration of Interest",
    status: "auto",
    reason: "Auto-filled from company details.",
    mentions: 1,
    quote: "some quote",
    editions: [{ document: "SBD4.pdf", format: "pdf", editable: false }],
    ...overrides,
  };
}

function manifest(overrides: Partial<RequirementManifest> = {}): RequirementManifest {
  return {
    version: 1,
    extracted_at: "2026-01-01T00:00:00Z",
    form_suite: "SBD",
    documents: [],
    forms: [],
    buyer_forms: [],
    returnables: [],
    roles: [],
    cidb: null,
    briefing: null,
    scoring: { preference_system: { system: "" }, functionality: {}, specific_goal_bases: [] },
    experience_evidence: { source: "", rules: [] },
    locality: { rows: [], mandatory_local_office: null },
    questions: [],
    company_fields: [],
    gaps: [],
    ...overrides,
  };
}

describe("formStepStatus", () => {
  it("auto is confirmed (Verify) - the engine already filled it", () => {
    expect(formStepStatus("auto")).toBe("confirmed");
  });
  it("attach is confirmed (Verify) - already on file, just attached", () => {
    expect(formStepStatus("attach")).toBe("confirmed");
  });
  it("overlay is confirmed (Verify) - typed onto the PDF for you", () => {
    expect(formStepStatus("overlay")).toBe("confirmed");
  });
  it("by_hand is needs_input (Provide), NOT missing (Fix) - matches FORM_STATUS_STYLE's own amber, not red", () => {
    expect(formStepStatus("by_hand")).toBe("needs_input");
  });
});

describe("formStep", () => {
  it("builds the title from the form suite prefix, code and label", () => {
    const s = formStep(form({ code: "6.1", label: "SBD 6.1" }), "SBD");
    expect(s.title).toBe("SBD 6.1 - SBD 6.1");
    expect(s.id).toBe("form:6.1");
  });
  it("falls back to 'SBD' when form_suite is null", () => {
    const s = formStep(form({ code: "4" }), null);
    expect(s.title).toBe("SBD 4 - SBD 4");
  });
  it("uses the MBD suite prefix when given", () => {
    const s = formStep(form({ code: "4" }), "MBD");
    expect(s.title).toBe("MBD 4 - SBD 4");
  });
  it("by_hand status produces bidTaskStatus provide, not fix", () => {
    const s = formStep(form({ status: "by_hand", reason: "Sign it yourself." }), "SBD");
    expect(s.reviewStatus).toBe("needs_input");
    expect(s.bidTaskStatus).toBe("provide");
    expect(s.note).toBe("Sign it yourself.");
  });
  it("auto status produces bidTaskStatus verify", () => {
    const s = formStep(form({ status: "auto" }), "SBD");
    expect(s.bidTaskStatus).toBe("verify");
  });
  it("document falls back to the first edition's own document name", () => {
    const s = formStep(form({ editions: [{ document: "Form.docx", format: "docx", editable: true }] }), "SBD");
    expect(s.document).toBe("Form.docx");
  });
  it("document is null when there are no editions", () => {
    const s = formStep(form({ editions: [] }), "SBD");
    expect(s.document).toBeNull();
  });
});

describe("buyerFormStep", () => {
  const base = { key: "cidb_ceq", label: "CIDB Compulsory Enterprise Questionnaire", document: "CEQ.pdf", format: "pdf", reason: "Typed for you." };
  it("an overlay buyer form is confirmed (Verify)", () => {
    const s = buyerFormStep({ ...base, overlay: { code: "ceq", document: "CEQ.pdf", page: 1, fills: "company details", by_hand: "signature" } });
    expect(s.reviewStatus).toBe("confirmed");
    expect(s.bidTaskStatus).toBe("verify");
  });
  it("a buyer form with no overlay is needs_input (Provide), not Fix", () => {
    const s = buyerFormStep(base);
    expect(s.reviewStatus).toBe("needs_input");
    expect(s.bidTaskStatus).toBe("provide");
  });
  it("carries the document, reason and quote through", () => {
    const s = buyerFormStep({ ...base, quote: "the actual quoted text" });
    expect(s.document).toBe("CEQ.pdf");
    expect(s.note).toBe("Typed for you.");
    expect(s.quote).toBe("the actual quoted text");
  });
});

describe("cidbGradingStep", () => {
  const cidb = { grading: "6CE", quote: "CIDB grading 6CE or higher" };
  it("no company grading on file at all - missing (Fix)", () => {
    const s = cidbGradingStep(cidb, null);
    expect(s.reviewStatus).toBe("missing");
    expect(s.bidTaskStatus).toBe("fix");
    expect(s.note).toContain("no CIDB grading on file");
  });
  it("company has a grading on file - needs_input (Provide), NOT confirmed/Verify, with the comparison caveat", () => {
    const s = cidbGradingStep(cidb, "9CE");
    expect(s.reviewStatus).toBe("needs_input");
    expect(s.bidTaskStatus).toBe("provide");
    expect(s.note).toContain("9CE");
    expect(s.note).toContain("doesn't compare grading levels for you");
  });
  it("quote passes through unchanged", () => {
    const s = cidbGradingStep(cidb, null);
    expect(s.quote).toBe("CIDB grading 6CE or higher");
  });
});

describe("briefingStep", () => {
  it("is always needs_input (Provide) - never Verify or Fix", () => {
    const s = briefingStep({ compulsory: true, quote: "attendance is compulsory" });
    expect(s.reviewStatus).toBe("needs_input");
    expect(s.bidTaskStatus).toBe("provide");
    expect(s.quote).toBe("attendance is compulsory");
  });
});

describe("unrepresentedGaps", () => {
  it("drops a gap restating a by_hand form's own message", () => {
    const m = manifest({
      forms: [form({ status: "by_hand", label: "SBD 9" })],
      gaps: ["SBD 9 must be completed by hand: no auto-fill rule found."],
    });
    expect(unrepresentedGaps(m)).toEqual([]);
  });
  it("drops a gap restating an overlay form's own message", () => {
    const m = manifest({
      forms: [form({ status: "overlay", label: "Form of Offer" })],
      gaps: ["Form of Offer is a flat PDF: only some fields could be typed onto it."],
    });
    expect(unrepresentedGaps(m)).toEqual([]);
  });
  it("keeps a gap that isn't a per-form restatement", () => {
    const m = manifest({ forms: [], gaps: ["This document is a scanned image - OCR wasn't available."] });
    expect(unrepresentedGaps(m)).toEqual(["This document is a scanned image - OCR wasn't available."]);
  });
  it("an auto form's own gap-shaped text (if any) is never matched - only by_hand/overlay forms generate a prefix to dedupe against", () => {
    const m = manifest({
      forms: [form({ status: "auto", label: "SBD 4" })],
      gaps: ["SBD 4 must be completed by hand: unrelated text that happens to share a label."],
    });
    // auto forms contribute no prefix at all, so this gap is kept
    expect(unrepresentedGaps(m)).toEqual(["SBD 4 must be completed by hand: unrelated text that happens to share a label."]);
  });
  it("mixed: some gaps deduped, others kept", () => {
    const m = manifest({
      forms: [form({ status: "by_hand", label: "SBD 9" }), form({ status: "overlay", label: "Form of Offer" })],
      gaps: [
        "SBD 9 must be completed by hand: reason one.",
        "Form of Offer is a flat PDF: reason two.",
        "A genuinely new limitation not tied to any form.",
      ],
    });
    expect(unrepresentedGaps(m)).toEqual(["A genuinely new limitation not tied to any form."]);
  });
});

describe("gapStep", () => {
  it("is always missing (Fix) - an unresolved engine limitation is a real risk, not a known task", () => {
    const s = gapStep("Couldn't determine the form suite.", 0);
    expect(s.reviewStatus).toBe("missing");
    expect(s.bidTaskStatus).toBe("fix");
    expect(s.id).toBe("gap:0");
    expect(s.title).toBe("Known limitation");
    expect(s.note).toBe("Couldn't determine the form suite.");
  });
});
