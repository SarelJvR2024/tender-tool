// South African public holidays - the fixed table behind the free
// "working-day deadline calculator" lead-magnet tool (/tools/deadline-calculator)
// and behind any future tender-deadline math elsewhere in the product.
//
// Source: Public Holidays Act 36 of 1994, Schedule 1 (as amended) - the
// 12 permanent public holidays, 11 of which fall on a fixed Gregorian date
// every year, plus Good Friday and Family Day, which are derived from
// Easter Sunday (the Act defines Family Day as "the Monday following
// Easter Sunday", i.e. Easter Monday). Section 2A of the Act also provides
// that when a fixed-date holiday falls on a Sunday, the following Monday
// becomes a public holiday too - included below.
//
// Gazetted "additional" public holidays (the President may declare one
// under s2(2), e.g. a special election or a national day of mourning) are
// NOT predictable in advance and are not in this table; see EXTRA_HOLIDAYS
// below for how to add one when it's gazetted.
//
// Years covered: 2025-2027 (current year + next, plus the prior year so a
// deadline computed near 1 Jan still has full context). Adding a future
// year is one function call - see FIXED_DATE_HOLIDAYS + easterSunday().

export type Holiday = { date: string; name: string }; // date: "YYYY-MM-DD"

const FIXED_DATE_HOLIDAYS: { month: number; day: number; name: string }[] = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 3, day: 21, name: "Human Rights Day" },
  { month: 4, day: 27, name: "Freedom Day" },
  { month: 5, day: 1, name: "Workers' Day" },
  { month: 6, day: 16, name: "Youth Day" },
  { month: 8, day: 9, name: "National Women's Day" },
  { month: 9, day: 24, name: "Heritage Day" },
  { month: 12, day: 16, name: "Day of Reconciliation" },
  { month: 12, day: 25, name: "Christmas Day" },
  { month: 12, day: 26, name: "Day of Goodwill" },
];

// Gazetted one-off additions go here, keyed by year, e.g. a special voting
// day. Empty until one is actually gazetted - never guessed in advance.
const EXTRA_HOLIDAYS: Record<number, { date: string; name: string }[]> = {};

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher) for the date of
// Easter Sunday in a given year - needed because Good Friday and Family
// Day (Easter Monday) move every year and can't be a fixed lookup.
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysUTC(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

// All public holidays for one calendar year, sorted by date. Computed
// (not hardcoded) so Easter-derived dates and the "falls on a Sunday"
// Monday rule (s2A) are always right, including for a year not yet in the
// 2025-2027 range this file was authored for.
export function holidaysForYear(year: number): Holiday[] {
  const out: Holiday[] = [];

  for (const h of FIXED_DATE_HOLIDAYS) {
    const d = new Date(Date.UTC(year, h.month - 1, h.day));
    out.push({ date: toDateStr(d), name: h.name });
    // s2A: a fixed-date holiday on a Sunday (getUTCDay() === 0) moves the
    // following Monday to "Public holiday".
    if (d.getUTCDay() === 0) {
      out.push({ date: toDateStr(addDaysUTC(d, 1)), name: `Public holiday (${h.name} falls on a Sunday)` });
    }
  }

  const easter = easterSunday(year);
  out.push({ date: toDateStr(addDaysUTC(easter, -2)), name: "Good Friday" });
  out.push({ date: toDateStr(addDaysUTC(easter, 1)), name: "Family Day" });

  for (const extra of EXTRA_HOLIDAYS[year] ?? []) out.push(extra);

  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

const holidaySetCache = new Map<number, Set<string>>();

function holidaySet(year: number): Set<string> {
  let s = holidaySetCache.get(year);
  if (!s) {
    s = new Set(holidaysForYear(year).map((h) => h.date));
    holidaySetCache.set(year, s);
  }
  return s;
}

export function isPublicHoliday(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  return holidaySet(d.getUTCFullYear()).has(dateStr);
}

// Saturday or Sunday (SA has no other weekend convention for tender
// closing-date purposes).
export function isWeekend(dateStr: string): boolean {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

export function isBusinessDay(dateStr: string): boolean {
  return !isWeekend(dateStr) && !isPublicHoliday(dateStr);
}

// Adds N working days (business days, excluding weekends and SA public
// holidays) to a start date. N may be negative to go backwards. The start
// date itself is never counted - "5 business days from Monday" lands on
// the following Monday if there's no holiday in between, matching how
// tender documents phrase "N working days from the date of this notice".
export function addBusinessDays(startDateStr: string, n: number): string {
  let d = new Date(startDateStr + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${startDateStr}`);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    d = addDaysUTC(d, step);
    if (isBusinessDay(toDateStr(d))) remaining -= 1;
  }
  return toDateStr(d);
}

// Counts business days strictly between two dates (exclusive of the start
// date, inclusive of the end date when it is itself a business day) -
// i.e. "how many working days until the tender closes", counted the way a
// countdown would: today doesn't count, the closing day does if it's a
// business day. Returns a negative count if endDateStr is before
// startDateStr (counted the same way, backwards).
export function businessDaysBetween(startDateStr: string, endDateStr: string): number {
  const start = new Date(startDateStr + "T00:00:00Z");
  const end = new Date(endDateStr + "T00:00:00Z");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid date");
  }
  const forward = end.getTime() >= start.getTime();
  let d = start;
  let count = 0;
  while (true) {
    d = addDaysUTC(d, forward ? 1 : -1);
    const cmp = forward ? d.getTime() <= end.getTime() : d.getTime() >= end.getTime();
    if (!cmp) break;
    if (isBusinessDay(toDateStr(d))) count += forward ? 1 : -1;
  }
  return count;
}
