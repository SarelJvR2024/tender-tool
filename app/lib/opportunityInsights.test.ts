/**
 * Pure-logic coverage for the Opportunities "done similar tenders before"
 * signal (Sarel's live feedback, 2026-10-22). No Supabase, no mocks.
 *
 * Run: node --experimental-strip-types --test app/lib/opportunityInsights.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDoneHistory, pricingCategoriesFor, pricingSegmentKey, similarTendersBefore } from "./opportunityInsights.ts";

test("buildDoneHistory: drops rows with no tender_id, no stage, or a stage short of a submitted bid", () => {
  const stageByTenderId = new Map([
    ["t-submitted", "submitted"],
    ["t-won", "won"],
    ["t-lost", "lost"],
    ["t-bidding", "bidding"],
    ["t-found", "found"],
  ]);
  const rows = [
    { tenderId: null, buyer: "SANRAL", categories: ["roads_civil"] },
    { tenderId: "t-submitted", buyer: "SANRAL", categories: ["roads_civil"] },
    { tenderId: "t-won", buyer: "Eskom", categories: ["electrical"] },
    { tenderId: "t-bidding", buyer: "SANRAL", categories: ["roads_civil"] },
    { tenderId: "t-found", buyer: "SANRAL", categories: ["roads_civil"] },
    { tenderId: "t-unknown", buyer: "SANRAL", categories: ["roads_civil"] },
  ];
  const history = buildDoneHistory(rows, stageByTenderId);
  assert.deepEqual(history.map((h) => h.tenderId).sort(), ["t-submitted", "t-won"]);
});

test("similarTendersBefore: no history at all shows nothing (never a false negative rendered as a signal)", () => {
  assert.equal(similarTendersBefore({ tenderId: "x", buyer: "SANRAL", categories: ["roads_civil"] }, []), null);
});

test("similarTendersBefore: matches on buyer alone even with no shared category", () => {
  const history = [{ tenderId: "past-1", buyer: "SANRAL (Pty) placeholder", categories: ["electrical"], stage: "won" }];
  const result = similarTendersBefore({ tenderId: "new-1", buyer: "sanral (pty) placeholder", categories: ["roads_civil"] }, history);
  assert.equal(result?.count, 1);
  assert.equal(result?.sameBuyerCount, 1);
  assert.equal(result?.wonCount, 1);
});

test("similarTendersBefore: matches on a shared discipline category alone, different buyer", () => {
  const history = [{ tenderId: "past-1", buyer: "Eskom", categories: ["roads_civil"], stage: "lost" }];
  const result = similarTendersBefore({ tenderId: "new-1", buyer: "SANRAL", categories: ["roads_civil"] }, history);
  assert.equal(result?.count, 1);
  assert.equal(result?.sameBuyerCount, 0);
  assert.equal(result?.wonCount, 0);
  assert.deepEqual(result?.stages, ["lost"]);
});

test("similarTendersBefore: never counts the tender against itself", () => {
  const history = [{ tenderId: "same-id", buyer: "SANRAL", categories: ["roads_civil"], stage: "won" }];
  const result = similarTendersBefore({ tenderId: "same-id", buyer: "SANRAL", categories: ["roads_civil"] }, history);
  assert.equal(result, null);
});

test("similarTendersBefore: an uncategorized catch-all tag never counts as a shared discipline", () => {
  const history = [{ tenderId: "past-1", buyer: "Eskom", categories: ["uncategorized_stationery"], stage: "won" }];
  const result = similarTendersBefore({ tenderId: "new-1", buyer: "SANRAL", categories: ["uncategorized_stationery"] }, history);
  assert.equal(result, null);
});

test("pricingCategoriesFor: drops the uncategorized catch-all bucket", () => {
  assert.deepEqual(pricingCategoriesFor(["roads_civil", "uncategorized_office"]), ["roads_civil"]);
  assert.deepEqual(pricingCategoriesFor(null), []);
});

test("pricingSegmentKey: order-independent so two cards with the same disciplines in a different order share one lookup", () => {
  assert.equal(pricingSegmentKey(["b", "a"]), pricingSegmentKey(["a", "b"]));
});
