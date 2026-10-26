"use client";

import Link from "next/link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatRand } from "@/lib/savingsCounter";

/**
 * "How we calculate this" breakdown (Capacity Unlocked brief, 2026-10-26) -
 * the real numbers behind the headline figure, not a marketing claim with
 * nothing to back it up. Shared by the Home/Analytics summary card (a
 * period total across several tenders) and the per-tender final-review
 * panel (one tender's own figure) - pass `tendersCounted` for the former,
 * omit it for the latter.
 */
export function SavingsCalculationDialog({
  baselineHoursPerTender,
  timeSpentHoursPerTender,
  hourlyCostZar,
  tendersCounted,
  totalHoursSaved,
  usingDefaultBaseline,
  baselineHref = "/company?edit=1#savings-baseline",
  trigger,
}: {
  baselineHoursPerTender: number;
  timeSpentHoursPerTender: number;
  hourlyCostZar: number;
  /** Omit for a single tender's own breakdown; pass the real count for a period total across several tenders. */
  tendersCounted?: number;
  /** Total hours saved across the period (or the one tender). Defaults to (baseline - timeSpent) x tendersCounted when omitted. */
  totalHoursSaved?: number;
  usingDefaultBaseline: boolean;
  baselineHref?: string;
  trigger?: React.ReactElement;
}) {
  const hoursSavedPerTender = Math.max(0, baselineHoursPerTender - timeSpentHoursPerTender);
  const count = tendersCounted ?? 1;
  const hoursSaved = totalHoursSaved ?? hoursSavedPerTender * count;
  const randSaved = Math.round(hoursSaved * hourlyCostZar);
  const extraCapacity = baselineHoursPerTender > 0 ? Math.floor(hoursSaved / baselineHoursPerTender) : 0;

  return (
    <Dialog>
      <DialogTrigger
        render={
          trigger ?? (
            <button type="button" className="text-xs font-medium text-accent underline-offset-2 hover:underline">
              How this is calculated
            </button>
          )
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>How we calculate this</DialogTitle>
          <DialogDescription>
            An estimate from your own numbers, not a universal average or a guarantee for every tender.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5 text-sm">
          <Row label="Baseline manual hours per tender" value={`${baselineHoursPerTender}h`} />
          <Row label="Time spent in Tender Ready" value={`${timeSpentHoursPerTender}h`} />
          <Row label="Hours saved per tender" value={`${hoursSavedPerTender}h`} emphasis />
          {tendersCounted !== undefined && (
            <>
              <div className="h-px bg-border" />
              <Row label="Tenders completed" value={`× ${count}`} />
              <Row label="Total hours saved" value={`${hoursSaved}h`} emphasis />
            </>
          )}
          <div className="h-px bg-border" />
          <Row label="Hourly cost baseline" value={`× R${hourlyCostZar}`} />
          <Row label="Estimated value" value={formatRand(randSaved)} emphasis money />
          {tendersCounted !== undefined && (
            <>
              <div className="h-px bg-border" />
              <Row
                label="Extra capacity unlocked"
                value={extraCapacity > 0 ? `+${extraCapacity} tender${extraCapacity === 1 ? "" : "s"}` : "—"}
              />
            </>
          )}
        </div>

        <div className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          {usingDefaultBaseline ? (
            <>
              Using a default estimate (20h/R450 per tender) - we don&apos;t have your own numbers yet.{" "}
              <Link href={baselineHref} className="underline hover:text-foreground">
                Edit baseline hours &amp; hourly rate
              </Link>
              .
            </>
          ) : (
            <>
              Based on your own confirmed baseline.{" "}
              <Link href={baselineHref} className="underline hover:text-foreground">
                Edit baseline hours &amp; hourly rate
              </Link>
              .
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, emphasis, money }: { label: string; value: string; emphasis?: boolean; money?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className={emphasis ? "font-medium text-foreground" : "text-muted-foreground"}>{label}</span>
      <span className={`shrink-0 ${money ? "font-display font-medium text-money" : emphasis ? "font-display font-medium text-foreground" : "text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}
