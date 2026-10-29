/**
 * Pure logic tests for sanitizePreferredBuyers() / matchesPreferredBuyers() -
 * see opportunityBuyerMatch.ts's own header comment for the full writeup.
 *
 * Run: node --experimental-strip-types --test app/lib/opportunityBuyerMatch.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesPreferredBuyers, sanitizePreferredBuyers } from "./opportunityBuyerMatch.ts";

test("sanitizePreferredBuyers: trims whitespace and collapses internal runs", () => {
  assert.deepEqual(sanitizePreferredBuyers(["  SANRAL  ", "City   of   Cape Town"]), ["SANRAL", "City of Cape Town"]);
});

test("sanitizePreferredBuyers: drops empty/whitespace-only and non-string entries", () => {
  assert.deepEqual(sanitizePreferredBuyers(["", "   ", "SANRAL", null as unknown as string, 5 as unknown as string]), ["SANRAL"]);
});

test("sanitizePreferredBuyers: dedupes case/whitespace-insensitively, keeping the first-seen casing", () => {
  assert.deepEqual(sanitizePreferredBuyers(["SANRAL", "sanral", "  Sanral  "]), ["SANRAL"]);
});

test("sanitizePreferredBuyers: drops an absurdly long entry rather than truncating it silently", () => {
  const huge = "A".repeat(200);
  assert.deepEqual(sanitizePreferredBuyers([huge, "SANRAL"]), ["SANRAL"]);
});

test("sanitizePreferredBuyers: caps the list length rather than growing it unbounded", () => {
  const many = Array.from({ length: 40 }, (_, i) => `Buyer ${i}`);
  assert.equal(sanitizePreferredBuyers(many).length, 25);
});

test("sanitizePreferredBuyers: null/undefined input -> empty list, never throws", () => {
  assert.deepEqual(sanitizePreferredBuyers(null), []);
  assert.deepEqual(sanitizePreferredBuyers(undefined), []);
});

test("matchesPreferredBuyers: no stated preference -> matches everything", () => {
  assert.equal(matchesPreferredBuyers([], "SANRAL"), true);
  assert.equal(matchesPreferredBuyers([], null), true);
});

test("matchesPreferredBuyers: tender has no buyer on file -> matches regardless (not punished for a scoring gap)", () => {
  assert.equal(matchesPreferredBuyers(["SANRAL"], null), true);
  assert.equal(matchesPreferredBuyers(["SANRAL"], ""), true);
});

test("matchesPreferredBuyers: exact match, case-insensitive", () => {
  assert.equal(matchesPreferredBuyers(["sanral"], "SANRAL"), true);
});

test("matchesPreferredBuyers: short preferred name matches the buyer's longer official name", () => {
  assert.equal(matchesPreferredBuyers(["SANRAL"], "South African National Roads Agency SOC Ltd (SANRAL)"), true);
});

test("matchesPreferredBuyers: longer preferred name matches a buyer field that only has the short form", () => {
  assert.equal(matchesPreferredBuyers(["South African National Roads Agency"], "SANRAL"), false); // no overlap either direction - real negative case
  assert.equal(matchesPreferredBuyers(["City of Cape Town Metropolitan Municipality"], "City of Cape Town"), true);
});

test("matchesPreferredBuyers: no overlap at all does not match", () => {
  assert.equal(matchesPreferredBuyers(["Eskom"], "City of Cape Town"), false);
});

test("matchesPreferredBuyers: multiple preferences, only one needs to match", () => {
  assert.equal(matchesPreferredBuyers(["Eskom", "SANRAL"], "SANRAL"), true);
});
