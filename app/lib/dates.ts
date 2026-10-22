// Shared "N days until a date" math, used anywhere a closing date or expiry
// date needs a day count: tenders closing (dashboard), documents expiring
// (company vault). Normalizes "today" to midnight first so the count is
// stable all day rather than decrementing as the clock ticks forward within
// the same day.
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  // An unreadable date gave NaN, and every NaN comparison is false - so
  // expiryStatus() showed a malformed expiry as "Current" (green). Unknown
  // instead, the same as no date: never a confident wrong answer.
  if (Number.isNaN(target.getTime())) return null;
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

// Tone carries the status directly - no literal hex anywhere in this app
// (design-system color migration, spec §2). Previously this type held a
// literal {bg, color} hex pair and every renderer matched against those
// exact strings to recover a tone - fragile (silently fell through to
// "muted" if a hex value ever drifted) and exactly the hard-coded-colour
// pattern §2 forbids. "accent" is for a plain informational tag (e.g. a
// person's role tags), not a pass/fail judgement like the other four.
export type ChipTone = "success" | "warning" | "destructive" | "muted" | "accent";
export type StatusChip = { label: string; tone: ChipTone };

// Shared rule, driven directly by the real incident this exists to prevent:
// the CLI engine flagging a COID Letter of Good Standing as "expired" on
// every generated tender because nobody had a clear view of the expiry date
// on file. >60 days out = current, <=60 days = renew soon, past = expired,
// no date on file = grey/unknown (never treated as expired).
export function expiryStatus(dateStr: string | null, renewSoonWithinDays = 60): StatusChip {
  const left = daysUntil(dateStr);
  if (left === null) return { label: "Not on file", tone: "muted" };
  if (left < 0) return { label: "Expired", tone: "destructive" };
  if (left <= renewSoonWithinDays) return { label: "Renew soon", tone: "warning" };
  return { label: "Current", tone: "success" };
}
