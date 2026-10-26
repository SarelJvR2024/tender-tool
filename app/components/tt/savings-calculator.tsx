"use client";

import { useState } from "react";
import { PLAN_MONTHLY_ZAR } from "@/lib/billing";
import { SAVINGS_STEP_HOURS, formatRand, hoursSavedForTender } from "@/lib/savingsCounter";

const TYPICAL_HOURS_SAVED_PER_TENDER = Object.values(SAVINGS_STEP_HOURS).reduce((sum, s) => sum + s.hours, 0);
const PROFESSIONAL_MONTHLY_ZAR = PLAN_MONTHLY_ZAR.professional as number;

/**
 * Pricing-page savings calculator (spec §9.5). A marketing estimate, not the
 * real per-tender counter (lib/savingsCounterData.ts) - there's no real
 * tender to read actual counted steps from here, so this assumes a
 * "typical" tender saves the sum of every configured step's placeholder
 * hours (the same SAVINGS_STEP_HOURS the real counter uses - not a
 * separately invented number), capped at whatever baseline the visitor
 * types in, then reuses formatRand() the real Home counter card uses, for
 * the same reason billing.ts reuses PLAN_MONTHLY_ZAR instead of a 4th
 * hardcoded price: one formula, checked once, not quietly reinvented per
 * surface. All three result stats are kept on the same annual basis -
 * see the extraTendersPerYear comment below for why this isn't just a
 * label swap.
 */
export function SavingsCalculator() {
  const [tendersPerMonth, setTendersPerMonth] = useState(2);
  const [hoursPerTender, setHoursPerTender] = useState(20);
  const [hourlyCost, setHourlyCost] = useState(450);

  const typicalHoursSaved = hoursSavedForTender([TYPICAL_HOURS_SAVED_PER_TENDER], Math.max(0, hoursPerTender));
  const hoursSavedPerMonth = Math.max(0, tendersPerMonth) * typicalHoursSaved;
  const yearlyHours = hoursSavedPerMonth * 12;
  const yearlyRand = Math.round(yearlyHours * Math.max(0, hourlyCost));
  // Pre-demo production audit (2026-10-26): this stat sits beside two
  // ANNUAL figures ("Hours/Rand saved a year") but was computed from
  // hoursSavedPerMonth and labelled "a month" - internally consistent on
  // its own, but reads as a mismatch next to the other two. Re-labelling
  // it "a year" without recomputing it would make the NUMBER wrong rather
  // than just the label (extraCapacity's own 3-arg formula scales ~12x
  // between a monthly and a yearly call, since it divides by a per-tender
  // remaining-hours figure that doesn't scale with the period - confirmed
  // by hand: the exact inputs this file ships with produce 11/month but
  // 136/year, not the same number under a different label). 136 "extra
  // tenders a year" is also an exaggerated claim this feature's own rule
  // explicitly forbids. Computed on a genuine annual basis instead, with
  // the simpler, more conservative floor(yearly hours saved / baseline
  // hours per tender) - the same formula the real Home/Analytics counter
  // card is moving to (PR #164, not yet merged) for the same "no
  // exaggerated numbers" reason, inlined here rather than importing from
  // that still-unreviewed branch.
  const extraTendersPerYear = Math.floor(yearlyHours / Math.max(1, hoursPerTender));
  const extraTendersPerMonthApprox = Math.round(extraTendersPerYear / 12);
  const professionalAnnualZar = PROFESSIONAL_MONTHLY_ZAR * 12;

  return (
    <div className="mx-auto max-w-[620px] rounded-xl border border-border bg-card p-6">
      <div className="mb-4 text-sm font-semibold text-foreground">Estimate your own savings</div>
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NumberField label="Tenders a month" value={tendersPerMonth} onChange={setTendersPerMonth} min={0} />
        <NumberField label="Hours per tender today" value={hoursPerTender} onChange={setHoursPerTender} min={0} />
        <NumberField label="Cost per hour (R)" value={hourlyCost} onChange={setHourlyCost} min={0} />
      </div>
      <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-3">
        <Stat label="Hours saved a year" value={`${Math.round(yearlyHours)}h`} />
        <Stat label="Rand saved a year" value={formatRand(yearlyRand)} money />
        <Stat
          label="Extra tenders a year"
          value={extraTendersPerYear > 0 ? `+${extraTendersPerYear}` : "-"}
        />
      </div>
      <div className="mt-4 text-xs leading-relaxed text-muted-foreground">
        That&apos;s{" "}
        {extraTendersPerMonthApprox > 0 && (
          <>
            ~{extraTendersPerMonthApprox} additional tender{extraTendersPerMonthApprox === 1 ? "" : "s"} every month without hiring extra staff, and{" "}
          </>
        )}
        {formatRand(yearlyRand)} a year against the Professional plan&apos;s {formatRand(professionalAnnualZar)} a year (R{PROFESSIONAL_MONTHLY_ZAR.toLocaleString()}/month). Estimated,
        based on the numbers you typed in above - not a guarantee for every tender.
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange, min }: { label: string; value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.valueAsNumber || 0)}
        className="h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </label>
  );
}

function Stat({ label, value, money }: { label: string; value: string; money?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-display text-xl font-medium ${money ? "text-money" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
