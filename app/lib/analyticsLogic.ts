// Pure calculation core for the analytics page (spec §10) - no Supabase call
// inside any of these, same split as lib/readiness.ts/lib/savingsCounter.ts:
// a DB-touching fetcher in app/analytics/page.tsx itself hands real rows to
// these functions, which stay unit-testable without a database.

export type DecidedStage = "won" | "lost";
export type DecidedEntry = { stage: DecidedStage; decidedAt: string };
export type TrendPoint = { month: string; won: number; lost: number };

// SAST is UTC+2 with no DST (same fact lib/dates.ts's closingDayOf() already
// relies on) - shared here so a timestamp is shifted into SAST calendar
// terms exactly once, the same way, everywhere this file needs "which
// calendar month does this real moment fall in".
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/**
 * "YYYY-MM-DDT..." -> "YYYY-MM", in SAST, not a naive slice of the raw
 * (UTC) timestamp string. `decidedAt` is tender_packs.stage_changed_at, a
 * `timestamptz` written by the database as a UTC instant (migration 0021:
 * `stage_changed_at := now()`) and read back over PostgREST as an ISO
 * string in UTC. A naive `.slice(0, 7)` of that string reads the UTC
 * calendar month, which is wrong for any decision recorded while its UTC
 * time-of-day is 22:00-23:59 - already the NEXT calendar day, and for the
 * last ~2 hours of a UTC month, the next MONTH, in SAST (e.g.
 * "2026-11-30T23:30:00Z" is 2026-12-01 01:30 SAST - real December, not
 * November). Found 2026-11-11, standing review: the exact bug class
 * lib/dates.ts's own daysUntil()/closingDayOf() header comment documents as
 * Finding 289/290 for a day-level diff, independently present here for a
 * month-level bucket because this function never called that shared
 * conversion - confirmed live, see analyticsLogic.spec.ts's own new
 * assertions. A decision made in that window used to silently land in the
 * Analytics "Win/loss trend" chart's PREVIOUS month's bar instead of its
 * real one.
 */
export function monthKey(dateStr: string): string {
  return new Date(new Date(dateStr).getTime() + SAST_OFFSET_MS).toISOString().slice(0, 7);
}

/**
 * The last `monthsBack` calendar months (oldest first, inclusive of the
 * current month), each with a won/lost count from `entries` whose
 * `decidedAt` falls in that month. Months with zero decisions still appear
 * at {won: 0, lost: 0} - a real trend has to show the quiet months too, not
 * skip straight to the next one with data (that would silently compress a
 * 6-month gap into what looks like back-to-back activity).
 *
 * The "current month" this anchors on is `now`'s own SAST calendar month
 * (same SAST_OFFSET_MS shift monthKey() uses), not `now.getFullYear()`/
 * `getMonth()` directly - those read the Node process's own local time
 * zone, which is UTC on every runtime this app actually deploys to (no TZ
 * env var is set anywhere in this repo; lib/dates.ts's own daysUntil()
 * header comment already established this for Vercel/GitHub Actions). Using
 * the un-shifted `now` left this function internally consistent (both the
 * bucket list and monthKey() agreed, since both were naively UTC) but still
 * wrong relative to the real SAST month a user is actually in - the same
 * "the SA tender world runs on real South African calendar days" principle
 * Finding 289 already established for daysUntil(), now for months too.
 */
export function buildWinLossTrend(entries: readonly DecidedEntry[], monthsBack: number, now: Date): TrendPoint[] {
  const nowSast = new Date(now.getTime() + SAST_OFFSET_MS);
  const anchorYear = nowSast.getUTCFullYear();
  const anchorMonth = nowSast.getUTCMonth(); // 0-indexed
  const points: TrendPoint[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const totalMonths = anchorYear * 12 + anchorMonth - i;
    const y = Math.floor(totalMonths / 12);
    const m = ((totalMonths % 12) + 12) % 12; // 0-indexed; totalMonths can go negative for a large monthsBack
    points.push({ month: `${y}-${String(m + 1).padStart(2, "0")}`, won: 0, lost: 0 });
  }
  const byMonth = new Map(points.map((p) => [p.month, p]));
  for (const e of entries) {
    const p = byMonth.get(monthKey(e.decidedAt));
    if (p) p[e.stage] += 1;
  }
  return points;
}

/** A plain "Month 'YY" label for one of buildWinLossTrend's "YYYY-MM" keys. */
export function monthLabel(monthKeyStr: string): string {
  const [year, month] = monthKeyStr.split("-").map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("en-ZA", { month: "short", year: "2-digit" });
}
