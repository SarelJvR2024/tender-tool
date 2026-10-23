/**
 * Pure logic tests for the Discovery page scaling fix (discoveryPagination.ts)
 * - no Supabase, no network, no mocks, same "real logic, no mocks" spirit as
 * marketTrendLogic.test.ts / pack-review-logic.test.ts.
 *
 * Run: node --experimental-strip-types --test app/lib/discoveryPagination.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canLoadMore,
  COUNTABLE_FILTERS,
  hasMore,
  MAX_SHOW,
  nextShow,
  PAGE_SIZE,
  parseShowParam,
  verdictQuerySpec,
} from "./discoveryPagination.ts";

test("parseShowParam: missing/garbage/non-positive falls back to PAGE_SIZE", () => {
  assert.equal(parseShowParam(undefined), PAGE_SIZE);
  assert.equal(parseShowParam("not-a-number"), PAGE_SIZE);
  assert.equal(parseShowParam("-30"), PAGE_SIZE);
  assert.equal(parseShowParam("0"), PAGE_SIZE);
});

test("parseShowParam: rounds down to the nearest PAGE_SIZE multiple, minimum one page", () => {
  assert.equal(parseShowParam("45"), PAGE_SIZE); // below 2 full pages
  assert.equal(parseShowParam(String(PAGE_SIZE * 2)), PAGE_SIZE * 2);
  assert.equal(parseShowParam(String(PAGE_SIZE * 2 + 29)), PAGE_SIZE * 2);
});

test("parseShowParam: clamps to MAX_SHOW even for a huge/crafted value", () => {
  assert.equal(parseShowParam("100000"), MAX_SHOW);
  assert.equal(parseShowParam(String(MAX_SHOW + 1)), MAX_SHOW);
});

test("parseShowParam: takes the first value when searchParams gives an array", () => {
  assert.equal(parseShowParam([String(PAGE_SIZE * 3), String(PAGE_SIZE * 9)]), PAGE_SIZE * 3);
});

test("nextShow: advances by one page and clamps at MAX_SHOW", () => {
  assert.equal(nextShow(PAGE_SIZE), PAGE_SIZE * 2);
  assert.equal(nextShow(MAX_SHOW), MAX_SHOW);
  assert.equal(nextShow(MAX_SHOW - 1), MAX_SHOW);
});

test("hasMore: true only when the fetch returned strictly more than the display window (the +1 trick)", () => {
  assert.equal(hasMore(PAGE_SIZE + 1, PAGE_SIZE), true);
  assert.equal(hasMore(PAGE_SIZE, PAGE_SIZE), false);
  assert.equal(hasMore(0, PAGE_SIZE), false);
});

test("canLoadMore: only once there IS a further row AND the window hasn't hit MAX_SHOW yet", () => {
  assert.equal(canLoadMore(PAGE_SIZE, true), true);
  assert.equal(canLoadMore(PAGE_SIZE, false), false);
  assert.equal(canLoadMore(MAX_SHOW, true), false);
});

test("verdictQuerySpec: strong_fit / not_a_fit are plain equality on verdict", () => {
  assert.deepEqual(verdictQuerySpec("strong_fit"), { kind: "eq", column: "verdict", value: "strong_fit" });
  assert.deepEqual(verdictQuerySpec("not_a_fit"), { kind: "eq", column: "verdict", value: "not_a_fit" });
});

test("verdictQuerySpec: needs_review groups possible + needs_review, same as the old in-JS matchesFilter()", () => {
  assert.deepEqual(verdictQuerySpec("needs_review"), { kind: "in", column: "verdict", values: ["possible", "needs_review"] });
});

test("verdictQuerySpec: reassessed is a real column predicate (downgraded_from is not null) - a genuine full-history filter", () => {
  assert.deepEqual(verdictQuerySpec("reassessed"), { kind: "not_null", column: "downgraded_from" });
});

test("verdictQuerySpec: all and changed push no predicate down (changed needs a JS cross-reference over whatever page is in view)", () => {
  assert.deepEqual(verdictQuerySpec("all"), { kind: "none" });
  assert.deepEqual(verdictQuerySpec("changed"), { kind: "none" });
});

test("verdictQuerySpec: declined is a real column predicate (interest_marker = 'declined', migration 0089) - a genuine full-history filter, not JS-scoped like changed", () => {
  assert.deepEqual(verdictQuerySpec("declined"), { kind: "eq", column: "interest_marker", value: "declined" });
});

test("COUNTABLE_FILTERS: every filter except changed has a cheap exact count available", () => {
  assert.deepEqual([...COUNTABLE_FILTERS].sort(), ["all", "declined", "needs_review", "not_a_fit", "reassessed", "strong_fit"].sort());
  assert.equal(COUNTABLE_FILTERS.includes("changed" as never), false);
});
