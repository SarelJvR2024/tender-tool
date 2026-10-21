import { describe, expect, it } from "vitest";
import { classifyComplianceItem } from "./bid-task-status";
import type { ComplianceItem } from "@/lib/tenderCompliance";

function item(overrides: Partial<ComplianceItem>): ComplianceItem {
  return {
    key: "csd",
    form: "A7",
    label: "Central Supplier Database (CSD) registration",
    status: "have",
    mandatory: true,
    detail: "CSD supplier number on file.",
    ...overrides,
  };
}

describe("classifyComplianceItem", () => {
  it("mandatory + missing is a disqualification risk - fix", () => {
    const result = classifyComplianceItem(item({ mandatory: true, status: "missing" }));
    expect(result.status).toBe("fix");
    expect(result.confirmed).toBe(false);
  });

  it("mandatory + check (unconfirmed) is still a disqualification risk - fix, not verify", () => {
    const result = classifyComplianceItem(item({ mandatory: true, status: "check", key: "briefing", form: "Briefing" }));
    expect(result.status).toBe("fix");
    expect(result.confirmed).toBe(false);
  });

  it("mandatory + have is confirmed - verify", () => {
    const result = classifyComplianceItem(item({ mandatory: true, status: "have" }));
    expect(result.status).toBe("verify");
    expect(result.confirmed).toBe(true);
  });

  it("optional + missing is something only the user can supply - provide, not fix", () => {
    const result = classifyComplianceItem(item({ mandatory: false, status: "missing", key: "bank", form: "A18" }));
    expect(result.status).toBe("provide");
    expect(result.confirmed).toBe(false);
  });

  it("optional + check is unconfirmed but not disqualifying - verify, not fix", () => {
    const result = classifyComplianceItem(item({ mandatory: false, status: "check", key: "tax", form: "A9" }));
    expect(result.status).toBe("verify");
    expect(result.confirmed).toBe(false);
  });

  it("optional + have is confirmed - verify", () => {
    const result = classifyComplianceItem(item({ mandatory: false, status: "have", key: "bbbee", form: "A12" }));
    expect(result.status).toBe("verify");
    expect(result.confirmed).toBe(true);
  });

  it("fixLabel reuses the shared short form-code label, falling back to a generic review action for an unmapped form", () => {
    expect(classifyComplianceItem(item({ form: "A7", status: "missing" })).fixLabel).toBe("Confirm CSD registration");
    expect(classifyComplianceItem(item({ form: "Z99", status: "missing" })).fixLabel).toBe("Review Z99");
  });

  it("fixHref uses the item's own key, falling back to the compliance-check anchor for an unmapped key", () => {
    expect(classifyComplianceItem(item({ key: "bbbee", status: "missing", mandatory: false })).fixHref).toBe("/company#bee-cidb");
    expect(classifyComplianceItem(item({ key: "something_new", status: "missing", mandatory: false })).fixHref).toBe("#compliance-check");
  });
});
