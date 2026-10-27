import { describe, expect, it } from "vitest";
import { returnablesWindowCandidates, RETURNABLES_DIGEST_MIN_BUSINESS_DAYS, RETURNABLES_DIGEST_MAX_BUSINESS_DAYS, type ReturnablesWindowTenderRow } from "./returnablesDigestCandidates";

describe("returnablesWindowCandidates", () => {
  // Same QA-fix shape as deadlineReminderCandidates()'s own test (2026-10-22
  // finding): a shared tender tracked by more than one company must yield
  // one candidate PER company, not just the first.
  const tender: ReturnablesWindowTenderRow = {
    id: "tender-1",
    contract_no: "SANRAL/1234",
    description: null,
    title: null,
    closing_date: "2026-11-01",
    family: "Conventional Consultant Tender",
    document_requirements: null,
    tender_packs: [{ company_id: "company-a" }, { company_id: "company-b" }],
  };
  const businessDaysBetweenFn = () => 4; // inside the 3-5 window for every call below

  it("produces one candidate per company tracking the SAME tender, not just the first", () => {
    const candidates = returnablesWindowCandidates([tender], "2026-10-27", businessDaysBetweenFn);
    expect(candidates.map((c) => c.companyId).sort()).toEqual(["company-a", "company-b"]);
    expect(candidates.every((c) => c.tender.id === "tender-1" && c.businessDaysLeft === 4)).toBe(true);
  });

  it("a tender with no tracking company at all yields no candidates (not a crash)", () => {
    const untracked: ReturnablesWindowTenderRow = { ...tender, id: "tender-2", tender_packs: [] };
    expect(returnablesWindowCandidates([untracked], "2026-10-27", businessDaysBetweenFn)).toEqual([]);
  });

  it("no closing date on file yields nothing (not a crash)", () => {
    const noClosing: ReturnablesWindowTenderRow = { ...tender, closing_date: null };
    expect(returnablesWindowCandidates([noClosing], "2026-10-27", businessDaysBetweenFn)).toEqual([]);
  });

  it("the window is inclusive at both ends (3 and 5 business days), exclusive just outside it", () => {
    expect(RETURNABLES_DIGEST_MIN_BUSINESS_DAYS).toBe(3);
    expect(RETURNABLES_DIGEST_MAX_BUSINESS_DAYS).toBe(5);
    expect(returnablesWindowCandidates([tender], "2026-10-27", () => 3)).toHaveLength(2);
    expect(returnablesWindowCandidates([tender], "2026-10-27", () => 5)).toHaveLength(2);
    expect(returnablesWindowCandidates([tender], "2026-10-27", () => 2)).toEqual([]);
    expect(returnablesWindowCandidates([tender], "2026-10-27", () => 6)).toEqual([]);
    expect(returnablesWindowCandidates([tender], "2026-10-27", () => 0)).toEqual([]);
    expect(returnablesWindowCandidates([tender], "2026-10-27", () => -1)).toEqual([]); // already closed
  });
});
