import { describe, expect, it } from "vitest";
import { computeBidReadiness, type ReadinessInput } from "./readiness";

/** "N days from today" as a plain YYYY-MM-DD date string - matches how a date column (not a timestamp) is actually stored, and matches daysUntil()'s own midnight-normalized "today" so the day count is exact regardless of the time this test happens to run. */
function daysFromToday(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const EMPTY: ReadinessInput = {
  legalName: null,
  csdSupplierNumber: null,
  taxPin: null,
  taxPinExpiry: null,
  beeLevel: null,
  beeProofExpiry: null,
  cidbGrading: null,
  cidbExpiry: null,
  bankConfirmationValidUntil: null,
  principalCount: 0,
  peopleWithCvCount: 0,
  experienceProjectCount: 0,
};

const FULL: ReadinessInput = {
  legalName: "Acme Civils (Pty) Ltd",
  csdSupplierNumber: "MAAA1234567",
  taxPin: "1234567890",
  taxPinExpiry: daysFromToday(200),
  beeLevel: 2,
  beeProofExpiry: daysFromToday(200),
  cidbGrading: "7CE",
  cidbExpiry: daysFromToday(200),
  bankConfirmationValidUntil: daysFromToday(60),
  principalCount: 1,
  peopleWithCvCount: 2,
  experienceProjectCount: 3,
};

describe("computeBidReadiness", () => {
  it("scores an empty company at 0", () => {
    const result = computeBidReadiness(EMPTY);
    expect(result.percent).toBe(0);
    expect(result.blockers).toHaveLength(result.criteria.length);
  });

  it("scores a fully-on-file company at 100", () => {
    const result = computeBidReadiness(FULL);
    expect(result.percent).toBe(100);
    expect(result.blockers).toHaveLength(0);
  });

  it("an expired B-BBEE certificate removes exactly 15 points, nothing else", () => {
    const result = computeBidReadiness({ ...FULL, beeProofExpiry: daysFromToday(-5) });
    expect(result.percent).toBe(85);
    const bee = result.criteria.find((c) => c.key === "bee")!;
    expect(bee.satisfied).toBe(false);
    expect(bee.reason).toBe("expired");
    // Every other criterion is still satisfied - the penalty is isolated to BEE.
    for (const c of result.criteria) {
      if (c.key !== "bee") expect(c.satisfied).toBe(true);
    }
  });

  it("a document expiring in 10 days (inside the 14-day window) is flagged as a blocker, not current", () => {
    const result = computeBidReadiness({ ...FULL, cidbExpiry: daysFromToday(10) });
    const cidb = result.criteria.find((c) => c.key === "cidb")!;
    expect(cidb.satisfied).toBe(false);
    expect(cidb.reason).toBe("expiring_soon");
    expect(cidb.daysLeft).toBe(10);
    expect(result.blockers.some((b) => b.key === "cidb")).toBe(true);
    expect(result.percent).toBe(85);
  });

  it("a document expiring in 15 days (just outside the 14-day window) still counts as current", () => {
    const result = computeBidReadiness({ ...FULL, cidbExpiry: daysFromToday(15) });
    const cidb = result.criteria.find((c) => c.key === "cidb")!;
    expect(cidb.satisfied).toBe(true);
    expect(result.percent).toBe(100);
  });

  it("blockers are sorted by weight, highest first", () => {
    const result = computeBidReadiness(EMPTY);
    const weights = result.blockers.map((b) => b.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
  });
});
