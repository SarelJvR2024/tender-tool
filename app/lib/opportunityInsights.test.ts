/**
 * Pure-logic coverage for the Opportunities "done similar tenders before"
 * signal (Sarel's live feedback, 2026-10-22; reconciled after PR #123's
 * discovery-page pagination fix - see app/app/discovery/page.tsx's own call
 * site comment and app/AGENTS.md's reconciliation entry). No Supabase, no
 * mocks.
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

test("buildDoneHistory: counts a tender at briefing_shortlisted - reached submitted, now awaiting an outcome, not 'done before' short of a bid", () => {
  // Regression, 2026-10-31: DONE_STAGES used to be submitted/won/lost only,
  // missing the briefing_shortlisted stage migration 0105 (PR #173) added
  // between submitted and an outcome - a real pipeline_stage value a row
  // can hold, not a hypothetical one.
  const stageByTenderId = new Map([["t-briefed", "briefing_shortlisted"]]);
  const rows = [{ tenderId: "t-briefed", buyer: "SANRAL", categories: ["roads_civil"] }];
  const history = buildDoneHistory(rows, stageByTenderId);
  assert.deepEqual(history.map((h) => h.tenderId), ["t-briefed"]);
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

// The regression this reconciliation exists to prevent (PR #120 vs PR #123):
// a company whose pursued-history tenders fall OUTSIDE the currently-loaded
// discovery page/filter window must still be counted by buildDoneHistory/
// similarTendersBefore. This proves the FIX is in the right place: feeding
// buildDoneHistory() the full pursued set (simulated here as a set strictly
// LARGER than and disjoint in index space from whatever a paginated window
// of PAGE_SIZE=30 would contain) still finds the match - whereas feeding it
// only a 30-row "window" slice would silently miss it, which is exactly the
// undercount bug PR #123's own AGENTS.md entry flagged against PR #120.
test("buildDoneHistory + similarTendersBefore: a pursued match outside a 30-row paginated window is still counted", () => {
  // Simulate a company with 400 discovered_opportunities rows total, of
  // which only ONE (the 350th, well outside any default/loaded page window)
  // is this company's own pursued history that reached "won".
  const PAGE_SIZE = 30;
  const stageByTenderId = new Map<string, string>();
  const allRows: { tenderId: string | null; buyer: string | null; categories: string[] | null }[] = [];
  for (let i = 0; i < 400; i++) {
    allRows.push({ tenderId: null, buyer: "Some Other Buyer", categories: ["electrical"] });
  }
  allRows[349] = { tenderId: "deep-history-tender", buyer: "SANRAL", categories: ["roads_civil"] };
  stageByTenderId.set("deep-history-tender", "won");

  // The paginated/filtered window the discovery page would actually render
  // by default (PAGE_SIZE rows) never reaches index 349.
  const paginatedWindow = allRows.slice(0, PAGE_SIZE);
  const windowedHistory = buildDoneHistory(paginatedWindow, stageByTenderId);
  assert.equal(windowedHistory.length, 0, "sanity check: the windowed slice alone does not contain the deep-history match");

  // The fix: a dedicated, un-paginated "this company's own pursued
  // opportunities" query (mirrors app/app/pipeline/page.tsx's identical
  // .not("tender_id", "is", null) query) returns only the pursued rows,
  // regardless of where they'd fall in the paginated window.
  const dedicatedPursuedQueryResult = allRows.filter((r) => r.tenderId !== null);
  const fullHistory = buildDoneHistory(dedicatedPursuedQueryResult, stageByTenderId);
  assert.equal(fullHistory.length, 1);

  const target = { tenderId: "new-roads-tender", buyer: "SANRAL", categories: ["roads_civil"] };
  assert.equal(similarTendersBefore(target, windowedHistory), null, "regression: a windowed history silently undercounts to zero");
  const matched = similarTendersBefore(target, fullHistory);
  assert.equal(matched?.count, 1);
  assert.equal(matched?.wonCount, 1);
  assert.equal(matched?.sameBuyerCount, 1);
});
