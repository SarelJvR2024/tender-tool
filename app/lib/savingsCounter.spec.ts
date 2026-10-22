import { describe, expect, it } from "vitest";
import {
  aggregateSavings,
  extraCapacity,
  formatRand,
  hoursSavedForTender,
  resolveBaseline,
  stepAlreadyCounted,
} from "./savingsCounter";

describe("hoursSavedForTender - baseline cap (§9.2: hours saved per tender ≤ company baseline)", () => {
  it("sums raw step hours when under the baseline", () => {
    expect(hoursSavedForTender([2, 3, 4], 20)).toBe(9);
  });

  it("caps the total at the company's own baseline, never above it", () => {
    expect(hoursSavedForTender([2, 3, 4, 1, 5, 2, 10], 20)).toBe(20);
  });

  it("treats a negative baseline as zero rather than letting the cap go negative", () => {
    expect(hoursSavedForTender([5, 5], -10)).toBe(0);
  });

  it("returns 0 for a tender with no counted steps yet", () => {
    expect(hoursSavedForTender([], 20)).toBe(0);
  });
});

describe("stepAlreadyCounted - once-per-tender counting (§9.2: re-runs don't add)", () => {
  it("is false for a step not yet in the counted list", () => {
    expect(stepAlreadyCounted(["compliance_check"], "cvs_tailored")).toBe(false);
  });

  it("is true once a step is in the counted list - a re-run must not add it again", () => {
    expect(stepAlreadyCounted(["compliance_check", "cvs_tailored"], "cvs_tailored")).toBe(true);
  });

  it("is false for an empty counted list", () => {
    expect(stepAlreadyCounted([], "pack_assembled")).toBe(false);
  });
});

describe("extraCapacity - divide-by-zero guard (§9.2 explicitly requires this)", () => {
  it("returns 0, not Infinity/NaN, when no tenders have been counted yet", () => {
    expect(extraCapacity(0, 0, 20)).toBe(0);
  });

  it("returns 0 when the average hours saved per tender already meets the baseline (zero remaining denominator)", () => {
    // 1 tender counted, 20 hours saved, baseline 20 -> remaining = 20 - 20 = 0
    expect(extraCapacity(20, 1, 20)).toBe(0);
  });

  it("returns 0 when the average hours saved per tender exceeds the baseline (negative denominator)", () => {
    // 1 tender counted, 25 hours saved (already capped elsewhere, but pass a
    // pathological value here to prove the guard holds regardless) vs baseline 20
    expect(extraCapacity(25, 1, 20)).toBe(0);
  });

  it("computes a real floor()'d capacity when the denominator is positive", () => {
    // 10 tenders counted, 100 hours saved total (avg 10/tender), baseline 20
    // -> remaining = 20 - 10 = 10 per tender -> floor(100 / 10) = 10
    expect(extraCapacity(100, 10, 20)).toBe(10);
  });

  it("floors a non-integer result rather than rounding it up", () => {
    // 3 tenders, 27 hours saved (avg 9), baseline 20 -> remaining = 11
    // -> 27 / 11 = 2.4545... -> floor = 2
    expect(extraCapacity(27, 3, 20)).toBe(2);
  });
});

describe("formatRand - Rand rounding and SA thousands formatting (§9.3/§6: space, not comma)", () => {
  it("rounds to the nearest Rand", () => {
    expect(formatRand(27899.6)).toBe("R27 900");
  });

  it("formats thousands with a space, matching the spec's own example", () => {
    expect(formatRand(27900)).toBe("R27 900");
  });

  it("formats millions with a space at every thousands group", () => {
    expect(formatRand(20000000)).toBe("R20 000 000");
  });

  it("never goes below R0", () => {
    expect(formatRand(-500)).toBe("R0");
  });

  it("has no separator under a thousand", () => {
    expect(formatRand(999.4)).toBe("R999");
  });
});

describe("resolveBaseline - distinguishing the company's own confirmed baseline from the §18 placeholder default (spec v3 §18, Sarel's own 2026-10-22 answer: never present 20h/R450 as fact)", () => {
  it("uses the company's own confirmed values and flags isDefault false when both are set", () => {
    expect(resolveBaseline(30, 600)).toEqual({ hoursPerTender: 30, hourlyCostZar: 600, isDefault: false });
  });

  it("falls back to 20h/R450 and flags isDefault true when both are unset (null)", () => {
    expect(resolveBaseline(null, null)).toEqual({ hoursPerTender: 20, hourlyCostZar: 450, isDefault: true });
  });

  it("falls back and flags isDefault true when both are unset (undefined)", () => {
    expect(resolveBaseline(undefined, undefined)).toEqual({ hoursPerTender: 20, hourlyCostZar: 450, isDefault: true });
  });

  it("flags isDefault true when only hours is confirmed but cost is not - a partial baseline is still not a confirmed one", () => {
    const r = resolveBaseline(30, null);
    expect(r.isDefault).toBe(true);
    expect(r.hoursPerTender).toBe(30);
    expect(r.hourlyCostZar).toBe(450);
  });

  it("flags isDefault true when only cost is confirmed but hours is not", () => {
    const r = resolveBaseline(null, 600);
    expect(r.isDefault).toBe(true);
    expect(r.hoursPerTender).toBe(20);
    expect(r.hourlyCostZar).toBe(600);
  });

  it("treats a confirmed zero as a real confirmed value, not a missing one", () => {
    // 0 is a legitimate (if unusual) confirmed hourly cost/hours value -
    // `== null` only catches null/undefined, never 0, so this must NOT
    // silently fall back to the default.
    expect(resolveBaseline(0, 0)).toEqual({ hoursPerTender: 0, hourlyCostZar: 0, isDefault: false });
  });
});

describe("aggregateSavings - totals across a period", () => {
  it("sums already-capped per-tender hours and converts to Rand", () => {
    const totals = aggregateSavings([20, 15, 9], 450);
    expect(totals.hoursSaved).toBe(44);
    expect(totals.randSaved).toBe(44 * 450);
    expect(totals.tendersCounted).toBe(3);
  });

  it("returns an all-zero empty state when nothing has been counted yet", () => {
    const totals = aggregateSavings([], 450);
    expect(totals).toEqual({ hoursSaved: 0, randSaved: 0, tendersCounted: 0 });
  });

  it("rounds the Rand total rather than leaving a fractional cent", () => {
    const totals = aggregateSavings([1], 450.6);
    expect(totals.randSaved).toBe(451); // 450.6 rounded
    expect(Number.isInteger(totals.randSaved)).toBe(true);
  });
});
