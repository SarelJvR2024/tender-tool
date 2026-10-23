import { BarChart3, Building2, MapPin, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../_components/AppShell";
import { StatCard } from "@/components/tt/stat-card";
import { EmptyState } from "@/components/tt/empty-state";
import { ErrorState } from "@/components/tt/error-state";
import { formatRand } from "@/lib/dealEconomics";
import { monthLabel } from "@/lib/analyticsLogic";
import { loadDisciplineTaxonomy, taxonomyLabel } from "@/lib/disciplineTaxonomy";
import {
  MIN_SAMPLE,
  SOURCE_LABEL,
  benchmark,
  byBuyer,
  byCategory,
  byProvince,
  loadMarketOutcomes,
  tenderFrequencyTrend,
  type Breakdown,
} from "@/lib/marketPricing";

/**
 * Market Intelligence: every public award this app has read (SANRAL +
 * eTenders, public_tender_outcomes), not scoped to this signed-in company's
 * own tenders - see marketPricing.ts's own "market-wide overview" section
 * comment for why this is a deliberate, separate thing from /analytics'
 * "Pricing trends" section (that one is this company's own matched bids
 * only). Sarel, 2026-10-22, verbatim: "lets build the anlaysis feature
 * including sanral data for now. there is alot of analysis we can build
 * based on all tenders which include sanrla and other tenders. assessming
 * tenders, scope, freuecny, wining biders amoutns, awards vs tender etc
 * start building what you can."
 *
 * SANRAL's own terms ("no charge ... upon any recipient of the material")
 * were the open question (docs/specs/Award-Outcomes-Findings.md §6, also
 * public_tender_outcomes' own migration comment) blocking exactly this kind
 * of page - resolved by that same instruction: shown only to signed-in,
 * paying customers using it for their own bidding decisions, never
 * resold to or built for non-bidders. Recorded in docs/specs/System-Status.md.
 *
 * Honesty: every breakdown's `n` is real and MIN_SAMPLE-gated the same way
 * /analytics' own benchmark section is; "awards vs tender" means the
 * winning bid against the field of bids ON THAT TENDER (winnerVsMedian /
 * lowestWon) - not against a published budget estimate, which this
 * backfilled universe mostly doesn't have (see the module comment).
 */
export const instant = false;

export default async function MarketIntelligencePage() {
  const supabase = await createClient();
  const [{ rows, error }, taxonomy] = await Promise.all([loadMarketOutcomes(supabase), loadDisciplineTaxonomy(supabase)]);

  if (error) {
    return (
      <AppShell>
        <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-8">
          <ErrorState description="Couldn't load market data - try refreshing. If it keeps happening, let us know." />
        </div>
      </AppShell>
    );
  }

  const now = new Date();
  const overall = benchmark(rows);
  const awarded = rows.filter((r) => r.status === "awarded");
  const frequency = tenderFrequencyTrend(rows, 12, now);
  const frequencyMax = Math.max(1, ...frequency.map((p) => p.count));
  const categories = byCategory(rows, (slug) => taxonomyLabel(taxonomy, slug)).filter((b) => b.n >= MIN_SAMPLE).slice(0, 10);
  const buyers = byBuyer(rows).filter((b) => b.n >= MIN_SAMPLE).slice(0, 8);
  const provinces = byProvince(rows).filter((b) => b.n >= MIN_SAMPLE).slice(0, 8);

  const hasEnoughData = overall.n >= MIN_SAMPLE;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 sm:px-8">
        <h1 className="mb-1 font-display text-xl font-medium text-foreground sm:text-2xl">Market intelligence</h1>
        <p className="mb-5 text-sm text-muted-foreground">
          Real published tender outcomes across every buyer this app reads (SANRAL, eTenders) - not just your own bids. An honest empty
          state wherever a group hasn&apos;t got enough real data yet.
        </p>

        {!hasEnoughData ? (
          <EmptyState
            icon={BarChart3}
            title="Not enough published outcomes yet"
            description={
              overall.n > 0
                ? `Only ${overall.n} published outcomes stored so far - at least ${MIN_SAMPLE} are needed before a market-wide view is reliable enough to show.`
                : "Once award outcomes are read from SANRAL and eTenders, a market-wide view shows up here - not before."
            }
            className="py-12"
          />
        ) : (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Tenders tracked" value={rows.length} />
              <StatCard label="Awarded" value={awarded.length} />
              <StatCard label="Median contract size" value={overall.contractSize.median ? formatRand(overall.contractSize.median) : "-"} tone="money" />
              <StatCard
                label="Lowest bid won"
                value={overall.lowestWon.n > 0 ? `${Math.round((overall.lowestWon.won / overall.lowestWon.n) * 100)}%` : "-"}
              />
            </div>
            <p className="-mt-3 mb-6 text-xs text-muted-foreground">
              {Object.entries(overall.sources)
                .map(([s, n]) => `${n} from ${SOURCE_LABEL[s] ?? s}`)
                .join(" · ")}
              {overall.dateFrom && overall.dateTo ? ` · ${overall.dateFrom} to ${overall.dateTo}` : ""}
            </p>

            {/* Frequency */}
            <section className="mb-6 rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <BarChart3 className="size-4 text-muted-foreground" aria-hidden />
                <h2 className="text-sm font-semibold text-foreground">Tender frequency (last 12 months)</h2>
              </div>
              <div className="flex h-32 items-end gap-1.5">
                {frequency.map((p) => (
                  <div key={p.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                    <div className="flex h-24 w-full flex-col justify-end" title={`${monthLabel(p.month)}: ${p.count} tender(s)`}>
                      <div className="w-full rounded-t-sm bg-accent" style={{ height: `${(p.count / frequencyMax) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{monthLabel(p.month)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">By award date, or closing date for a tender not yet awarded.</p>
            </section>

            {/* Awards vs the field */}
            <section className="mb-6 rounded-xl border border-border bg-card p-5">
              <div className="mb-3 flex items-center gap-2">
                <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
                <h2 className="text-sm font-semibold text-foreground">Winning bids vs. the field</h2>
              </div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Lowest bid won</div>
                  <div className="font-display text-2xl font-medium text-foreground">
                    {overall.lowestWon.n > 0 ? `${Math.round((overall.lowestWon.won / overall.lowestWon.n) * 100)}%` : "-"}
                  </div>
                  <p className="text-xs text-muted-foreground">of {overall.lowestWon.n} awards with a priced, single-contract register</p>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Winner vs. median bid</div>
                  <div className="font-display text-2xl font-medium text-foreground">
                    {overall.winnerVsMedian.median !== null ? `${Math.round(overall.winnerVsMedian.median * 100)}%` : "-"}
                  </div>
                  <p className="text-xs text-muted-foreground">of the median bid, typically ({overall.winnerVsMedian.n} awards)</p>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Bidders per tender</div>
                  <div className="font-display text-2xl font-medium text-foreground">{overall.bidders.median ?? "-"}</div>
                  <p className="text-xs text-muted-foreground">median ({overall.bidders.p25 ?? "-"}-{overall.bidders.p75 ?? "-"} typical range)</p>
                </div>
              </div>
            </section>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <BreakdownTable
                icon={BarChart3}
                title="By industry"
                rows={categories}
                emptyText={`No single industry has ${MIN_SAMPLE}+ published outcomes yet.`}
              />
              <BreakdownTable
                icon={Building2}
                title="By buyer"
                rows={buyers}
                emptyText={`No single buyer has ${MIN_SAMPLE}+ published outcomes yet.`}
              />
            </div>
            <div className="mt-4">
              <BreakdownTable
                icon={MapPin}
                title="By province"
                rows={provinces}
                emptyText={`No single province has ${MIN_SAMPLE}+ published outcomes yet (most records don't state one).`}
              />
            </div>
          </>
        )}

        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
          From published award outcomes (eTenders, SANRAL) - never guessed, never used to set or suggest your own price. A group below{" "}
          {MIN_SAMPLE} tenders isn&apos;t shown. &quot;Winner vs. median bid&quot; compares the winning price to the field of bids on the
          SAME tender, not to a published budget or estimate.
        </p>
      </div>
    </AppShell>
  );
}

function BreakdownTable({ icon: Icon, title, rows, emptyText }: { icon: typeof BarChart3; title: string; rows: Breakdown[]; emptyText: string }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Tenders</th>
                <th className="pb-2 pr-4 font-medium">Median size</th>
                <th className="pb-2 font-medium">Lowest won</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.key} className="border-t border-border">
                  <td className="min-w-0 max-w-[220px] truncate py-2 pr-4 text-foreground" title={b.label}>
                    {b.label}
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{b.n}</td>
                  <td className="py-2 pr-4 text-money">{b.benchmark.contractSize.median ? formatRand(b.benchmark.contractSize.median) : "-"}</td>
                  <td className="py-2 text-muted-foreground">
                    {b.benchmark.lowestWon.n > 0 ? `${Math.round((b.benchmark.lowestWon.won / b.benchmark.lowestWon.n) * 100)}%` : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
