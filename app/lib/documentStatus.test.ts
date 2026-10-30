/**
 * Coverage for documentStatus() (lib/dates.ts) - real bug, 2026-10-29
 * (Sarel: uploaded a COID Letter of Good Standing, the file linked
 * correctly, but the status badge still said "Not on file"). Every vault
 * document caller used to pass expiryStatus() the expiry date alone, with
 * no check for whether a file was actually attached, so "no date on file
 * yet" and "no document at all" were indistinguishable.
 *
 * Run: node --experimental-strip-types --test app/lib/documentStatus.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { documentStatus } from "./dates.ts";

test("no file at all -> genuinely 'Not on file', muted", () => {
  assert.deepEqual(documentStatus(false, null), { label: "Not on file", tone: "muted" });
});

test("a file was uploaded, no date was uploaded, expired, or anything else so far - 'Not on file' is the wrong answer; a file IS on file", () => {
  assert.deepEqual(documentStatus(true, null), { label: "Needs date verification", tone: "warning" });
});

test("a file is attached and its expiry date is known -> falls through to the real expiry logic (future date, well outside the renew-soon window)", () => {
  const farFuture = new Date(Date.now() + 1000 * 60 * 60 * 24 * 400).toISOString().slice(0, 10);
  assert.deepEqual(documentStatus(true, farFuture), { label: "Current", tone: "success" });
});

test("a file is attached and its expiry date is in the past -> Expired, not 'Not on file'", () => {
  assert.deepEqual(documentStatus(true, "2020-01-01"), { label: "Expired", tone: "destructive" });
});

test("a file is attached and its expiry date is within the renew-soon window -> Renew soon, same threshold as expiryStatus()", () => {
  const soon = new Date(Date.now() + 1000 * 60 * 60 * 24 * 10).toISOString().slice(0, 10);
  assert.deepEqual(documentStatus(true, soon), { label: "Renew soon", tone: "warning" });
});

test("a custom renewSoonWithinDays threshold is honoured, same as expiryStatus()'s own BANK_LETTER_RENEW_SOON_DAYS case", () => {
  const in20Days = new Date(Date.now() + 1000 * 60 * 60 * 24 * 20).toISOString().slice(0, 10);
  assert.deepEqual(documentStatus(true, in20Days, 30), { label: "Renew soon", tone: "warning" });
  assert.deepEqual(documentStatus(true, in20Days, 5), { label: "Current", tone: "success" });
});

test("no file, but a date is somehow present anyway - hasFile still wins; stays honestly 'Not on file'", () => {
  // Shouldn't happen in practice (a date without a file), but documentStatus()
  // must not accidentally read it as a real document on the strength of the
  // date alone - hasFile is the one authoritative signal.
  assert.deepEqual(documentStatus(false, "2030-01-01"), { label: "Not on file", tone: "muted" });
});
