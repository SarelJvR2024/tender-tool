import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PPR_2022_THRESHOLD_ZAR,
  systemForValue,
  maxPoints,
  pricePoints,
  beeGoalsPoints,
  calculatePreferencePoints,
} from "./preferencePoints.ts";

test("systemForValue: 80/20 at and below R50m, 90/10 strictly above (reg 4/5)", () => {
  assert.equal(systemForValue(0), "80/20");
  assert.equal(systemForValue(PPR_2022_THRESHOLD_ZAR), "80/20");
  assert.equal(systemForValue(PPR_2022_THRESHOLD_ZAR + 1), "90/10");
  assert.equal(systemForValue(200_000_000), "90/10");
});

test("maxPoints: 80/20 is max 80 price + 20 goals, 90/10 is max 90 price + 10 goals", () => {
  assert.deepEqual(maxPoints("80/20"), { maxPricePoints: 80, maxGoalsPoints: 20 });
  assert.deepEqual(maxPoints("90/10"), { maxPricePoints: 90, maxGoalsPoints: 10 });
});

test("pricePoints: the lowest acceptable tender itself scores the full max (Pt = Pmin)", () => {
  assert.equal(pricePoints("80/20", 1_000_000, 1_000_000), 80);
  assert.equal(pricePoints("90/10", 1_000_000, 1_000_000), 90);
});

test("pricePoints: reg 4 worked example - Ps = 80(1 - (Pt-Pmin)/Pmin)", () => {
  // Pmin = R1,000,000, Pt = R1,100,000 (10% above lowest):
  // Ps = 80 * (1 - 100000/1000000) = 80 * 0.9 = 72.
  assert.equal(pricePoints("80/20", 1_100_000, 1_000_000), 72);
  // 90/10 system, same ratio: Ps = 90 * 0.9 = 81.
  assert.equal(pricePoints("90/10", 1_100_000, 1_000_000), 81);
});

test("pricePoints: rounds to 2 decimals", () => {
  // Pmin = 3, Pt = 3.333... Ps = 80*(1-(0.333.../3)) -> check rounding happens.
  const p = pricePoints("80/20", 1_000_333, 1_000_000);
  assert.equal(p, Math.round(p * 100) / 100);
});

test("pricePoints throws on a non-positive Pmin", () => {
  assert.throws(() => pricePoints("80/20", 100, 0));
  assert.throws(() => pricePoints("80/20", 100, -5));
});

test("beeGoalsPoints: SBD 6.1 standard table, both systems, known reference values", () => {
  assert.equal(beeGoalsPoints("80/20", 1), 20);
  assert.equal(beeGoalsPoints("80/20", 2), 18);
  assert.equal(beeGoalsPoints("80/20", 3), 14);
  assert.equal(beeGoalsPoints("80/20", 4), 12);
  assert.equal(beeGoalsPoints("80/20", 5), 8);
  assert.equal(beeGoalsPoints("80/20", 6), 6);
  assert.equal(beeGoalsPoints("80/20", 7), 4);
  assert.equal(beeGoalsPoints("80/20", 8), 2);
  assert.equal(beeGoalsPoints("80/20", "non_compliant"), 0);

  assert.equal(beeGoalsPoints("90/10", 1), 10);
  assert.equal(beeGoalsPoints("90/10", 2), 9);
  assert.equal(beeGoalsPoints("90/10", 3), 7);
  assert.equal(beeGoalsPoints("90/10", 4), 5);
  assert.equal(beeGoalsPoints("90/10", 5), 4);
  assert.equal(beeGoalsPoints("90/10", 6), 3);
  assert.equal(beeGoalsPoints("90/10", 7), 2);
  assert.equal(beeGoalsPoints("90/10", 8), 1);
  assert.equal(beeGoalsPoints("90/10", "non_compliant"), 0);
});

test("calculatePreferencePoints: full breakdown, system chosen from contract value", () => {
  const r = calculatePreferencePoints({
    contractValueZarInclVat: 20_000_000, // <= R50m -> 80/20
    tenderPriceZar: 1_100_000,
    lowestAcceptablePriceZar: 1_000_000,
    beeLevel: 1,
  });
  assert.equal(r.system, "80/20");
  assert.equal(r.pricePoints, 72);
  assert.equal(r.beeGoalsPoints, 20);
  assert.equal(r.totalPoints, 92);
  assert.equal(r.maxPricePoints, 80);
  assert.equal(r.maxGoalsPoints, 20);
});

test("calculatePreferencePoints: contract value above R50m switches to 90/10", () => {
  const r = calculatePreferencePoints({
    contractValueZarInclVat: 80_000_000,
    tenderPriceZar: 1_100_000,
    lowestAcceptablePriceZar: 1_000_000,
    beeLevel: 1,
  });
  assert.equal(r.system, "90/10");
  assert.equal(r.pricePoints, 81);
  assert.equal(r.beeGoalsPoints, 10);
  assert.equal(r.totalPoints, 91);
});

test("calculatePreferencePoints: an explicit system overrides the value-based default", () => {
  const r = calculatePreferencePoints({
    contractValueZarInclVat: 5_000_000, // would default to 80/20
    tenderPriceZar: 1_000_000,
    lowestAcceptablePriceZar: 1_000_000,
    beeLevel: "non_compliant",
    system: "90/10", // tender document states 90/10 explicitly (reg 3(2))
  });
  assert.equal(r.system, "90/10");
  assert.equal(r.pricePoints, 90);
  assert.equal(r.beeGoalsPoints, 0);
  assert.equal(r.totalPoints, 90);
});
