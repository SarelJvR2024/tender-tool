import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/tt/empty-state";
import { formatRand, type SavingsTotals } from "@/lib/savingsCounter";

export type SavingsCounterSummary = {
  thisMonth: SavingsTotals;
  allTime: SavingsTotals;
  extraCapacityThisMonth: number;
};

/**
 * Home cockpit "Time and cost saved" card (spec §9.3). No dedicated "money"
 * design-system token exists yet (the locked §2 table calls for one - "one
 * dedicated accent colour, used only for Rand amounts" - but it was never
 * actually added to globals.css), so Rand figures here reuse the existing
 * `text-accent` blue rather than inventing a new token outside this
 * feature's own scope - see app/AGENTS.md's savings-counter entry.
 */
export function SavingsCounterCard({
  summary,
  baselineHref = "/company#savings-baseline",
}: {
  summary: SavingsCounterSummary | null;
  baselineHref?: string;
}) {
  if (!summary || summary.allTime.tendersCounted === 0) {
    return (
      <Card className="gap-2 px-5 py-4 shadow-sm">
        <EmptyState
          icon={Sparkles}
          title="Finish your first bid to see your savings"
          description="Once a tender's compliance check, vault documents, CVs or pack have been completed, Tender Ready estimates the hours and Rand it saved you."
          className="py-4"
        />
      </Card>
    );
  }

  const { thisMonth, allTime, extraCapacityThisMonth } = summary;

  return (
    <Card className="gap-3 px-5 py-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Time and cost saved</span>
        <Link href={baselineHref} className="text-xs font-medium text-accent hover:underline">
          Your numbers
        </Link>
      </div>

      <div className="font-display text-xl font-medium leading-snug text-foreground">
        {extraCapacityThisMonth > 0
          ? `Room for ${extraCapacityThisMonth} more tender${extraCapacityThisMonth === 1 ? "" : "s"} without hiring`
          : "Estimated time and cost saved"}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs text-muted-foreground">This month</div>
          <div className="font-display text-xl font-medium text-foreground">{thisMonth.hoursSaved}h</div>
          <div className="text-sm font-medium text-accent">{formatRand(thisMonth.randSaved)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">All time</div>
          <div className="font-display text-xl font-medium text-foreground">{allTime.hoursSaved}h</div>
          <div className="text-sm font-medium text-accent">{formatRand(allTime.randSaved)}</div>
        </div>
      </div>

      <div className="text-[11px] leading-relaxed text-muted-foreground">
        Estimated, based on your numbers -{" "}
        <Link href={baselineHref} className="underline hover:text-foreground">
          update your baseline
        </Link>
        .
      </div>
    </Card>
  );
}
