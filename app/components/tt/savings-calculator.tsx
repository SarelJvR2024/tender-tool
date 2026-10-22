"use client";

import { useState } from "react";
import { PLAN_MONTHLY_ZAR } from "@/lib/billing";
import { SAVINGS_STEP_HOURS, extraCapacity, formatRand, hoursSavedForTender } from "@/lib/savingsCounter";

const TYPICAL_HOURS_SAVED_PER_TENDER = Object.values(SAVINGS_STEP_HOURS).reduce((sum, s) => sum + s.hours, 0);
const PROFESSIONAL_MONTHLY_ZAR = PLAN_MONTHLY_ZAR.professional as number;

/**
 * Pricing-page savings calculator (spec §9.5). A marketing estimate, not the
 * real per-tender counter (lib/savingsCounterData.ts) - there's no real
 * tender to read actual counted steps from here, so this assumes a
 * "typical" tender saves the sum of every configured step's placeholder
 * hours (the same SAVINGS_STEP_HOURS the real counter uses - not a
 * separately invented number), capped at whatever baseline the visitor
 * types in, then reuses the exact same extraCapacity()/formatRand()
 * formulas the real Home counter card uses, for the same reason billing.ts
 * reuses PLAN_MONTHLY_ZAR instead of a 4th hardcoded price: one formula,
 * checked once, not quietly reinvented per surface.
 */
export function SavingsCalculator() {
  const [tendersPerMonth, setTendersPerMonth] = useState(2);
  const [hoursPerTender, setHoursPerTender] = useState(20);
  const [hourlyCost, setHourlyCost] = useState(450);

  const typicalHoursSaved = hoursSavedForTender([TYPICAL_HOURS_SAVED_PER_TENDER], Math.max(0, hoursPerTender));
  const hoursSavedPerMonth = Math.max(0, tendersPerMonth) * typicalHoursSaved;
  const yearlyHours = hoursSavedPerMonth * 12;
  const yearlyRand = Math.round(yearlyHours * Math.max(0, hourlyCost));
  const extraTendersPerMonth = extraCapacity(hoursSavedPerMonth, Math.max(0, tendersPerMonth), hoursPerTender);
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
          label="Extra tenders a month"
          value={extraTendersPerMonth > 0 ? `+${extraTendersPerMonth}` : "-"}
        />
      </div>
      <div className="mt-4 text-xs leading-relaxed text-muted-foreground">
        That&apos;s {formatRand(yearlyRand)} a year against the Professional plan&apos;s {formatRand(professionalAnnualZar)} a year (R{PROFESSIONAL_MONTHLY_ZAR.toLocaleString()}/month). Estimated,
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
