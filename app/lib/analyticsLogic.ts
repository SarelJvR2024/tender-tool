// Pure calculation core for the analytics page (spec §10) - no Supabase call
// inside any of these, same split as lib/readiness.ts/lib/savingsCounter.ts:
// a DB-touching fetcher in app/analytics/page.tsx itself hands real rows to
// these functions, which stay unit-testable without a database.

export type DecidedStage = "won" | "lost";
export type DecidedEntry = { stage: DecidedStage; decidedAt: string };
export type TrendPoint = { month: string; won: number; lost: number };

/** "YYYY-MM-DDT..." -> "YYYY-MM". */
export function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}

/**
 * The last `monthsBack` calendar months (oldest first, inclusive of the
 * current month), each with a won/lost count from `entries` whose
 * `decidedAt` falls in that month. Months with zero decisions still appear
 * at {won: 0, lost: 0} - a real trend has to show the quiet months too, not
 * skip straight to the next one with data (that would silently compress a
 * 6-month gap into what looks like back-to-back activity).
 */
export function buildWinLossTrend(entries: readonly DecidedEntry[], monthsBack: number, now: Date): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    points.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, won: 0, lost: 0 });
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
