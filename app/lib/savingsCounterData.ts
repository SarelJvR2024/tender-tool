import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aggregateSavings,
  extraCapacity,
  hoursSavedForTender,
  resolveBaseline,
  SAVINGS_STEP_HOURS,
  type SavingsStepKey,
  type SavingsTotals,
} from "./savingsCounter";
import type { SavingsCounterSummary } from "@/components/tt/savings-counter-card";

// SAST is UTC+2 with no DST (same fact lib/dates.ts's closingDayOf() and
// analyticsLogic.ts's monthKey()/buildWinLossTrend() already rely on) -
// shared here so "this month" is computed in the same calendar terms
// everywhere this file needs it.
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/**
 * The real UTC instant of SAST midnight on the 1st of `now`'s own SAST
 * calendar month - NOT `new Date(now.getFullYear(), now.getMonth(), 1)`,
 * which reads the Node process's own local time zone. That's UTC on every
 * runtime this app actually deploys to (no TZ env var is set anywhere in
 * this repo - see lib/dates.ts's daysUntil() header comment), so for the
 * ~2 hours after real SAST midnight on the 1st of a month (while UTC's own
 * calendar is still on the LAST day of the PREVIOUS month), that naive
 * construction anchored "this month" on the just-ENDED month's own start
 * instead of the just-started real one - e.g. at 2026-11-30T23:30:00Z
 * (real 2026-12-01 01:30 SAST, already December for a South African user)
 * it returned 2026-11-01, so the whole of November still counted as "this
 * month". Found 2026-11-11, standing review: same naive-UTC-calendar-
 * boundary bug class as Finding 289/290 (day-level) and 413
 * (analyticsLogic.ts's monthKey(), month-level), independently present here
 * because this function never called that shared conversion.
 */
function sastMonthStart(now: Date): Date {
  const nowSast = new Date(now.getTime() + SAST_OFFSET_MS);
  return new Date(Date.UTC(nowSast.getUTCFullYear(), nowSast.getUTCMonth(), 1) - SAST_OFFSET_MS);
}

/**
 * Fetches the real `savings_counted_steps` rows and the company's own
 * baseline, then hands them to the pure functions in lib/savingsCounter.ts -
 * same split as lib/companyReadinessData.ts/lib/readiness.ts (a DB-touching
 * fetcher here, a unit-tested pure calculator there). RLS already scopes
 * savings_counted_steps to the signed-in user's own company (0085), so no
 * explicit company_id filter is needed on the select.
 *
 * Standing review, 2026-11-06: both reads used to be destructured as just
 * `{ data }`, with no error captured at all - a failed `companies` read
 * returned `company: null` (same as the real "no row yet" case), and a
 * failed `savings_counted_steps` read fell through the existing `rows ?? []`
 * fallback, same as a real "zero steps counted" company. Either way, the
 * caller (dashboard/analytics' own SavingsCounterCard) rendered the
 * ordinary "Finish your first bid to see your savings" empty state on a
 * real Supabase failure - the same silent-empty-state-on-error bug class
 * already fixed on `admin/tenders`/`market-intelligence`/`analytics`'s own
 * briefing-attendance section (System-Status.md, this entry's own
 * predecessor). Both errors are now captured, logged, and surfaced to the
 * caller as `error: true` instead of being swallowed.
 *
 * `now` is injectable only for tests (same convention as lib/dates.ts's
 * daysUntil()/lib/publicHolidays.ts's sastToday()); every real caller
 * leaves it as `new Date()`.
 */
export async function fetchSavingsCounterSummary(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<{ summary: SavingsCounterSummary | null; error: boolean }> {
  const [
    { data: company, error: companyError },
    { data: rows, error: rowsError },
  ] = await Promise.all([
    supabase.from("companies").select("savings_baseline_hours_per_tender, savings_baseline_hourly_cost_zar").maybeSingle(),
    supabase.from("savings_counted_steps").select("tender_id, hours, counted_at").order("counted_at", { ascending: true }),
  ]);
  if (companyError) console.error("companies select failed (savings counter)", companyError);
  if (rowsError) console.error("savings_counted_steps select failed (savings counter)", rowsError);
  const hadError = Boolean(companyError) || Boolean(rowsError);
  if (!company) return { summary: null, error: hadError };

  // Spec v3 §18: resolveBaseline() is the one place that decides "confirmed
  // or placeholder default" - previously this read the raw columns
  // directly, so an unconfirmed baseline (null) was cast straight to
  // `number`, and hoursSavedForTender's own Math.max(0, null)=>0 guard
  // silently zeroed every tender's hours saved rather than using the
  // documented 20h/R450 default - a real bug, not just a labeling gap: a
  // company that had completed real work but never visited the baseline
  // field saw "0h / R0 saved" instead of any estimate at all.
  const baseline = resolveBaseline(
    company.savings_baseline_hours_per_tender as number | null,
    company.savings_baseline_hourly_cost_zar as number | null,
  );
  const baselineHours = baseline.hoursPerTender;
  const hourlyCost = baseline.hourlyCostZar;
  const allRows = (rows ?? []) as { tender_id: string; hours: number; counted_at: string }[];

  const monthStart = sastMonthStart(now);
  const thisMonthRows = allRows.filter((r) => new Date(r.counted_at) >= monthStart);

  const summaryFor = (periodRows: typeof allRows): SavingsTotals => {
    const byTender = new Map<string, number[]>();
    for (const r of periodRows) {
      const list = byTender.get(r.tender_id) ?? [];
      list.push(r.hours);
      byTender.set(r.tender_id, list);
    }
    const perTenderHours = Array.from(byTender.values()).map((hoursList) => hoursSavedForTender(hoursList, baselineHours));
    return aggregateSavings(perTenderHours, hourlyCost);
  };

  const thisMonth = summaryFor(thisMonthRows);
  const allTime = summaryFor(allRows);

  return {
    summary: {
      thisMonth,
      allTime,
      extraCapacityThisMonth: extraCapacity(thisMonth.hoursSaved, thisMonth.tendersCounted, baselineHours),
      usingDefaultBaseline: baseline.isDefault,
    },
    error: hadError,
  };
}

/**
 * NOT WIRED UP - a hook, not a feature (per §9.4: "if the report doesn't
 * exist yet, leave a clearly marked hook. Don't fake it."). There is no
 * monthly-summary email/report infrastructure in this app at all yet (no
 * scheduled job sends one, and lib/emailTemplates.ts has no template for
 * it) - lib/deadlineReminders.ts's cron is the only scheduled email this
 * app sends today, and it's a per-tender deadline warning, not a monthly
 * digest. Building a real monthly summary needs: a cron route (matching
 * app/api/cron/deadline-reminders's own pattern), a dedupe table (matching
 * 0079_sent_deadline_reminders.sql's one-row-per-period pattern, keyed on
 * (company_id, year, month) this time), and an emailTemplates.ts template
 * using fetchSavingsCounterSummary() above plus the company's own
 * subscription price (lib/billing.ts's PLAN_MONTHLY_ZAR) for the "plan cost
 * vs value saved" comparison §9.4 asks for. None of that exists - do not
 * build a half-working version of it under this hook; build the real thing
 * (cron + dedupe table + template) as its own pass when asked for.
 */
export function monthlySummaryEmailNotYetBuilt(): never {
  throw new Error("Monthly savings summary email is not implemented yet - see this function's own comment in lib/savingsCounterData.ts for what it needs.");
}

export type CountedStepBreakdown = { stepKey: SavingsStepKey; reason: string; hours: number }[];

/** "How we worked this out" panel for one tender's final review (§9.3) - the steps actually counted for THIS tender, in the fixed step order, each with the reason text it was counted for. */
export async function fetchTenderSavingsBreakdown(
  supabase: SupabaseClient,
  tenderId: string,
): Promise<{ hoursSaved: number; randSaved: number; steps: CountedStepBreakdown; usingDefaultBaseline: boolean }> {
  const [{ data: company, error: companyErr }, { data: rows, error: rowsErr }] = await Promise.all([
    supabase.from("companies").select("savings_baseline_hours_per_tender, savings_baseline_hourly_cost_zar").maybeSingle(),
    supabase.from("savings_counted_steps").select("step_key, hours").eq("tender_id", tenderId),
  ]);
  // Standing review, 2026-11-06: 4th sweep blind spot (array/tuple
  // Promise.all destructures never match "const { data") - this function
  // (fetchTenderSavingsBreakdown, a sibling of fetchSavingsCounterSummary
  // above, already fixed for the same bug earlier today) was missed by
  // that same-file fix because it's a separate function. A failed `rows`
  // read understates this tender's own "how we worked this out" panel
  // (fewer counted steps shown, never more) - logged, not gated.
  if (companyErr) console.error("companies select failed (tender savings breakdown)", companyErr);
  if (rowsErr) console.error("savings_counted_steps select failed (tender savings breakdown)", rowsErr);

  // Spec v3 §18: same resolveBaseline() the Home/Analytics summary above
  // uses, so a company with no confirmed baseline sees the same "default,
  // not yet confirmed" signal here as everywhere else - previously this
  // function had its own separate `?? 20`/`?? 450` with no way for the UI
  // to tell it apart from a real confirmed 20/450.
  const baseline = resolveBaseline(
    company?.savings_baseline_hours_per_tender as number | null | undefined,
    company?.savings_baseline_hourly_cost_zar as number | null | undefined,
  );
  const countedRows = (rows ?? []) as { step_key: string; hours: number }[];

  const steps: CountedStepBreakdown = countedRows
    .filter((r): r is { step_key: SavingsStepKey; hours: number } => r.step_key in SAVINGS_STEP_HOURS)
    .map((r) => ({ stepKey: r.step_key, reason: SAVINGS_STEP_HOURS[r.step_key].reason, hours: r.hours }));

  const hoursSaved = hoursSavedForTender(countedRows.map((r) => r.hours), baseline.hoursPerTender);
  return {
    hoursSaved,
    randSaved: Math.round(hoursSaved * baseline.hourlyCostZar),
    steps,
    usingDefaultBaseline: baseline.isDefault,
  };
}

/**
 * Claims "step X was just completed for tender Y" - the once-per-tender
 * dedupe IS the unique constraint on savings_counted_steps (company_id,
 * tender_id, step_key); a unique_violation (Postgres code 23505) means it
 * was already counted, which is the expected, non-error outcome of a
 * re-run, not a failure to surface. Callers should call this from wherever
 * a step actually completes (pack generation, CV tailoring, etc.) and
 * ignore the return value - it's for tests/logging, not for gating anything.
 */
export async function recordSavingsStep(
  supabase: SupabaseClient,
  params: { companyId: string; tenderId: string; stepKey: SavingsStepKey },
): Promise<boolean> {
  const { hours } = SAVINGS_STEP_HOURS[params.stepKey];
  const { error } = await supabase.from("savings_counted_steps").insert({
    company_id: params.companyId,
    tender_id: params.tenderId,
    step_key: params.stepKey,
    hours,
  });
  if (!error) return true;
  if (error.code === "23505") return false; // already counted - expected on a re-run
  throw error;
}
