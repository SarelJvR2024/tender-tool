/**
 * parseManualTenderClosing() - the tenders/new manual-load form's closing
 * date/time validation, shared between the client form and the server
 * action (app/app/tenders/new/manual-tender-form.tsx,
 * app/app/tenders/new/actions.ts:registerManualTender).
 *
 * Standing review, 2026-11-09: a closing DATE typed with no closing TIME was
 * already rejected (Form-Field-Audit, 2026-10-18 - no assumed 12:00
 * default), but the reverse - a closing TIME typed with no closing DATE -
 * was never checked anywhere, client or server, and fell straight through
 * registerManualTender()'s own `if (input.closingDate)` guard with no
 * error: the typed time was silently discarded and the tender was loaded
 * with no closing date at all, no warning shown. Confirmed against the
 * real, unmodified registerManualTender() before this fix (a fake-Supabase
 * scratch repro): closingDate="", closingTime="14:00" reached the RPC with
 * p_closing_date=null and no validation error at all.
 *
 * The same pass also found registerManualTender()'s own malformed-
 * closing-date branch returned its error WITHOUT calling cleanup() first -
 * contradicting this exact function's own header comment ("On any refusal
 * the uploaded files are removed again so nothing is left orphaned") -
 * confirmed live (storage.remove() never called on that one refusal path).
 * Extracting this one pure function (instead of two copies of inline
 * validation logic in the client form and the server action) means every
 * refusal now goes through registerManualTender()'s own single
 * `if ("error" in closingResult) { await cleanup(); return {...} }` branch,
 * so that class of bug can't recur there either.
 *
 * Run: node --experimental-strip-types --test app/lib/manualTender.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseManualTenderClosing } from "./manualTender.ts";

test("neither date nor time -> closing is null, no error (closing date is optional)", () => {
  const result = parseManualTenderClosing("", "");
  assert.deepEqual(result, { closing: null });
});

test("both a valid date and time -> combined into a +02:00 (SAST) timestamp", () => {
  const result = parseManualTenderClosing("2026-12-01", "11:00");
  assert.deepEqual(result, { closing: "2026-12-01T11:00:00+02:00" });
});

test("date given, time blank -> rejected (no assumed default time, Form-Field-Audit 2026-10-18)", () => {
  const result = parseManualTenderClosing("2026-12-01", "");
  assert.ok("error" in result);
  assert.match(result.error, /closing time/i);
});

test("BUG (2026-11-09, now fixed): time given, date blank -> rejected, not silently dropped to a null closing date", () => {
  const result = parseManualTenderClosing("", "11:00");
  assert.ok("error" in result, "a closing time with no closing date must be rejected, not silently discarded");
  assert.match(result.error, /closing date/i);
});

test("a malformed date (passes neither-blank check, fails the real date shape) is rejected, not combined into a broken timestamp", () => {
  const result = parseManualTenderClosing("not-a-date", "11:00");
  assert.deepEqual(result, { error: "Closing date isn't a valid date." });
});

test("a malformed time is rejected the same way a missing one is", () => {
  const result = parseManualTenderClosing("2026-12-01", "not-a-time");
  assert.ok("error" in result);
  assert.match(result.error, /closing time/i);
});
