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
