import { describe, expect, it } from "vitest";
import { REQUIRED_TENDER_TEMPLATES, TENDER_TEMPLATE_ORDER, TENDER_TEMPLATES } from "./tenderTemplates";

describe("REQUIRED_TENDER_TEMPLATES", () => {
  it("is exactly technical_xlsm, a_forms, c111_form_of_offer, c123_contract_data - financial_xlsm stays optional", () => {
    expect(REQUIRED_TENDER_TEMPLATES).toEqual(["technical_xlsm", "a_forms", "c111_form_of_offer", "c123_contract_data"]);
  });

  it("covers every template TENDER_TEMPLATES itself marks required:true, and only those - the structural invariant that makes this the single source of truth instead of a second hand-kept list drifting from it (2026-11-06: compliance-data.ts's PACK_REQUIRED_TEMPLATES used to hand-list the same four types a second time)", () => {
    for (const type of TENDER_TEMPLATE_ORDER) {
      const isRequired = (REQUIRED_TENDER_TEMPLATES as readonly string[]).includes(type);
      expect(isRequired).toBe(TENDER_TEMPLATES[type].required);
    }
  });
});
