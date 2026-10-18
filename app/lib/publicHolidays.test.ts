import { test } from "node:test";
import assert from "node:assert/strict";
import {
  holidaysForYear,
  isPublicHoliday,
  isBusinessDay,
  addBusinessDays,
  businessDaysBetween,
} from "./publicHolidays.ts";

test("2026 holiday table has the 12 permanent holidays plus Easter-derived dates", () => {
  const h = holidaysForYear(2026).map((x) => x.date);
  // Fixed-date holidays, 2026.
  assert.ok(h.includes("2026-01-01")); // New Year's Day
  assert.ok(h.includes("2026-03-21")); // Human Rights Day
  assert.ok(h.includes("2026-04-27")); // Freedom Day
  assert.ok(h.includes("2026-05-01")); // Workers' Day
  assert.ok(h.includes("2026-06-16")); // Youth Day
  assert.ok(h.includes("2026-08-09")); // National Women's Day
  assert.ok(h.includes("2026-09-24")); // Heritage Day
  assert.ok(h.includes("2026-12-16")); // Day of Reconciliation
  assert.ok(h.includes("2026-12-25")); // Christmas Day
  assert.ok(h.includes("2026-12-26")); // Day of Goodwill
  // Easter 2026 is 5 April -> Good Friday 3 April, Family Day 6 April.
  assert.ok(h.includes("2026-04-03"));
  assert.ok(h.includes("2026-04-06"));
});

test("2025 and 2027 Easter-derived dates (known reference values)", () => {
  const h2025 = holidaysForYear(2025).map((x) => x.date);
  assert.ok(h2025.includes("2025-04-18")); // Good Friday 2025
  assert.ok(h2025.includes("2025-04-21")); // Family Day 2025

  const h2027 = holidaysForYear(2027).map((x) => x.date);
  assert.ok(h2027.includes("2027-03-26")); // Good Friday 2027
  assert.ok(h2027.includes("2027-03-29")); // Family Day 2027
});

test("a fixed-date holiday landing on a Sunday also makes the Monday a public holiday (s2A)", () => {
  // Human Rights Day 2027 (21 March) is a Sunday.
  const d = new Date("2027-03-21T00:00:00Z");
  assert.equal(d.getUTCDay(), 0, "test fixture assumption: 2027-03-21 is a Sunday");
  assert.ok(isPublicHoliday("2027-03-21"));
  assert.ok(isPublicHoliday("2027-03-22"), "the following Monday must also be a public holiday");
});

test("isBusinessDay rejects weekends and holidays, accepts an ordinary weekday", () => {
  assert.equal(isBusinessDay("2026-01-01"), false); // New Year's Day, a Thursday
  assert.equal(isBusinessDay("2026-01-03"), false); // Saturday
  assert.equal(isBusinessDay("2026-01-04"), false); // Sunday
  assert.equal(isBusinessDay("2026-01-05"), true); // ordinary Monday
});

test("addBusinessDays from an ordinary weekday skips weekends", () => {
  // Monday 2026-01-05 + 5 business days = following Monday 2026-01-12
  // (Tue, Wed, Thu, Fri, Mon - no holiday in this window).
  assert.equal(addBusinessDays("2026-01-05", 5), "2026-01-12");
});

test("addBusinessDays skips a public holiday that falls inside the window", () => {
  // Thursday 2026-06-11 + 5 business days: Fri 12, Mon 15, Tue 16 is Youth
  // Day (skipped), Wed 17, Thu 18, Fri 19 -> lands on Fri 2026-06-19.
  assert.equal(addBusinessDays("2026-06-11", 5), "2026-06-19");
});

test("addBusinessDays starting from a date that is itself a non-business day still counts correctly", () => {
  // Starting on a Saturday (2026-01-03, not a business day itself) + 1
  // business day must land on the next Monday, not Sunday.
  assert.equal(addBusinessDays("2026-01-03", 1), "2026-01-05");
  // Starting on New Year's Day (a holiday) + 1 business day -> Fri 2026-01-02.
  assert.equal(addBusinessDays("2026-01-01", 1), "2026-01-02");
});

test("addBusinessDays spans a year boundary correctly, skipping the festive-season holidays", () => {
  // Tuesday 2026-12-22 + 5 business days: Wed 23, (Thu 24 ok, no SA holiday
  // on the 24th that year), (Fri 25 Christmas skip), (Sat/Sun skip),
  // (Mon 28, Tue 29, Wed 30 ok - count 23,24,28,29,30 = 5) -> 2026-12-30.
  // Verified independently against the computed holiday table rather than
  // hand-walked, to avoid encoding the same mistake twice:
  const h2026 = new Set(holidaysForYear(2026).map((x) => x.date));
  let d = "2026-12-22";
  let remaining = 5;
  const step = (dateStr: string) => {
    const dt = new Date(dateStr + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString().slice(0, 10);
  };
  while (remaining > 0) {
    d = step(d);
    const day = new Date(d + "T00:00:00Z").getUTCDay();
    if (day !== 0 && day !== 6 && !h2026.has(d)) remaining -= 1;
  }
  assert.equal(addBusinessDays("2026-12-22", 5), d);
});

test("addBusinessDays can also go backwards (negative N)", () => {
  assert.equal(addBusinessDays("2026-01-12", -5), "2026-01-05");
});

test("businessDaysBetween counts working days strictly after start, up to and including end", () => {
  // Monday 2026-01-05 to Monday 2026-01-12: Tue, Wed, Thu, Fri, Mon = 5.
  assert.equal(businessDaysBetween("2026-01-05", "2026-01-12"), 5);
  // Same date both ends -> 0 (today never counts).
  assert.equal(businessDaysBetween("2026-01-05", "2026-01-05"), 0);
});

test("businessDaysBetween is negative, and symmetric in magnitude, when end is before start", () => {
  const fwd = businessDaysBetween("2026-01-05", "2026-01-12");
  const back = businessDaysBetween("2026-01-12", "2026-01-05");
  assert.equal(back, -fwd);
});
