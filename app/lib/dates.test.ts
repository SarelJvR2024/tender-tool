/**
 * Coverage for closingCountdown() - the "closes in X days Y hours" wording
 * Sarel asked for on the Opportunities cards (2026-10-22 live feedback).
 *
 * Run: node --experimental-strip-types --test app/lib/dates.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { closingCountdown, daysUntil } from "./dates.ts";

// daysUntil() is the one shared "days until a date" calculation used across
// the Pipeline board, the Tender Workspace header/tasks (QA finding,
// 2026-10-26: page.tsx used to carry its own byte-for-byte duplicate,
// taskDaysLeft(), rather than importing this), and document-expiry
// reminders - a date-only, whole-day count (unlike closingCountdown() above,
// which is deliberately time-aware for the one case - the official RFP
// closing moment - where a stated hour matters).
test("daysUntil: no date on file is unknown, not a wrong confident answer", () => {
  assert.equal(daysUntil(null), null);
});

test("daysUntil: an unparsable date is unknown", () => {
  assert.equal(daysUntil("not-a-date"), null);
});

test("daysUntil: a date-only (midnight) value due tomorrow is 1 day left", () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  assert.equal(daysUntil(tomorrow.toISOString().slice(0, 10)), 1);
});

test("daysUntil: today, whatever today's current time, is 0 days left", () => {
  const today = new Date();
  assert.equal(daysUntil(today.toISOString().slice(0, 10)), 0);
});

test("daysUntil: yesterday is already overdue (-1), not -0 or null", () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  assert.equal(daysUntil(yesterday.toISOString().slice(0, 10)), -1);
});

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
  // closingCountdown() floors to whole hours (lib/dates.ts: deliberately -
  // a closing-deadline countdown must never overstate time remaining), so a
  // `future` computed exactly 10*24h from `Date.now()` is already a few ms
  // in the past relative to Date.now() by the time closingCountdown() itself
  // calls Date.now() again a moment later, which floors the result down to
  // "9 days 23 hours" - genuinely flaky (not this pass's own finding's area,
  // found incidentally while running the full suite). Padded by one extra
  // minute, the same way the adjacent "days and hours both shown" test
  // already pads its own boundary, so the real elapsed time between these
  // two lines can never push the result under the 10-day mark.
  const future = new Date(Date.now() + 10 * 24 * 60 * 60_000 + 60_000).toISOString();
  const result = closingCountdown(future);
  assert.equal(result?.urgent, false);
  assert.match(result!.text, /^closes in 10 days/);
});
