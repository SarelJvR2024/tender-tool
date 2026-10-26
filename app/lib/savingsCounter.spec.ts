import { describe, expect, it } from "vitest";
import {
  aggregateSavings,
  extraCapacity,
  formatRand,
  hoursSavedPerCompletedTender,
  resolveBaseline,
} from "./savingsCounter";

describe("hoursSavedPerCompletedTender - flat per-tender figure (Capacity Unlocked brief: baseline minus time spent in Tender Ready)", () => {
  it("defaults to the spec's own 20h baseline minus 5h time-spent = 15h", () => {
    expect(hoursSavedPerCompletedTender(20)).toBe(15);
  });

  it("uses the company's own baseline and an explicit time-spent figure", () => {
    expect(hoursSavedPerCompletedTender(30, 5)).toBe(25);
  });

  it("never goes negative when the baseline is at or below the time spent", () => {
    expect(hoursSavedPerCompletedTender(5, 5)).toBe(0);
    expect(hoursSavedPerCompletedTender(2, 5)).toBe(0);
  });
});

describe("extraCapacity - 'room for N more tenders without hiring' (Capacity Unlocked brief: floor(hours saved / baseline))", () => {
  it("returns 0 when no hours have been saved yet", () => {
    expect(extraCapacity(0, 20)).toBe(0);
  });

  it("returns 0, not Infinity/NaN, for an invalid baseline", () => {
    expect(extraCapacity(100, 0)).toBe(0);
    expect(extraCapacity(100, -5)).toBe(0);
  });

  it("returns 0 for a negative hours-saved figure (defensive - should never occur upstream)", () => {
    expect(extraCapacity(-10, 20)).toBe(0);
  });

  it("floors a non-integer result rather than rounding it up - 45 hours saved at a 20h baseline is +2, not +3", () => {
    expect(extraCapacity(45, 20)).toBe(2);
  });

  it("computes the brief's own worked example: 2 completed tenders x 15h saved = 30h -> floor(30/20) = 1", () => {
    expect(extraCapacity(30, 20)).toBe(1);
  });

  it("is 0 straight after a single completed tender's own 15h saved, since that alone is under one full baseline's worth", () => {
    expect(extraCapacity(15, 20)).toBe(0);
  });
});

describe("formatRand - Rand rounding and SA thousands formatting (§9.3/§6: space, not comma)", () => {
  it("rounds to the nearest Rand", () => {
    expect(formatRand(27899.6)).toBe("R27 900");
  });

  it("formats thousands with a space, matching the spec's own example", () => {
    expect(formatRand(27900)).toBe("R27 900");
  });

  it("formats the brief's own worked example (15h x R450)", () => {
    expect(formatRand(15 * 450)).toBe("R6 750");
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
  it("sums already-computed per-tender hours-saved snapshots and converts to Rand", () => {
    const totals = aggregateSavings([15, 15, 9], 450);
    expect(totals.hoursSaved).toBe(39);
    expect(totals.randSaved).toBe(39 * 450);
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

describe("the brief's own worked example end to end: 2 completed tenders at the default baseline", () => {
  it("15h saved per tender x 2 tenders = 30h, x R450 = R13 500, +1 extra tender's worth of capacity", () => {
    const perTenderHours = [hoursSavedPerCompletedTender(20), hoursSavedPerCompletedTender(20)];
    const totals = aggregateSavings(perTenderHours, 450);
    expect(totals.hoursSaved).toBe(30);
    expect(formatRand(totals.randSaved)).toBe("R13 500");
    expect(extraCapacity(totals.hoursSaved, 20)).toBe(1);
  });
});
