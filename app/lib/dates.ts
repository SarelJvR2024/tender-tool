// Shared "N days until a date" math, used anywhere a closing date or expiry
// date needs a day count: tenders closing (dashboard), documents expiring
// (company vault). Normalizes "today" to midnight first so the count is
// stable all day rather than decrementing as the clock ticks forward within
// the same day.
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.ceil((target.getTime() - today.getTime()) / msPerDay);
}

// The calendar day (South African time, UTC+2, no DST) a tender closes on,
// as "YYYY-MM-DD" - for comparing against a document's expiry DATE. Without
// this, a closing timestamp (e.g. 12:00 SAST = 10:00 UTC) counts as a later
// day than a date-only expiry on that same day (daysUntil ceil()s the
// fraction), so a document valid until the closing day was reported as
// "expires before this tender closes" (2026-10-17 scenario pass).
export function closingDayOf(closingDate: string | null): string | null {
  if (!closingDate) return null;
  const t = new Date(closingDate);
  if (Number.isNaN(t.getTime())) return null;
  return new Date(t.getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type StatusChip = { label: string; bg: string; color: string };

const GREEN = { bg: "#DCFCE7", color: "#15803D" };
const AMBER = { bg: "#FEF3C7", color: "#B45309" };
const RED = { bg: "#FEE2E2", color: "#B91C1C" };
const GREY = { bg: "#F0EEE6", color: "#6B6758" };

// Shared rule, driven directly by the real incident this exists to prevent:
// the CLI engine flagging a COID Letter of Good Standing as "expired" on
// every generated tender because nobody had a clear view of the expiry date
// on file. >60 days out = current, <=60 days = renew soon, past = expired,
// no date on file = grey/unknown (never treated as expired).
export function expiryStatus(dateStr: string | null, renewSoonWithinDays = 60): StatusChip {
  const left = daysUntil(dateStr);
  if (left === null) return { label: "Not on file", ...GREY };
  if (left < 0) return { label: "Expired", ...RED };
  if (left <= renewSoonWithinDays) return { label: "Renew soon", ...AMBER };
  return { label: "Current", ...GREEN };
}
