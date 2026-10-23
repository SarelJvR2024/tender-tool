import Link from "next/link";
import { BarChart3, CalendarClock, HelpCircle, Users2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../_components/AppShell";
import { StatCard } from "@/components/tt/stat-card";
import { EmptyState } from "@/components/tt/empty-state";
import { ErrorState } from "@/components/tt/error-state";
import { PIPELINE_STAGES, STAGE_META, type PipelineStage } from "@/lib/pipeline";
import { ECONOMICS_COLUMNS, formatRand, median, toNumber, type PackEconomics } from "@/lib/dealEconomics";
import { buildWinLossTrend, monthLabel } from "@/lib/analyticsLogic";
import { fetchSavingsCounterSummary } from "@/lib/savingsCounterData";
import { fetchAllRows } from "@/lib/supabasePaging";
import { SavingsCounterCard } from "@/components/tt/savings-counter-card";
import { loadOutcomesForTenders, ownPosition, firmsMet, benchmark, bestOutcome, MIN_SAMPLE, type OutcomeStats } from "@/lib/marketPricing";

/**
 * Analytics (spec §10): "own bid activity, outcomes, upcoming deadlines,
 * win/loss trends, submission values, briefing attendance, pricing trends
 * and competitor/market insights ONLY WHERE RELIABLE DATA EXISTS. Otherwise
 * show an honest empty state, not sample charts presented as real."
 *
 * Audited before building anything (see app/AGENTS.md's own entry for the
 * full dimension-by-dimension finding): every section below reads real rows
 * this app already writes elsewhere - nothing here is sample/placeholder
 * data. Two dimensions the spec names have no real backing in this app yet
 * (true cross-tender pricing-trend history beyond what lib/marketPricing.ts
 * already computes per segment, and a dedicated briefing-attendance table
 * beyond the one task-per-tender status already tracked) - those get the
 * honest empty state the spec explicitly asks for, not an invented chart.
 */
export const instant = false;

// "tenders" (migration 0001: "Shared across every company - not
// tenant-scoped") is unbounded and grows every day the discovery pipeline
// runs - this page's own read had no .range() AND no .order() at all, so
// once the shared table passes PostgREST's 1000-row response cap it would
// silently return an arbitrary, unstable 1000-row slice (same bug class as
// PR #111's marketPricing.ts fix - "silently reading a 2.5% sample, not the
// real table"). Paginated with the same fetchAllRows() helper; 20,000 is
// headroom above any plausible current row count, not a measurement.
const TENDERS_FETCH_CAP = 20_000;

type TenderRow = {
  id: string;
  closing_date: string | null;
  title: string | null;
  buyer: string | null;
  tender_packs: ({ pipeline_stage: PipelineStage; stage_changed_at: string | null; submitted_at: string | null } & PackEconomics)[];
};

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const [{ rows: tenderRows, error }, { data: company }, { data: briefingTasks }, savingsSummary] = await Promise.all([
    fetchAllRows<TenderRow>(
      (from, to) =>
        supabase
          .from("tenders")
          .select(`id, closing_date, title, buyer, tender_packs(pipeline_stage, stage_changed_at, submitted_at, ${ECONOMICS_COLUMNS})`)
          .range(from, to),
      TENDERS_FETCH_CAP,
    ),
    supabase.from("companies").select("legal_name, csd_trading_name").maybeSingle(),
    supabase.from("tender_tasks").select("status").eq("kind", "briefing"),
    fetchSavingsCounterSummary(supabase),
  ]);

  if (error) {
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-8">
          <ErrorState description="Couldn't load your bid activity - try refreshing. If it keeps happening, let us know." />
        </div>
      </AppShell>
    );
  }

  const tenders = (tenderRows ?? []) as TenderRow[];
  const packed = tenders
    .map((t) => ({ tender: t, pack: t.tender_packs?.[0] ?? null }))
    .filter((r): r is { tender: TenderRow; pack: NonNullable<TenderRow["tender_packs"][number]> } => !!r.pack);

  // ----- 1. Own bid activity & outcomes -----
  const byStage = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0])) as Record<PipelineStage, number>;
  for (const { pack } of packed) byStage[pack.pipeline_stage] += 1;
  const decided = byStage.won + byStage.lost;
  const winRate = decided === 0 ? null : Math.round((byStage.won / decided) * 100);

  // ----- 2. Upcoming deadlines (active tenders, closing in the future) -----
  const now = new Date();
  const ACTIVE: PipelineStage[] = ["found", "bidding", "submitted"];
  const upcoming = packed
    .filter((r) => ACTIVE.includes(r.pack.pipeline_stage) && r.tender.closing_date && new Date(r.tender.closing_date) >= now)
    .sort((a, b) => (a.tender.closing_date as string).localeCompare(b.tender.closing_date as string))
    .slice(0, 8);

  // ----- 3. Win/loss trend (last 6 months, bucketed from stage_changed_at) -----
  const decidedEntries = packed
    .filter((r): r is typeof r & { pack: { stage_changed_at: string } } => (r.pack.pipeline_stage === "won" || r.pack.pipeline_stage === "lost") && !!r.pack.stage_changed_at)
    .map((r) => ({ stage: r.pack.pipeline_stage as "won" | "lost", decidedAt: r.pack.stage_changed_at }));
  const trend = buildWinLossTrend(decidedEntries, 6, now);
  const trendMax = Math.max(1, ...trend.map((p) => p.won + p.lost));

  // ----- 4. Submission values -----
  const submittedPrices = packed
    .map((r) => toNumber(r.pack.submitted_price_zar))
    .filter((v): v is number => v !== null && v > 0);
  const totalSubmittedValue = submittedPrices.reduce((s, v) => s + v, 0);
  const medianSubmittedValue = median(submittedPrices);

  // ----- 5. Briefing attendance (real, but thin - a single task status per tender, not a dedicated attendance log) -----
  const briefingRows = (briefingTasks ?? []) as { status: string }[];
  const briefingDone = briefingRows.filter((r) => r.status === "done").length;

  // ----- 6. Pricing trends & competitor/market insights (lib/marketPricing.ts, real, already built for the per-tender market-context view - rolled up here across every tender this company has engaged) -----
  const tenderIds = tenders.map((t) => t.id);
  const { byTender: outcomesByTender } = await loadOutcomesForTenders(supabase, tenderIds);
  const companyNames = [company?.legal_name, company?.csd_trading_name];
  const matched: { outcome: import("@/lib/marketPricing").TenderOutcome; position: ReturnType<typeof ownPosition> }[] = [];
  for (const { tender, pack } of packed) {
    const outcome = bestOutcome(outcomesByTender.get(tender.id));
    if (!outcome) continue;
    const position = ownPosition(outcome, companyNames, toNumber(pack.submitted_price_zar));
    if (position.found !== "not_found") matched.push({ outcome, position });
  }
  const competitors = firmsMet(matched);
  const statsRows: OutcomeStats[] = matched.map(({ outcome }) => outcome);
  const ownBenchmark = statsRows.length > 0 ? benchmark(statsRows) : null;
  const hasMarketData = !!ownBenchmark && ownBenchmark.n >= MIN_SAMPLE;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-8">
        <h1 className="mb-1 font-display text-xl font-medium text-foreground sm:text-2xl">Analytics</h1>
        <p className="mb-5 text-sm text-muted-foreground">
          Your own bid activity, outcomes and savings - real numbers from your own tenders, with an honest empty state
          wherever this app doesn&apos;t yet have reliable data to show.
        </p>

        {/* 1. Bid activity & outcomes */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Tenders tracked" value={packed.length} />
          <StatCard label="Submitted to date" value={byStage.submitted + byStage.won + byStage.lost} />
          <StatCard label="Win rate" value={winRate === null ? "-" : `${winRate}%`} tone={winRate !== null && winRate >= 50 ? "success" : "default"} />
          <StatCard label="Total submitted value" value={formatRand(totalSubmittedValue)} tone="money" />
        </div>
        <p className="-mt-3 mb-6 text-xs text-muted-foreground">
          {byStage.found} discovered · {byStage.bidding} being prepared · {byStage.submitted} awaiting outcome · {byStage.won} won ·{" "}
          {byStage.lost} lost
        </p>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* 2. Upcoming deadlines */}
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
              <h2 className="text-sm font-semibold text-foreground">Upcoming deadlines</h2>
            </div>
            {upcoming.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="Nothing closing soon"
                description="Tenders you're actively tracking with a known closing date will show up here."
                className="py-6"
              />
            ) : (
              <ul className="space-y-2.5">
                {upcoming.map(({ tender }) => {
                  const days = Math.ceil((new Date(tender.closing_date as string).getTime() - now.getTime()) / 86_400_000);
                  return (
                    <li key={tender.id} className="flex items-center justify-between gap-3 border-t border-border pt-2.5 first:border-t-0 first:pt-0">
                      <Link href={`/tenders/${tender.id}`} className="min-w-0 flex-1 truncate text-sm text-foreground no-underline hover:text-accent hover:underline">
                        {tender.title || tender.buyer || "Untitled tender"}
                      </Link>
                      <span className={`shrink-0 text-xs font-medium ${days <= 7 ? "text-warning" : "text-muted-foreground"}`}>
                        {days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 3. Win/loss trend */}
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <BarChart3 className="size-4 text-muted-foreground" aria-hidden />
              <h2 className="text-sm font-semibold text-foreground">Win/loss trend (last 6 months)</h2>
            </div>
            {decided === 0 ? (
              <EmptyState icon={BarChart3} title="No decided bids yet" description="Once a submitted tender is marked won or lost, its trend shows up here." className="py-6" />
            ) : (
              <>
                <div className="flex h-32 items-end gap-2.5">
                  {trend.map((p) => (
                    <div key={p.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                      <div className="flex h-24 w-full flex-col justify-end gap-0.5" title={`${monthLabel(p.month)}: ${p.won} won, ${p.lost} lost`}>
                        {p.lost > 0 && <div className="w-full rounded-t-sm bg-destructive/60" style={{ height: `${(p.lost / trendMax) * 100}%` }} />}
                        {p.won > 0 && <div className="w-full rounded-t-sm bg-success" style={{ height: `${(p.won / trendMax) * 100}%` }} />}
                      </div>
                      <span className="text-[10px] text-muted-foreground">{monthLabel(p.month)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-success" /> Won</span>
                  <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-destructive/60" /> Lost</span>
                </div>
              </>
            )}
          </section>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* 4. Submission values */}
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Submission values</h2>
            {submittedPrices.length === 0 ? (
              <EmptyState icon={BarChart3} title="No priced submissions yet" description="Record a submitted price on a tender's pack and its value shows up here." className="py-6" />
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Total submitted" value={formatRand(totalSubmittedValue)} tone="money" className="shadow-none" />
                <StatCard label="Median bid" value={formatRand(medianSubmittedValue ?? 0)} tone="money" className="shadow-none" />
              </div>
            )}
          </section>

          {/* 5. Briefing attendance */}
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2">
              <HelpCircle className="size-4 text-muted-foreground" aria-hidden />
              <h2 className="text-sm font-semibold text-foreground">Briefing attendance</h2>
            </div>
            {briefingRows.length === 0 ? (
              <EmptyState icon={HelpCircle} title="No compulsory briefings tracked yet" description="A tender with a compulsory briefing session adds a task for it - attendance shows up here once one exists." className="py-6" />
            ) : (
              <>
                <div className="font-display text-3xl font-medium text-foreground">
                  {briefingDone} <span className="text-base font-normal text-muted-foreground">of {briefingRows.length}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Compulsory briefing sessions confirmed attended, across every tender that named one.</p>
              </>
            )}
          </section>
        </div>

        {/* 6. Pricing trends & competitor/market insights */}
        <section className="mb-6 rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <Users2 className="size-4 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold text-foreground">Pricing trends &amp; who you compete against</h2>
          </div>
          {!hasMarketData ? (
            <EmptyState
              icon={Users2}
              title="Not enough published outcomes matched yet"
              description={
                ownBenchmark && ownBenchmark.n > 0
                  ? `Only ${ownBenchmark.n} of your tenders have a published award outcome - at least ${MIN_SAMPLE} are needed before a benchmark is reliable enough to show.`
                  : "Once buyers publish award outcomes for tenders you've bid on, real pricing and competitor benchmarks show up here - not before."
              }
              className="py-6"
            />
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your own benchmark ({ownBenchmark.n} matched tenders)</div>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Lowest bid won</dt><dd className="font-medium text-foreground">{ownBenchmark.lowestWon.n > 0 ? `${Math.round((ownBenchmark.lowestWon.won / ownBenchmark.lowestWon.n) * 100)}% of the time` : "-"}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Median bidders per tender</dt><dd className="font-medium text-foreground">{ownBenchmark.bidders.median ?? "-"}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Median contract size</dt><dd className="font-medium text-money">{ownBenchmark.contractSize.median ? formatRand(ownBenchmark.contractSize.median) : "-"}</dd></div>
                </dl>
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Firms you&apos;ve met on these tenders</div>
                {competitors.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No other named bidders matched on these registers.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {competitors.slice(0, 5).map((f) => (
                      <li key={f.name} className="flex justify-between">
                        <span className="min-w-0 truncate text-foreground">{f.name}</span>
                        <span className="shrink-0 text-muted-foreground">met {f.met}×{f.theyWon > 0 ? `, won ${f.theyWon}×` : ""}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            From published award outcomes (eTenders, SANRAL) matched against your own tenders by name and recorded price - never guessed. A
            match below {MIN_SAMPLE} tenders isn&apos;t shown; see a single tender&apos;s own workspace for its market context regardless of
            this sample size.
          </p>
        </section>

        {/* 7. Savings (spec §9, reused here per spec §10's own instruction) */}
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Time and cost saved</h2>
          <SavingsCounterCard summary={savingsSummary} />
        </section>
      </div>
    </AppShell>
  );
}
