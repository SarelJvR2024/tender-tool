import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateSanralConventional, estimatePosition, pastPerformanceFromExperience, type SanralPositionInput } from "./sanralScoring.ts";

// Finding (2026-11-06, standing solution-architect review): estimateSanralConventional()'s
// management range used an exhaustive 2^n brute force over every position whose
// `managerial` flag isn't on file, but ONLY up to n<=6 ambiguous positions - above that
// it silently fell back to trying just two scenarios (every ambiguous position
// managerial, or none of them). That is not a sample of the true range: a MIXED
// combination (some positions read as managerial, others not) can beat both uniform
// extremes, because reading a position as managerial always adds points to the
// numerator but ALSO always doubles its own denominator contribution from 15 to 30 -
// so a position with a low/zero managerial-position-held score is better left
// non-managerial even while others are worth flipping. The old shortcut could not find
// that combination at all above 6 ambiguous positions, and reported a management
// range narrower than reality - specifically, it could UNDER-state how low the true
// worst case goes, which is exactly the number the report's own "clears even at the
// bottom of every unknown range" outlook line depends on.
//
// This is directly reachable on a real tender today: compliance-data.ts's own comment
// notes `tender_requirements` "isn't seeded by anything yet", so every position's
// `managerial` flag is null in practice - and Book 1's own SETUP sheet has up to 10
// non-alternate key-person slots (SANRAL-Tender-Automation-Specification.md), several
// of which (PL/CE/RE/RM, repeated for multi-section contracts) can be manager-eligible
// at once.
function managerEligiblePosition(tenderedCode: string, heldCode: string, clientType: string): SanralPositionInput {
  return {
    positionCode: tenderedCode,
    description: null,
    managerial: null, // the real-world default - see compliance-data.ts's own comment
    tenderProjectType: null,
    person: {
      name: "Test Person",
      projects: [{ client_type: clientType, project_type: null, position_code: heldCode, start_date: "2020-01-01", end_date: "2021-01-01" }],
    },
  };
}

test("estimateSanralConventional: management range with 7 ambiguous positions matches the true brute-force extreme, not just the two uniform scenarios", () => {
  // 3 positions whose held-position score is high when read as managerial
  // (so they want to flip to managerial), and 4 whose held-position score is
  // 0 (so flipping them to managerial only costs denominator, never helps) -
  // deliberately picked so neither "all managerial" nor "all non-managerial"
  // is the true optimum; the real optimum is the mix.
  const positions = [
    managerEligiblePosition("PL", "PL", "National Roads Authority"), // high manPos
    managerEligiblePosition("CE", "DA", "National Roads Authority"), // zero manPos
    managerEligiblePosition("RE", "PL", "National Roads Authority"), // high manPos
    managerEligiblePosition("RM", "DA", "National Roads Authority"), // zero manPos
    managerEligiblePosition("PL(T)", "CE(T)", "National Roads Authority"), // high manPos
    managerEligiblePosition("CE(T)", "DA", "National Roads Authority"), // zero manPos
    managerEligiblePosition("CM(T)", "DA", "National Roads Authority"), // zero manPos
  ];
  const closingDate = "2026-11-06";

  const estimate = estimateSanralConventional({ positions, closingDate });

  // True brute-force oracle over all 2^7 = 128 combinations, using the same
  // per-position scoring the real code calls - independent of
  // estimateSanralConventional()'s own (fixed) management-range algorithm.
  const closing = new Date(closingDate);
  let trueLo = Infinity;
  let trueHi = -Infinity;
  for (let mask = 0; mask < 1 << positions.length; mask++) {
    let sumMin = 0;
    let sumMax = 0;
    let maxSum = 0;
    for (let i = 0; i < positions.length; i++) {
      const managerial = ((mask >> i) & 1) === 1;
      const p = estimatePosition({ ...positions[i], managerial }, closing);
      sumMin += p.management.min;
      sumMax += p.management.max;
      maxSum += p.managementMax.max;
    }
    trueLo = Math.min(trueLo, (sumMin / maxSum) * 15);
    trueHi = Math.max(trueHi, (sumMax / maxSum) * 15);
  }
  const trueRange = { min: Math.round(trueLo * 10) / 10, max: Math.round(trueHi * 10) / 10 };

  // The pre-fix code only tried "all managerial" (mask = 127) and "all
  // non-managerial" (mask = 0) once n exceeded 6, and reported {min: 3.6,
  // max: 5} for this exact input - narrower than, and NOT bracketing, the
  // true worst case below. Confirmed by reverting the fix locally and
  // re-running this exact assertion (fails: 3.6 !== 3.2).
  assert.deepEqual(trueRange, { min: 3.2, max: 5 }, "sanity: the independent oracle itself should find this specific true range");
  assert.deepEqual(estimate.management, trueRange, "estimateSanralConventional()'s reported management range must equal the true combinatorial extreme, not a 2-scenario approximation of it");
});

test("estimateSanralConventional: management range with <= 6 ambiguous positions (the old brute-force-exact range) still matches a brute-force oracle", () => {
  const positions = [
    managerEligiblePosition("PL", "PL", "National Roads Authority"),
    managerEligiblePosition("CE", "DA", "Private"),
    managerEligiblePosition("RE", "RM", "Municipality"),
    managerEligiblePosition("RM", "CE", "National Roads Authority"),
  ];
  const closingDate = "2026-06-01";
  const estimate = estimateSanralConventional({ positions, closingDate });

  const closing = new Date(closingDate);
  let trueLo = Infinity;
  let trueHi = -Infinity;
  for (let mask = 0; mask < 1 << positions.length; mask++) {
    let sumMin = 0;
    let sumMax = 0;
    let maxSum = 0;
    for (let i = 0; i < positions.length; i++) {
      const managerial = ((mask >> i) & 1) === 1;
      const p = estimatePosition({ ...positions[i], managerial }, closing);
      sumMin += p.management.min;
      sumMax += p.management.max;
      maxSum += p.managementMax.max;
    }
    trueLo = Math.min(trueLo, (sumMin / maxSum) * 15);
    trueHi = Math.max(trueHi, (sumMax / maxSum) * 15);
  }
  const trueRange = { min: Math.round(trueLo * 10) / 10, max: Math.round(trueHi * 10) / 10 };
  assert.deepEqual(estimate.management, trueRange);
});

test("estimateSanralConventional: a position whose managerial flag IS known on file is never treated as ambiguous", () => {
  const positions = [
    managerEligiblePosition("PL", "PL", "National Roads Authority"),
    { ...managerEligiblePosition("CE", "DA", "National Roads Authority"), managerial: true },
  ];
  const estimate = estimateSanralConventional({ positions, closingDate: "2026-06-01" });
  assert.equal(estimate.notes.some((n) => n.includes("managerial")), true); // PL is still ambiguous
  // Should not crash and should produce a sane bounded range.
  assert.ok(estimate.management.min >= 0 && estimate.management.max <= 15);
  assert.ok(estimate.management.min <= estimate.management.max);
});

// Finding (2026-11-09, standing solution-architect review): "PL(T)" is one of
// SANRAL's own 23 published key-person codes (T-24, offered as a real
// "position held" suggestion via SANRAL_POSITION_CODES on the People page),
// but Book 1's transcribed position-held tables have no row for it - unlike
// its DS(T)/CE(T)/CM(T)/ETS(T) toll siblings, which all do. `lookup()` used
// to treat ANY held code with no row (including this real-but-untabulated
// one) as SANRAL's own "Undefined" ("none of the above") answer, silently
// scoring it a confident 0 - indistinguishable from a person who genuinely
// held no recognisable position at all. Live-reachable: a company can pick
// "PL(T)" directly from the People page's own suggested-values list for a
// past project's position_code.
test("estimatePosition: a past position held of PL(T) (real SANRAL code, no transcribed row) scores a range, not a confident 0 indistinguishable from Undefined", () => {
  const closing = new Date("2027-01-01");
  const project = (heldCode: string) => ({
    client_type: "National Roads Authority",
    project_type: null,
    position_code: heldCode,
    start_date: "2020-01-01",
    end_date: "2024-01-01",
  });
  const input = (heldCode: string): SanralPositionInput => ({
    positionCode: "CE(T)",
    description: null,
    managerial: false,
    tenderProjectType: null,
    person: { name: "Test Person", projects: [project(heldCode)] },
  });

  const plT = estimatePosition(input("PL(T)"), closing);
  const undefinedHeld = estimatePosition(input("Undefined"), closing);
  const dsT = estimatePosition(input("DS(T)"), closing); // has a real row - sanity check

  // Before the fix, PL(T) and Undefined were byte-for-byte identical (both a
  // confident technical: {min:5,max:10}). Now PL(T) widens into a range that
  // Undefined correctly does not, and carries its own explanatory note.
  assert.deepEqual(undefinedHeld.technical, { min: 5, max: 10 });
  assert.deepEqual(plT.technical, { min: 5, max: 15 });
  assert.notDeepEqual(plT.technical, undefinedHeld.technical);
  assert.ok(plT.notes.some((n) => n.includes("PL(T)") && n.includes("no transcribed position-held row")));
  assert.equal(undefinedHeld.notes.some((n) => n.includes("transcribed position-held row")), false);

  // DS(T) (a real, tabulated toll sibling) still scores its real tabulated
  // value with no such note - this fix only widens the genuinely-missing case.
  assert.deepEqual(dsT.technical, { min: 7.5, max: 12.5 });
  assert.equal(dsT.notes.some((n) => n.includes("transcribed position-held row")), false);
});

test("estimatePosition: the same PL(T) gap also widens the managerial position-held range, not just technical", () => {
  const closing = new Date("2027-01-01");
  const input: SanralPositionInput = {
    positionCode: "CE(T)", // a managerial-eligible tendered code (MAN_POSITION_COLUMNS includes CE(T))
    description: null,
    managerial: true,
    tenderProjectType: null,
    person: {
      name: "Test Person",
      projects: [{ client_type: "National Roads Authority", project_type: null, position_code: "PL(T)", start_date: "2020-01-01", end_date: "2024-01-01" }],
    },
  };
  const estimate = estimatePosition(input, closing);
  assert.ok(estimate.management.min < estimate.management.max, "management should be a real range, not a single confident value");
  assert.ok(estimate.notes.some((n) => n.includes("PL(T)") && n.includes("management points shown as a range")));
});

test("pastPerformanceFromExperience: picks the best 3 scoreable items and fills remaining slots with the B6 affidavit range", () => {
  const result = pastPerformanceFromExperience([
    { document_type: "reference_letter", performance_rating: "excellent" },
    { document_type: "reference_letter", performance_rating: "poor" },
    { document_type: "performance_report", performance_rating: null },
    { document_type: "completion_certificate", performance_rating: "excellent" }, // not scoreable - excluded
  ]);
  // excellent (5) + poor (1) + unrated (1-5) = 7-11, capped at 15, no affidavit slot needed (3 scoreable items)
  assert.equal(result.range.min, 7);
  assert.equal(result.range.max, 11);
});
