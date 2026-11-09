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

// SA timezone/date-boundary bug, found this pass: "today" must be the real
// Africa/Johannesburg (SAST, UTC+2, no DST) calendar date, not the host
// process's own local calendar date - no TZ env var is set anywhere in this
// repo, and both Vercel's Node runtime and GitHub Actions' ubuntu runners
// default to UTC. Pre-fix, `new Date(now); .setHours(0,0,0,0)` normalized
// "today" using the PROCESS's local (UTC on an unconfigured host) midnight,
// 2 hours behind real SAST midnight - so for the 00:00-02:00 SAST window
// every day (22:00-24:00 UTC the day before), a date-only value that
// expired/closed YESTERDAY in real SAST terms still read as 0 days left
// ("today") instead of -1 ("already overdue").
test("daysUntil: the SAST calendar day, not the host process's own local day, decides 'today' - even during the 00:00-02:00 SAST window where UTC's own calendar date is still 'yesterday'", () => {
  // 2026-11-09T23:00:00Z = 2026-11-10 01:00 SAST: already the 10th in South
  // Africa, still the 9th by a bare UTC clock.
  const nowDuringWindow = new Date("2026-11-09T23:00:00Z");
  // A document/tender dated "2026-11-09" has already closed/expired -
  // yesterday, in real SAST terms - by the time this instant arrives.
  assert.equal(daysUntil("2026-11-09", nowDuringWindow), -1);
  // The SAST day itself (the 10th) is correctly still "0 days left", not -1.
  assert.equal(daysUntil("2026-11-10", nowDuringWindow), 0);
});

// Finding 289 (2026-11-09): every test above uses a bare "YYYY-MM-DD"
// date-only string - which, parsed by `new Date()`, always lands on exact
// UTC midnight (= 02:00 SAST). That accidentally matched the OLD buggy
// anchor exactly, so none of them could ever have caught this. A tender's
// real closing_date/discovered_opportunities.closing_date (both
// `timestamptz`) and a trial's trial_ends_at (also `timestamptz`) carry a
// REAL time-of-day instead - the one shape none of the tests above exercise.
test("daysUntil: a REAL timestamp (not a bare date-only string) closing later TODAY (SAST) is 0 days left, not inflated to 1", () => {
  // now = 09:00 SAST 2026-11-09; closing = 14:00 SAST 2026-11-09 (later today, not yet closed).
  const now = new Date("2026-11-09T07:00:00Z");
  assert.equal(daysUntil("2026-11-09T14:00:00+02:00", now), 0);
});

test("daysUntil: a REAL timestamp that closed EARLIER today (SAST) is still 0 - a calendar-day count, not yet -1 (that's closingCountdown()/isPast()'s job, not this one's)", () => {
  // now = 18:00 SAST 2026-11-09; closing = 09:00 SAST 2026-11-09 (closed 9h ago, same SAST day).
  const now = new Date("2026-11-09T16:00:00Z");
  assert.equal(daysUntil("2026-11-09T07:00:00Z", now), 0);
});

test("daysUntil: a REAL timestamp that closed YESTERDAY (SAST) reads -1 the very next SAST day, not still 0", () => {
  // Real incident this guards against: the pre-fix anchor (UTC midnight of
  // today's SAST date, 2h after true SAST midnight) made a tender that
  // closed yesterday evening SAST still read as "0 days left"/"Due today"
  // for the tender's own ENTIRE next calendar day - live-reproduced via a
  // full-day sweep around a real closing instant during this pass.
  const closedYesterdayEvening = "2026-11-08T18:00:00Z"; // 20:00 SAST Nov 8
  const now = new Date("2026-11-09T08:00:00Z"); // 10:00 SAST Nov 9 - the very next SAST day
  assert.equal(daysUntil(closedYesterdayEvening, now), -1);
});

test("daysUntil: a REAL timestamp exactly 7 calendar SAST days out is 7, not 8 (the dispatchTriage.ts regression this bug was already silently baked into)", () => {
  // Same two instants dispatchTriage.test.ts's own "the 7-day boundary
  // agrees with daysUntil()" test already uses - that test's own 2026-10-28
  // comment records daysUntil() reading "8 days left" for a tender genuinely
  // 7 SAST calendar days out, and made classifyDispatchBucket() agree with
  // this function rather than questioning this function's own number.
  const now = new Date("2026-10-28T15:00:00+02:00");
  const closingDate = "2026-11-04T09:00:00+02:00";
  assert.equal(daysUntil(closingDate, now), 7);
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
