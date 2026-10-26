import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/tt/empty-state";
import { SavingsCalculationDialog } from "@/components/tt/savings-calculation-dialog";
import { DEFAULT_TIME_SPENT_HOURS_PER_TENDER, formatRand, type SavingsTotals } from "@/lib/savingsCounter";

export type SavingsCounterSummary = {
  thisMonth: SavingsTotals;
  allTime: SavingsTotals;
  extraCapacityThisMonth: number;
  baselineHoursPerTender: number;
  hourlyCostZar: number;
  /** Spec v3 §18: true when the company hasn't confirmed its own baseline, so every figure here used the 20h/R450 placeholder default rather than a real measured number. */
  usingDefaultBaseline: boolean;
  /** This company's own current plan price, when resolvable - powers "Pays for your subscription Nx over". Omitted (not guessed) when no active paid plan price exists (e.g. still on trial, or a custom Enterprise price). */
  monthlyPlanPriceZar?: number | null;
};

/**
 * Home cockpit / Analytics "Capacity Unlocked" card (Capacity Unlocked
 * brief, 2026-10-26 - supersedes the previous "Time and cost saved" copy).
 * Links hours of senior staff time reclaimed directly to extra tender
 * submissions a company can take on without hiring, rather than an
 * abstract "productivity" figure. Rand figures use the dedicated
 * `text-money` token (globals.css) per the locked §2 design system.
 */
export function SavingsCounterCard({
  summary,
  baselineHref = "/company?edit=1#savings-baseline",
}: {
  summary: SavingsCounterSummary | null;
  baselineHref?: string;
}) {
  if (!summary || summary.allTime.tendersCounted === 0) {
    return (
      <Card className="gap-2 px-5 py-4 shadow-sm">
        <EmptyState
          icon={Sparkles}
          title="Finish your first bid to see your capacity unlocked"
          description="Once a tender's submission pack has been generated, Tender Ready estimates the hours it saved you and the extra tenders that frees up capacity for."
          className="py-4"
        />
      </Card>
    );
  }

  const { thisMonth, allTime, extraCapacityThisMonth, baselineHoursPerTender, hourlyCostZar, usingDefaultBaseline, monthlyPlanPriceZar } = summary;
  const subscriptionMultiple =
    monthlyPlanPriceZar && monthlyPlanPriceZar > 0 ? Math.floor(thisMonth.randSaved / monthlyPlanPriceZar) : 0;

  return (
    <Card className="gap-3 px-5 py-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-accent uppercase">Capacity unlocked</span>
        <Link href={baselineHref} className="text-xs font-medium text-accent hover:underline">
          Your numbers
        </Link>
      </div>

      <div className="font-display text-xl font-medium leading-snug text-foreground">
        {extraCapacityThisMonth > 0
          ? `+${extraCapacityThisMonth} bid${extraCapacityThisMonth === 1 ? "" : "s"} this month`
          : "Estimated time and cost saved"}
      </div>

      {thisMonth.tendersCounted > 0 && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          You saved {thisMonth.hoursSaved} hour{thisMonth.hoursSaved === 1 ? "" : "s"} of senior staff time across{" "}
          {thisMonth.tendersCounted} tender{thisMonth.tendersCounted === 1 ? "" : "s"} this month.{" "}
          {extraCapacityThisMonth > 0
            ? `That freed-up bandwidth gives your team the capacity to submit ${extraCapacityThisMonth} more tender${extraCapacityThisMonth === 1 ? "" : "s"} this month without adding payroll.`
            : "Keep completing tenders through Tender Ready to build up capacity for an extra bid without hiring."}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Hours reclaimed (this month)</div>
          <div className="font-display text-xl font-medium text-foreground">{thisMonth.hoursSaved} hrs</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Estimated value</div>
          <div className="font-display text-xl font-medium text-money">{formatRand(thisMonth.randSaved)}</div>
          {subscriptionMultiple >= 1 && (
            <div className="text-[11px] text-muted-foreground">Pays for your subscription {subscriptionMultiple}× over</div>
          )}
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground">
        All time: {allTime.hoursSaved} hrs · <span className="text-money">{formatRand(allTime.randSaved)}</span>
      </div>

      <div className="text-[11px] leading-relaxed text-muted-foreground">
        {usingDefaultBaseline ? (
          <>
            Using a default estimate (20h/R450 per tender) - we don&apos;t have your own numbers yet.{" "}
            <Link href={baselineHref} className="underline hover:text-foreground">
              Confirm your baseline
            </Link>
            .{" "}
          </>
        ) : (
          <>Estimated, based on your own numbers. </>
        )}
        ·{" "}
        <SavingsCalculationDialog
          baselineHoursPerTender={baselineHoursPerTender}
          timeSpentHoursPerTender={DEFAULT_TIME_SPENT_HOURS_PER_TENDER}
          hourlyCostZar={hourlyCostZar}
          tendersCounted={thisMonth.tendersCounted}
          totalHoursSaved={thisMonth.hoursSaved}
          usingDefaultBaseline={usingDefaultBaseline}
          baselineHref={baselineHref}
        />
      </div>
    </Card>
  );
}
