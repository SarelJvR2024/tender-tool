import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aggregateSavings,
  extraCapacity,
  hoursSavedForTender,
  SAVINGS_STEP_HOURS,
  type SavingsStepKey,
  type SavingsTotals,
} from "./savingsCounter";
import type { SavingsCounterSummary } from "@/components/tt/savings-counter-card";

/**
 * Fetches the real `savings_counted_steps` rows and the company's own
 * baseline, then hands them to the pure functions in lib/savingsCounter.ts -
 * same split as lib/companyReadinessData.ts/lib/readiness.ts (a DB-touching
 * fetcher here, a unit-tested pure calculator there). RLS already scopes
 * savings_counted_steps to the signed-in user's own company (0085), so no
 * explicit company_id filter is needed on the select.
 */
export async function fetchSavingsCounterSummary(supabase: SupabaseClient): Promise<SavingsCounterSummary | null> {
  const [{ data: company }, { data: rows }] = await Promise.all([
    supabase.from("companies").select("savings_baseline_hours_per_tender, savings_baseline_hourly_cost_zar").maybeSingle(),
    supabase.from("savings_counted_steps").select("tender_id, hours, counted_at").order("counted_at", { ascending: true }),
  ]);
  if (!company) return null;

  const baselineHours = company.savings_baseline_hours_per_tender as number;
  const hourlyCost = company.savings_baseline_hourly_cost_zar as number;
  const allRows = (rows ?? []) as { tender_id: string; hours: number; counted_at: string }[];

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
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
    thisMonth,
    allTime,
    extraCapacityThisMonth: extraCapacity(thisMonth.hoursSaved, thisMonth.tendersCounted, baselineHours),
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
): Promise<{ hoursSaved: number; randSaved: number; steps: CountedStepBreakdown }> {
  const [{ data: company }, { data: rows }] = await Promise.all([
    supabase.from("companies").select("savings_baseline_hours_per_tender, savings_baseline_hourly_cost_zar").maybeSingle(),
    supabase.from("savings_counted_steps").select("step_key, hours").eq("tender_id", tenderId),
  ]);

  const baselineHours = (company?.savings_baseline_hours_per_tender as number | undefined) ?? 20;
  const hourlyCost = (company?.savings_baseline_hourly_cost_zar as number | undefined) ?? 450;
  const countedRows = (rows ?? []) as { step_key: string; hours: number }[];

  const steps: CountedStepBreakdown = countedRows
    .filter((r): r is { step_key: SavingsStepKey; hours: number } => r.step_key in SAVINGS_STEP_HOURS)
    .map((r) => ({ stepKey: r.step_key, reason: SAVINGS_STEP_HOURS[r.step_key].reason, hours: r.hours }));

  const hoursSaved = hoursSavedForTender(countedRows.map((r) => r.hours), baselineHours);
  return { hoursSaved, randSaved: Math.round(hoursSaved * hourlyCost), steps };
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
