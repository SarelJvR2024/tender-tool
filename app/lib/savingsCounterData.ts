import type { SupabaseClient } from "@supabase/supabase-js";
import {
  aggregateSavings,
  DEFAULT_TIME_SPENT_HOURS_PER_TENDER,
  extraCapacity,
  hoursSavedPerCompletedTender,
  resolveBaseline,
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
 *
 * Each tender now contributes AT MOST ONE row (the unique constraint on
 * (company_id, tender_id, step_key) with a single fixed step_key - see
 * recordSavingsStep() below), so there's no longer anything to group/sum
 * per tender before aggregating: each row's own `hours` IS that tender's
 * already-computed hours-saved snapshot.
 */
export async function fetchSavingsCounterSummary(supabase: SupabaseClient): Promise<SavingsCounterSummary | null> {
  const [{ data: company }, { data: rows }] = await Promise.all([
    supabase.from("companies").select("savings_baseline_hours_per_tender, savings_baseline_hourly_cost_zar").maybeSingle(),
    supabase.from("savings_counted_steps").select("hours, counted_at").order("counted_at", { ascending: true }),
  ]);
  if (!company) return null;

  const baseline = resolveBaseline(
    company.savings_baseline_hours_per_tender as number | null,
    company.savings_baseline_hourly_cost_zar as number | null,
  );
  const allRows = (rows ?? []) as { hours: number; counted_at: string }[];

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthRows = allRows.filter((r) => new Date(r.counted_at) >= monthStart);

  const summaryFor = (periodRows: typeof allRows): SavingsTotals =>
    aggregateSavings(periodRows.map((r) => r.hours), baseline.hourlyCostZar);

  const thisMonth = summaryFor(thisMonthRows);
  const allTime = summaryFor(allRows);

  return {
    thisMonth,
    allTime,
    extraCapacityThisMonth: extraCapacity(thisMonth.hoursSaved, baseline.hoursPerTender),
    baselineHoursPerTender: baseline.hoursPerTender,
    hourlyCostZar: baseline.hourlyCostZar,
    usingDefaultBaseline: baseline.isDefault,
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

/** "How we calculate this" breakdown for one tender's final review (§9.3) - the real inputs behind the figure, not a per-step list (the old six-step breakdown no longer exists - see lib/savingsCounter.ts's own header comment on the 2026-10-26 model change). */
export async function fetchTenderSavingsBreakdown(
  supabase: SupabaseClient,
  tenderId: string,
): Promise<{
  completed: boolean;
  hoursSaved: number;
  randSaved: number;
  baselineHoursPerTender: number;
  timeSpentHoursPerTender: number;
  hourlyCostZar: number;
  usingDefaultBaseline: boolean;
}> {
  const [{ data: company }, { data: row }] = await Promise.all([
    supabase.from("companies").select("savings_baseline_hours_per_tender, savings_baseline_hourly_cost_zar").maybeSingle(),
    supabase.from("savings_counted_steps").select("hours").eq("tender_id", tenderId).maybeSingle(),
  ]);

  const baseline = resolveBaseline(
    company?.savings_baseline_hours_per_tender as number | null | undefined,
    company?.savings_baseline_hourly_cost_zar as number | null | undefined,
  );

  // The counted row's own snapshot, not re-derived from the company's
  // CURRENT baseline - a later baseline change must never rewrite a past
  // tender's own figure (same historical-accuracy rule the old per-step
  // model followed). Reconstruct the baseline THIS tender's own figure
  // actually used (hoursSaved + the fixed time-spent constant) rather than
  // showing the company's current baseline next to it - the two could
  // differ if the baseline changed since, which would make the modal's own
  // "X - Y = Z" arithmetic look wrong even though neither number is.
  const hoursSaved = (row?.hours as number | undefined) ?? 0;
  const timeSpentHoursPerTender = DEFAULT_TIME_SPENT_HOURS_PER_TENDER;
  const baselineHoursPerTender = row != null ? hoursSaved + timeSpentHoursPerTender : baseline.hoursPerTender;
  return {
    completed: row != null,
    hoursSaved,
    randSaved: Math.round(hoursSaved * baseline.hourlyCostZar),
    baselineHoursPerTender,
    timeSpentHoursPerTender,
    hourlyCostZar: baseline.hourlyCostZar,
    usingDefaultBaseline: baseline.isDefault,
  };
}

const SAVINGS_STEP_KEY = "tender_pack_completed";

/**
 * Claims "this tender's submission pack reached ready" for the savings
 * counter - the once-per-tender dedupe IS the unique constraint on
 * savings_counted_steps (company_id, tender_id, step_key); a unique_violation
 * (Postgres code 23505) means it was already counted, which is the expected,
 * non-error outcome of a re-render, not a failure to surface.
 *
 * `hours` is computed here, once, from the company's baseline AT THE MOMENT
 * the tender's pack first became ready, and stored as a snapshot - if the
 * owner later changes the baseline, this tender's own already-counted
 * figure stays historically accurate rather than silently reinterpreting
 * itself (same principle the old per-step hours snapshot followed).
 */
export async function recordSavingsStep(
  supabase: SupabaseClient,
  params: { companyId: string; tenderId: string },
): Promise<boolean> {
  const { data: company } = await supabase
    .from("companies")
    .select("savings_baseline_hours_per_tender")
    .eq("id", params.companyId)
    .maybeSingle();
  const baselineHoursPerTender = resolveBaseline(company?.savings_baseline_hours_per_tender as number | null | undefined, undefined).hoursPerTender;
  const hours = hoursSavedPerCompletedTender(baselineHoursPerTender);

  const { error } = await supabase.from("savings_counted_steps").insert({
    company_id: params.companyId,
    tender_id: params.tenderId,
    step_key: SAVINGS_STEP_KEY,
    hours,
  });
  if (!error) return true;
  if (error.code === "23505") return false; // already counted - expected on a re-render
  throw error;
}
