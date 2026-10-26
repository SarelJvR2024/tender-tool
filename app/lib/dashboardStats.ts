// Home dashboard stat-card math (app/dashboard/page.tsx), extracted so the
// "my own tenders vs. every company's tenders" distinction below is a pure,
// unit-tested function rather than inline page logic nobody could pin down
// with a test.
//
// `tenders` (migration 0001) is deliberately NOT tenant-scoped - its RLS
// policy is "readable by authenticated users", since it's shared public
// procurement data (SANRAL/NRA's own releases, growing every day the
// discovery pipeline runs), not one company's own record. `tender_packs`
// IS tenant-isolated. A plain Supabase select on `tenders` with
// `tender_packs(...)` embedded therefore returns EVERY tender in the whole
// system, with `tender_packs: []` for any tender this company has never
// pursued - not an empty result for a company with nothing tracked yet.
//
// Review finding, 2026-10-26: the dashboard's stat cards and its
// fresh-company empty-state check were reading that raw, system-wide list
// directly. stageOf() below falls back to "found" when a tender has no
// pack - a deliberate, correct default for a real pursued tender sitting
// at the "found" stage, but also the default for every OTHER company's
// untouched tender, since "found" IS one of IN_PROGRESS_STAGES. A fresh
// company with zero real activity saw "Active bids" counted from
// essentially the entire shared catalog, "Closing this week" from any
// tender closing soon regardless of who's pursuing it, and never saw the
// dedicated empty-state/setup-checklist UI at all, because `rows.length
// === 0` is never true once the shared table has any rows in it (it
// always does). myTenderRows() is the one filter every "my own tenders"
// count needs - requiring a real `tender_packs` row, which only exists
// once this company has actually started a pack on it.
import { daysUntil } from "./dates.ts";
import { IN_PROGRESS_STAGES } from "./pipeline.ts";

export type DashboardPack = {
  status: string;
  pipeline_stage: string;
};

export type DashboardTenderRow = {
  closing_date: string | null;
  tender_packs: DashboardPack[];
};

/** The pursued-or-not pipeline stage - "found" is also the correct default for a real pursued tender that simply hasn't moved yet, not just an absent pack. */
export function stageOf(tender: Pick<DashboardTenderRow, "tender_packs">): string {
  return tender.tender_packs[0]?.pipeline_stage ?? "found";
}

/** Whether this tender's pack is in the "Complete" state the "Packs ready" stat counts. */
export function isPackReady(tender: Pick<DashboardTenderRow, "tender_packs">): boolean {
  const pack = tender.tender_packs[0];
  return !!pack && (pack.status === "confirmed" || pack.status === "filled");
}

/** Tenders this company has actually pursued (a real tender_packs row exists) - the one list every "my own tenders" stat/branch needs, never the raw shared-table rows. */
export function myTenderRows<T extends DashboardTenderRow>(rows: T[]): T[] {
  return rows.filter((t) => t.tender_packs.length > 0);
}

export type DashboardStats<T extends DashboardTenderRow> = {
  myRows: T[];
  activeBidsCount: number;
  packsReadyCount: number;
  closingThisWeekCount: number;
};

export function computeDashboardStats<T extends DashboardTenderRow>(rows: T[], actionWindowDays: number): DashboardStats<T> {
  const myRows = myTenderRows(rows);
  const activeBidsCount = myRows.filter((t) => (IN_PROGRESS_STAGES as readonly string[]).includes(stageOf(t))).length;
  const packsReadyCount = myRows.filter(isPackReady).length;
  const closingThisWeekCount = myRows.filter((t) => {
    const left = daysUntil(t.closing_date);
    return left !== null && left >= 0 && left <= actionWindowDays;
  }).length;
  return { myRows, activeBidsCount, packsReadyCount, closingThisWeekCount };
}
