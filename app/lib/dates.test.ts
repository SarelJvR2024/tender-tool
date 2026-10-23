/**
 * Coverage for closingCountdown() - the "closes in X days Y hours" wording
 * Sarel asked for on the Opportunities cards (2026-10-22 live feedback).
 *
 * Run: node --experimental-strip-types --test app/lib/dates.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { closingCountdown } from "./dates.ts";

test("closingCountdown: no date on file shows nothing", () => {
  assert.equal(closingCountdown(null), null);
});

test("closingCountdown: an unparsable date shows nothing rather than a wrong confident answer", () => {
  assert.equal(closingCountdown("not-a-date"), null);
});

test("closingCountdown: already past closes as 'closed', urgent", () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.deepEqual(closingCountdown(past), { text: "closed", urgent: true });
});

test("closingCountdown: under an hour away", () => {
  const soon = new Date(Date.now() + 30 * 60_000).toISOString();
  assert.deepEqual(closingCountdown(soon), { text: "closes within the hour", urgent: true });
});

test("closingCountdown: a few hours away, urgent", () => {
  const soon = new Date(Date.now() + 5 * 60 * 60_000).toISOString();
  const result = closingCountdown(soon);
  assert.equal(result?.text, "closes in 5 hours");
  assert.equal(result?.urgent, true);
});

test("closingCountdown: days and hours both shown", () => {
  const future = new Date(Date.now() + (3 * 24 + 4) * 60 * 60_000 + 60_000).toISOString();
  const result = closingCountdown(future);
  assert.match(result!.text, /^closes in 3 days 4 hours$/);
  assert.equal(result?.urgent, true);
});

test("closingCountdown: more than 7 days away is not urgent", () => {
  const future = new Date(Date.now() + 10 * 24 * 60 * 60_000).toISOString();
  const result = closingCountdown(future);
  assert.equal(result?.urgent, false);
  assert.match(result!.text, /^closes in 10 days/);
});
