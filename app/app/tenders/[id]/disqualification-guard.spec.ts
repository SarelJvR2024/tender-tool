import { describe, expect, it, vi } from "vitest";

// disqualificationGuardRows() is the pure extraction (standing review
// finding, originally flagged 2026-10-27, closed out this pass) behind
// DisqualificationGuard()'s own fixCount - and now also behind
// lib/dispatchDashboard.ts's loadDispatchCards(), which previously used
// tenderNextStep.ts's much broader nextStepFor() signal in its place (true
// for ANY open Provide/Verify item, not just a genuine Fix) for
// deriveDecisionNeeded()'s hasRealFixBlocker, over-triggering
// director_resolution on routine work. This file is the first dedicated
// test coverage for either the Guard's own row logic or that caller.
//
// @/lib/supabase/server is mocked (same convention as narrative-actions.spec.ts
// and its own precedents) only so the real compliance-data.ts/
// submission-plan-data.ts module imports resolve at all under vitest -
// disqualificationGuardRows() itself does no I/O and never calls createClient().
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

import { disqualificationGuardRows, type GuardRow } from "./disqualification-guard.tsx";

type Compliance = Parameters<typeof disqualificationGuardRows>[0]["compliance"];
type Plan = Parameters<typeof disqualificationGuardRows>[0]["plan"];

function sanralCompliance(overrides: { docItems?: unknown[]; positionRows?: unknown[] } = {}): Compliance {
  return {
    mapped: true,
    docItems: overrides.docItems ?? [],
    positionRows: overrides.positionRows ?? [],
  } as unknown as Compliance;
}

function generalPlan(steps: unknown[]): Plan {
  return { mapped: true, steps } as unknown as Plan;
}

describe("disqualificationGuardRows", () => {
  it("SANRAL: a mandatory doc item that's only unconfirmed ('check'), not missing, is Fix - classifyComplianceItem's own rule", () => {
    const { mapped, rows } = disqualificationGuardRows({
      isSanralFamily: true,
      isGeneralFamily: false,
      compliance: sanralCompliance({
        docItems: [{ key: "tax", form: "A9", label: "Tax", status: "check", mandatory: true, detail: "" }],
      }),
      plan: null,
    });
    expect(mapped).toBe(true);
    expect(rows.find((r) => r.label.startsWith("Tax"))?.status).toBe("fix");
  });

  it("SANRAL: a NON-mandatory missing doc item is Provide, never Fix - the exact case that used to false-trigger director_resolution via nextStepFor()'s broader signal", () => {
    const { rows } = disqualificationGuardRows({
      isSanralFamily: true,
      isGeneralFamily: false,
      compliance: sanralCompliance({
        docItems: [{ key: "bbbee", form: "A12", label: "B-BBEE", status: "missing", mandatory: false, detail: "" }],
      }),
      plan: null,
    });
    const fixCount = rows.filter((r) => r.status === "fix").length;
    expect(fixCount).toBe(0);
    expect(rows.find((r) => r.label.startsWith("B-BBEE"))?.status).toBe("provide");
  });

  it("SANRAL: an unconfirmed key position with a person already assigned is Provide, not Fix (only a genuinely unfilled position is Fix)", () => {
    const { rows } = disqualificationGuardRows({
      isSanralFamily: true,
      isGeneralFamily: false,
      compliance: sanralCompliance({
        positionRows: [{ person: { id: "p1" }, cv: null, tenderCv: null }],
      }),
      plan: null,
    });
    expect(rows.find((r) => r.label === "Key personnel CVs")?.status).toBe("provide");
    expect(rows.filter((r) => r.status === "fix").length).toBe(0);
  });

  it("general family: a role step merely flagged 'provide' is Provide, not Fix", () => {
    const { mapped, rows } = disqualificationGuardRows({
      isSanralFamily: false,
      isGeneralFamily: true,
      compliance: null,
      plan: generalPlan([
        { id: "returnable:tax_compliance", category: "returnable", bidTaskStatus: "provide", note: "" },
        { id: "role-1", category: "role", bidTaskStatus: "provide", note: "", title: "Site Agent" },
      ]),
    });
    expect(mapped).toBe(true);
    expect(rows.filter((r) => r.status === "fix").length).toBe(0);
  });

  it("general family: a role step flagged 'fix' IS a real Fix", () => {
    const { rows } = disqualificationGuardRows({
      isSanralFamily: false,
      isGeneralFamily: true,
      compliance: null,
      plan: generalPlan([{ id: "role-1", category: "role", bidTaskStatus: "fix", note: "", title: "Site Agent" }]),
    });
    expect(rows.filter((r) => r.status === "fix").length).toBe(1);
  });

  it("neither family mapped (e.g. RRM) or no data at all: mapped false, zero rows, zero fix", () => {
    expect(disqualificationGuardRows({ isSanralFamily: false, isGeneralFamily: false, compliance: null, plan: null })).toEqual({
      mapped: false,
      rows: [],
    });
    expect(
      disqualificationGuardRows({ isSanralFamily: true, isGeneralFamily: false, compliance: null, plan: null }),
    ).toEqual({ mapped: false, rows: [] });
  });

  it("a fully clean SANRAL tender (everything confirmed) is mapped with zero Fix rows", () => {
    const { mapped, rows } = disqualificationGuardRows({
      isSanralFamily: true,
      isGeneralFamily: false,
      compliance: sanralCompliance({
        docItems: [{ key: "tax", form: "A9", label: "Tax", status: "have", mandatory: true, detail: "" }],
      }),
      plan: null,
    });
    expect(mapped).toBe(true);
    const rowsTyped = rows as GuardRow[];
    expect(rowsTyped.filter((r) => r.status === "fix").length).toBe(0);
  });
});
