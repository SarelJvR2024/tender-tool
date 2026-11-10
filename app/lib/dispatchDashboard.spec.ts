import { describe, expect, it, vi } from "vitest";

// Standing review finding, originally flagged 2026-10-27, closed out this
// pass: loadDispatchCards() set deriveDecisionNeeded()'s own
// `hasRealFixBlocker` from `!!blockingStep` - tenderNextStep.ts's
// nextStepFor(), "the one concrete, unfinished thing for this tender's
// pack" (its own docstring), which is non-null for routine Provide/Verify
// gaps too, not only a genuine Disqualification Guard "Fix" item. First
// dedicated test coverage for this file.
vi.mock("./tenderNextStep", () => ({ nextStepFor: vi.fn() }));
vi.mock("@/app/tenders/[id]/compliance-data", () => ({ loadTenderCompliance: vi.fn() }));
vi.mock("@/app/tenders/[id]/submission-plan-data", () => ({ loadSubmissionPlan: vi.fn() }));

import { loadDispatchCards, type ActiveBidInput } from "./dispatchDashboard";
import { nextStepFor } from "./tenderNextStep";
import { loadTenderCompliance } from "@/app/tenders/[id]/compliance-data";
import { SANRAL_CONVENTIONAL_FAMILY } from "./tenderCompliance";

const mockedNextStepFor = nextStepFor as unknown as ReturnType<typeof vi.fn>;
const mockedLoadTenderCompliance = loadTenderCompliance as unknown as ReturnType<typeof vi.fn>;

function fakeSupabase() {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "in", "eq"]) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (r: { data: unknown[]; error: null }) => void) =>
    resolve({ data: [], error: null });
  return { from: () => chain } as unknown as Parameters<typeof loadDispatchCards>[1];
}

const now = new Date("2026-11-10T08:00:00+02:00");

const baseBid: ActiveBidInput = {
  tenderId: "tender-1",
  tenderPackId: "pack-1",
  contractNo: "N.007-030",
  description: null,
  buyer: "SANRAL",
  // 3 days out - inside deriveDecisionNeeded()'s own 7-day director_resolution
  // window AND loadDispatchCards()'s 14-day deep-check window.
  closingDate: "2026-11-13T11:00:00+02:00",
  family: SANRAL_CONVENTIONAL_FAMILY,
  briefingDate: null,
  briefingTime: null,
  submissionType: "etenders_portal",
  deliveryLocation: null,
  estimatedPrintHours: 0,
  estimatedTransitHours: 0,
  dispatchStatus: "not_ready",
  courierContact: null,
  pipelineStage: "building",
};

describe("loadDispatchCards - director_resolution only on a REAL Fix item, not any open next-step", () => {
  it("a routine, non-mandatory next step (Provide-class) closing within 7 days does NOT escalate to director_resolution", async () => {
    // The exact mechanism: nextStepFor() returns a real, non-null step (a
    // key position still needing a person confirmed) while the Guard's own
    // real compliance data has no mandatory gap at all - pre-fix, the mere
    // presence of ANY next step alone used to be enough.
    mockedNextStepFor.mockResolvedValue({ label: "Confirm key person: PL", href: "/tenders/tender-1#key-positions" });
    mockedLoadTenderCompliance.mockResolvedValue({
      mapped: true,
      docItems: [{ key: "tax", form: "A9", label: "Tax", status: "have", mandatory: true, detail: "" }],
      // A position with a person already confirmed but no CV yet on file -
      // real nextStepFor() production code (compliance-data.ts's own
      // packReadiness()) would surface this as "unfilledPositions" too, but
      // it is a Provide item (someone just needs to attach a CV), not a Fix
      // (nobody assigned at all) - confirmed against disqualification-guard.tsx's
      // own `noPerson` distinction.
      positionRows: [{ person: { id: "p1" }, cv: null, tenderCv: null }],
    });

    const cards = await loadDispatchCards([baseBid], fakeSupabase(), now);
    expect(cards).toHaveLength(1);
    expect(cards[0].decisionNeeded).not.toBe("director_resolution");
    expect(cards[0].decisionNeeded).toBe("none");
    // blockingSummary (the dashboard's own display text) is UNCHANGED by
    // this fix - still shows the real next step, just no longer treated as
    // a Fix-grade escalation signal.
    expect(cards[0].blockingSummary).toBe("Confirm key person: PL");
  });

  it("a GENUINE Fix item (no key person assigned at all) closing within 7 days DOES escalate to director_resolution", async () => {
    mockedNextStepFor.mockResolvedValue({ label: "Confirm key person: PL", href: "/tenders/tender-1#key-positions" });
    mockedLoadTenderCompliance.mockResolvedValue({
      mapped: true,
      docItems: [],
      positionRows: [{ person: null, cv: null, tenderCv: null }],
    });

    const cards = await loadDispatchCards([baseBid], fakeSupabase(), now);
    expect(cards[0].decisionNeeded).toBe("director_resolution");
  });

  it("no pack yet (nextStepFor's broadest non-fix case) does not escalate, even though blockingSummary is non-null", async () => {
    mockedNextStepFor.mockResolvedValue({ label: "Start the submission pack", href: "/tenders/tender-1" });
    mockedLoadTenderCompliance.mockResolvedValue(null);

    const cards = await loadDispatchCards([{ ...baseBid, tenderPackId: "" }], fakeSupabase(), now);
    expect(cards[0].decisionNeeded).toBe("none");
    expect(cards[0].blockingSummary).toBe("Start the submission pack");
  });
});
