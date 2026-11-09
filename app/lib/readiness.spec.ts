import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeBidReadiness, type ReadinessInput } from "./readiness";

// Frozen, unambiguous instant - safely mid-day in both UTC and SAST (SAST =
// UTC+2), nowhere near either timezone's own midnight - not the ambient wall
// clock. Previously daysFromToday() below built its "N days from today"
// fixture off the real host clock's own local (effectively UTC, no TZ env
// set) calendar day, while computeBidReadiness()'s underlying daysUntil()
// computes "today" as the real SAST calendar day; those two disagree by
// exactly one day during the real 00:00-02:00 SAST window, making these
// tests genuinely flaky at that hour regardless of any code change. Freezing
// the clock (both the fixture dates below AND the function-under-test's own
// ambient `new Date()` call, via the beforeEach/afterEach pair) to one
// instant where UTC-today and SAST-today are the same calendar day makes the
// day-count unambiguous at any real wall-clock time.
const FROZEN_NOW = new Date("2026-06-15T10:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/** "N days from today" as a plain YYYY-MM-DD date string - matches how a date column (not a timestamp) is actually stored, and matches daysUntil()'s own midnight-normalized "today" so the day count is exact regardless of the time this test happens to run. */
function daysFromToday(n: number): string {
  const d = new Date(FROZEN_NOW);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
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

  // Standing review, 2026-11-09 (Finding 240's own sibling, same pass):
  // tax_compliance/bee/cidb each used to go "missing" whenever only the
  // document was on file but the text/level/grading field hadn't also been
  // captured - disagreeing with lib/vaultDocuments.ts's sarsTcsPinOnFile()
  // and ComplianceDocumentsSection.tsx's own established per-field hasFile
  // rules for the exact same columns. These three cases are each the
  // minimal real-world shape that bug mishandled.
  it("tax_compliance is satisfied from a document path alone (PIN text and expiry both still empty)", () => {
    const result = computeBidReadiness({ ...EMPTY, taxPinDocumentPath: "co/vault/sars_tcs_pin/letter.pdf" });
    const taxCompliance = result.criteria.find((c) => c.key === "tax_compliance")!;
    expect(taxCompliance.satisfied).toBe(true);
    expect(taxCompliance.reason).toBeUndefined();
  });

  it("bee is satisfied from a document path alone (no bee_level set)", () => {
    const result = computeBidReadiness({ ...EMPTY, beeProofDocumentPath: "co/vault/bee_proof/cert.pdf" });
    const bee = result.criteria.find((c) => c.key === "bee")!;
    expect(bee.satisfied).toBe(true);
  });

  it("cidb is satisfied from a document path alone (no cidb_grading set)", () => {
    const result = computeBidReadiness({ ...EMPTY, cidbDocumentPath: "co/vault/cidb/cert.pdf" });
    const cidb = result.criteria.find((c) => c.key === "cidb")!;
    expect(cidb.satisfied).toBe(true);
  });

  it("omitting the new document-path fields entirely (the one caller - lib/customerRowData.ts's admin RPC - that can't supply them yet) behaves exactly as before: never a false pass", () => {
    const result = computeBidReadiness(EMPTY); // EMPTY has no taxPinDocumentPath/beeProofDocumentPath/cidbDocumentPath keys at all
    expect(result.percent).toBe(0);
    expect(result.criteria.find((c) => c.key === "tax_compliance")!.satisfied).toBe(false);
    expect(result.criteria.find((c) => c.key === "bee")!.satisfied).toBe(false);
    expect(result.criteria.find((c) => c.key === "cidb")!.satisfied).toBe(false);
  });

  // Standing review, 2026-11-09: bank_confirmation is the SAME Finding
  // 240/241 "no date yet" vs "nothing at all" conflation, a 4th instance -
  // bankConfirmationValidUntil is a GENERATED column (letter date + 3
  // months) that stays null whenever uploadVaultDocument() has written the
  // path but the date was never typed in (the real, reachable upload path,
  // not a hypothetical one - app/app/company/actions.ts's generic vault
  // uploader only ever writes the path column).
  it("bank_confirmation is satisfied from a document path alone (letter date and valid_until both still null)", () => {
    const result = computeBidReadiness({ ...EMPTY, bankConfirmationLetterPath: "co/vault/bank_letter/fnb.pdf" });
    const bank = result.criteria.find((c) => c.key === "bank_confirmation")!;
    expect(bank.satisfied).toBe(true);
    expect(bank.reason).toBeUndefined();
  });

  it("bank_confirmation is satisfied from the letter date alone (valid_until not pre-computed in this input)", () => {
    const result = computeBidReadiness({ ...EMPTY, bankConfirmationLetterDate: daysFromToday(-10) });
    const bank = result.criteria.find((c) => c.key === "bank_confirmation")!;
    expect(bank.satisfied).toBe(true);
  });

  it("bank_confirmation still goes missing with neither the letter nor a valid_until date on file", () => {
    const result = computeBidReadiness(EMPTY);
    const bank = result.criteria.find((c) => c.key === "bank_confirmation")!;
    expect(bank.satisfied).toBe(false);
    expect(bank.reason).toBe("missing");
  });

  it("bank_confirmation still goes expired when valid_until is a real, past date - a document path alone doesn't override a genuinely expired letter", () => {
    const result = computeBidReadiness({
      ...EMPTY,
      bankConfirmationLetterPath: "co/vault/bank_letter/fnb.pdf",
      bankConfirmationValidUntil: daysFromToday(-5),
    });
    const bank = result.criteria.find((c) => c.key === "bank_confirmation")!;
    expect(bank.satisfied).toBe(false);
    expect(bank.reason).toBe("expired");
  });

  it("omitting bankConfirmationLetterPath/Date entirely (every caller not yet updated) behaves exactly as before: bankConfirmationValidUntil alone still decides it", () => {
    const result = computeBidReadiness(FULL); // FULL sets bankConfirmationValidUntil only, no path/date fields at all
    const bank = result.criteria.find((c) => c.key === "bank_confirmation")!;
    expect(bank.satisfied).toBe(true);
    expect(result.percent).toBe(100);
  });
});
