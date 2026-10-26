/**
 * Regression test for lib/dashboardStats.ts - the Home dashboard's "my own
 * tenders" isolation. Pure, no Supabase, same pattern as pack-review-logic.test.ts.
 *
 * What this pins: a tender with NO tender_packs row (this company has never
 * pursued it - the normal state for most of the shared `tenders` table, per
 * that file's own header) must never be counted as an active bid, a pack
 * ready, or a tender closing this week, and must never make `myRows` look
 * non-empty for a genuinely fresh company.
 *
 * Run: node --experimental-strip-types --test app/lib/dashboardStats.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeDashboardStats, isPackReady, myTenderRows, stageOf, type DashboardTenderRow } from "./dashboardStats.ts";

function daysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// A tender from the shared catalog this company has never pursued - the
// realistic shape of most rows in `rows`, not an edge case.
const UNPURSUED: DashboardTenderRow = { closing_date: daysFromNow(2), tender_packs: [] };
const MY_FOUND: DashboardTenderRow = { closing_date: daysFromNow(3), tender_packs: [{ status: "draft", pipeline_stage: "found" }] };
const MY_BIDDING: DashboardTenderRow = { closing_date: daysFromNow(10), tender_packs: [{ status: "draft", pipeline_stage: "bidding" }] };
const MY_SUBMITTED: DashboardTenderRow = { closing_date: daysFromNow(1), tender_packs: [{ status: "confirmed", pipeline_stage: "submitted" }] };
const MY_READY: DashboardTenderRow = { closing_date: daysFromNow(5), tender_packs: [{ status: "filled", pipeline_stage: "bidding" }] };

test("stageOf: falls back to 'found' only because that's the correct default for a real pursued tender, not a generic 'no data' value", () => {
  assert.equal(stageOf(UNPURSUED), "found");
  assert.equal(stageOf(MY_BIDDING), "bidding");
});

test("isPackReady: true only for confirmed/filled, false for no pack or any other status", () => {
  assert.equal(isPackReady(UNPURSUED), false);
  assert.equal(isPackReady(MY_FOUND), false);
  assert.equal(isPackReady(MY_SUBMITTED), true);
  assert.equal(isPackReady(MY_READY), true);
});

test("myTenderRows: excludes every tender with no real tender_packs row", () => {
  const mine = myTenderRows([UNPURSUED, MY_FOUND, MY_BIDDING]);
  assert.deepEqual(mine, [MY_FOUND, MY_BIDDING]);
});

test("computeDashboardStats: a fresh company (zero real packs, only shared-catalog noise) gets a true 0 for every stat, not the shared table's own counts", () => {
  const rows: DashboardTenderRow[] = [UNPURSUED, UNPURSUED, UNPURSUED];
  const stats = computeDashboardStats(rows, 7);
  assert.equal(stats.myRows.length, 0);
  assert.equal(stats.activeBidsCount, 0);
  assert.equal(stats.packsReadyCount, 0);
  assert.equal(stats.closingThisWeekCount, 0);
});

test("computeDashboardStats: counts only this company's own pursued tenders, ignoring unpursued shared-catalog rows entirely", () => {
  // 10 unpursued rows a naive count would have swept in (the exact shape of
  // the real bug: "Active bids: 8" for a company with nothing tracked).
  const noise = Array.from({ length: 10 }, () => UNPURSUED);
  const rows: DashboardTenderRow[] = [...noise, MY_FOUND, MY_BIDDING, MY_SUBMITTED, MY_READY];
  const stats = computeDashboardStats(rows, 7);
  assert.equal(stats.myRows.length, 4);
  // found + bidding + bidding(ready) = 3 in-progress; submitted is excluded by design (IN_PROGRESS_STAGES).
  assert.equal(stats.activeBidsCount, 3);
  // MY_SUBMITTED (confirmed) + MY_READY (filled) both qualify as ready, regardless of pipeline stage.
  assert.equal(stats.packsReadyCount, 2);
});

test("computeDashboardStats: 'closing this week' only ever counts MY tenders, even when unpursued rows close sooner", () => {
  const closingSoonButNotMine: DashboardTenderRow = { closing_date: daysFromNow(1), tender_packs: [] };
  const rows: DashboardTenderRow[] = [closingSoonButNotMine, MY_FOUND];
  const stats = computeDashboardStats(rows, 7);
  assert.equal(stats.closingThisWeekCount, 1); // only MY_FOUND (3 days out), not the unpursued one closing tomorrow
});

test("computeDashboardStats: a tender closing further out than the action window doesn't count, even when it's mine", () => {
  const myFarOut: DashboardTenderRow = { closing_date: daysFromNow(30), tender_packs: [{ status: "draft", pipeline_stage: "found" }] };
  const stats = computeDashboardStats([myFarOut], 7);
  assert.equal(stats.closingThisWeekCount, 0);
});

test("computeDashboardStats: a null closing_date never counts as 'closing this week' (missing is not zero days away)", () => {
  const myUnknownClose: DashboardTenderRow = { closing_date: null, tender_packs: [{ status: "draft", pipeline_stage: "found" }] };
  const stats = computeDashboardStats([myUnknownClose], 7);
  assert.equal(stats.closingThisWeekCount, 0);
});
