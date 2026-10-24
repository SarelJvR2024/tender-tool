import { describe, expect, it } from "vitest";
import { printCutoffCandidates, PRINT_CUTOFF_THRESHOLD_HOURS, type PrintCutoffTenderPackRow, type PrintCutoffTenderRow } from "./printCutoffReminders";

const tender: PrintCutoffTenderRow = { id: "tender-1", contract_no: "SANRAL/1234", description: null, closing_date: "2026-11-10T12:00:00+02:00" };

function pack(overrides: Partial<PrintCutoffTenderPackRow> = {}): PrintCutoffTenderPackRow {
  return {
    id: "pack-1",
    tender_id: "tender-1",
    company_id: "company-a",
    pipeline_stage: "assessing",
    submission_type: "physical_box",
    estimated_print_hours: 4,
    estimated_transit_hours: 2,
    dispatch_status: "not_ready",
    ...overrides,
  };
}

describe("printCutoffCandidates", () => {
  const tendersById = new Map([["tender-1", tender]]);

  it("fires once hours-remaining drops to the 48h threshold or below", () => {
    // Cutoff = closing (2026-11-10T12:00+02:00) - 6h = 06:00. 47h before that is 2026-11-08T07:00+02:00.
    const now = new Date("2026-11-08T07:00:00+02:00");
    const candidates = printCutoffCandidates([pack()], tendersById, now);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].hoursLeft).toBeLessThanOrEqual(PRINT_CUTOFF_THRESHOLD_HOURS);
  });

  it("does nothing while still well outside the window", () => {
    const farOut = new Date("2026-10-01T00:00:00+02:00");
    expect(printCutoffCandidates([pack()], tendersById, farOut)).toEqual([]);
  });

  it("never fires for a digital submission - no print/transit buffer applies", () => {
    const now = new Date("2026-11-10T11:00:00+02:00");
    expect(printCutoffCandidates([pack({ submission_type: "etenders_portal" })], tendersById, now)).toEqual([]);
  });

  it("never fires once the tender has reached a closed pipeline stage", () => {
    const now = new Date("2026-11-10T11:00:00+02:00");
    expect(printCutoffCandidates([pack({ pipeline_stage: "submitted" })], tendersById, now)).toEqual([]);
    expect(printCutoffCandidates([pack({ pipeline_stage: "won" })], tendersById, now)).toEqual([]);
    expect(printCutoffCandidates([pack({ pipeline_stage: "lost" })], tendersById, now)).toEqual([]);
  });

  it("a pack whose tender isn't in the map (deleted/unjoined) is skipped, not a crash", () => {
    const now = new Date("2026-11-10T11:00:00+02:00");
    expect(printCutoffCandidates([pack({ tender_id: "missing" })], tendersById, now)).toEqual([]);
  });

  it("one candidate per tender_packs row, independently - two companies on the same tender both surface", () => {
    const now = new Date("2026-11-10T05:00:00+02:00"); // just before the 06:00 cutoff
    const candidates = printCutoffCandidates(
      [pack({ id: "pack-a", company_id: "company-a" }), pack({ id: "pack-b", company_id: "company-b", estimated_print_hours: 8 })],
      tendersById,
      now
    );
    expect(candidates.map((c) => c.pack.company_id).sort()).toEqual(["company-a", "company-b"]);
  });
});
