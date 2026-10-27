import { describe, expect, it } from "vitest";
import { calculateSavingsEstimate } from "./savingsEstimateCalculator";

describe("calculateSavingsEstimate - the task's own worked example (2 tenders/mo, 20h/tender, R450/h)", () => {
  const estimate = calculateSavingsEstimate({ tendersPerMonth: 2, hoursPerTender: 20, hourlyRate: 450 });

  it("saves 75% of baseline hours per tender, rounded", () => {
    expect(estimate.adminHoursSavedPerTender).toBe(15); // 20 * 0.75 = 15
  });

  it("computes monthly and annual hours saved", () => {
    expect(estimate.monthlyHoursSaved).toBe(30); // 2 * 15
    expect(estimate.annualHoursSaved).toBe(360); // 30 * 12
  });

  it("computes monthly and annual Rand saved", () => {
    expect(estimate.monthlyRandSaved).toBe(13_500); // 30 * 450
    expect(estimate.annualRandSaved).toBe(162_000); // 360 * 450
  });

  it("computes extra tender capacity from freed-up hours relative to baseline effort", () => {
    expect(estimate.monthlyExtraCapacity).toBe(1.5); // 30 / 20
    expect(estimate.annualExtraCapacity).toBe(18); // round(1.5 * 12)
  });
});

describe("calculateSavingsEstimate - annual figures can never contradict monthly ones", () => {
  it.each([
    { tendersPerMonth: 2, hoursPerTender: 20, hourlyRate: 450 },
    { tendersPerMonth: 1, hoursPerTender: 8, hourlyRate: 300 },
    { tendersPerMonth: 5, hoursPerTender: 35, hourlyRate: 650 },
    { tendersPerMonth: 3, hoursPerTender: 12, hourlyRate: 500 },
    { tendersPerMonth: 7, hoursPerTender: 6, hourlyRate: 900 },
  ])("annualExtraCapacity === round(monthlyExtraCapacity * 12) for %o", (inputs) => {
    const estimate = calculateSavingsEstimate(inputs);
    expect(estimate.annualExtraCapacity).toBe(Math.round(estimate.monthlyExtraCapacity * 12));
  });

  it.each([
    { tendersPerMonth: 2, hoursPerTender: 20, hourlyRate: 450 },
    { tendersPerMonth: 1, hoursPerTender: 8, hourlyRate: 300 },
    { tendersPerMonth: 5, hoursPerTender: 35, hourlyRate: 650 },
  ])("annualHoursSaved === monthlyHoursSaved * 12 for %o", (inputs) => {
    const estimate = calculateSavingsEstimate(inputs);
    expect(estimate.annualHoursSaved).toBe(estimate.monthlyHoursSaved * 12);
  });

  it.each([
    { tendersPerMonth: 2, hoursPerTender: 20, hourlyRate: 450 },
    { tendersPerMonth: 4, hoursPerTender: 18, hourlyRate: 375 },
  ])("annualRandSaved === annualHoursSaved * hourlyRate for %o", (inputs) => {
    const estimate = calculateSavingsEstimate(inputs);
    expect(estimate.annualRandSaved).toBe(estimate.annualHoursSaved * inputs.hourlyRate);
  });
});

describe("calculateSavingsEstimate - guards against NaN/Infinity on edge inputs", () => {
  it("returns an all-zero estimate when hoursPerTender is 0, not NaN/Infinity", () => {
    const estimate = calculateSavingsEstimate({ tendersPerMonth: 2, hoursPerTender: 0, hourlyRate: 450 });
    expect(estimate.adminHoursSavedPerTender).toBe(0);
    expect(estimate.monthlyExtraCapacity).toBe(0);
    expect(estimate.annualExtraCapacity).toBe(0);
    for (const value of Object.values(estimate)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("returns an all-zero estimate when tendersPerMonth is 0", () => {
    const estimate = calculateSavingsEstimate({ tendersPerMonth: 0, hoursPerTender: 20, hourlyRate: 450 });
    expect(estimate.monthlyHoursSaved).toBe(0);
    expect(estimate.annualHoursSaved).toBe(0);
    expect(estimate.monthlyRandSaved).toBe(0);
    expect(estimate.monthlyExtraCapacity).toBe(0);
    expect(estimate.annualExtraCapacity).toBe(0);
  });

  it("treats a negative input as zero rather than letting any figure go negative", () => {
    const estimate = calculateSavingsEstimate({ tendersPerMonth: -3, hoursPerTender: -10, hourlyRate: -450 });
    for (const value of Object.values(estimate)) {
      expect(value).toBe(0);
    }
  });

  it("never produces NaN across a spread of realistic and boundary inputs", () => {
    const cases = [
      { tendersPerMonth: 0, hoursPerTender: 0, hourlyRate: 0 },
      { tendersPerMonth: 100, hoursPerTender: 200, hourlyRate: 10_000 },
      { tendersPerMonth: 0.5, hoursPerTender: 7, hourlyRate: 325 },
    ];
    for (const inputs of cases) {
      const estimate = calculateSavingsEstimate(inputs);
      for (const value of Object.values(estimate)) {
        expect(Number.isNaN(value)).toBe(false);
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
