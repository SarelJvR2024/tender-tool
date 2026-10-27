"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { PLAN_MONTHLY_ZAR } from "@/lib/billing";
import { formatRand } from "@/lib/savingsCounter";
import { ADMIN_TIME_SAVED_FRACTION, calculateSavingsEstimate } from "@/lib/savingsEstimateCalculator";

const PROFESSIONAL_MONTHLY_ZAR = PLAN_MONTHLY_ZAR.professional as number;

/**
 * Homepage "estimate your own savings" calculator. A marketing estimate,
 * not the real per-tender counter (lib/savingsCounter.ts) - there's no real
 * tender to read actual counted steps from here, so this uses its own
 * simpler, self-consistent model (lib/savingsEstimateCalculator.ts): every
 * annual figure is derived directly from its own monthly figure (x12), so
 * the two can never show contradictory numbers the way an earlier version
 * of this calculator did (e.g. "+11 extra tenders a month" with no
 * consistent annual figure alongside it).
 */
export function SavingsCalculator() {
  const [tendersPerMonth, setTendersPerMonth] = useState(2);
  const [hoursPerTender, setHoursPerTender] = useState(20);
  const [hourlyRate, setHourlyRate] = useState(450);

  const estimate = calculateSavingsEstimate({ tendersPerMonth, hoursPerTender, hourlyRate });
  const professionalAnnualZar = PROFESSIONAL_MONTHLY_ZAR * 12;
  const adminSavedPct = Math.round(ADMIN_TIME_SAVED_FRACTION * 100);

  return (
    <div className="mx-auto max-w-[620px] rounded-xl border border-border bg-card p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">Estimate your own savings</div>
        <Badge variant="secondary">Estimated, based on your numbers</Badge>
      </div>
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NumberField label="Tenders a month" value={tendersPerMonth} onChange={setTendersPerMonth} min={0} />
        <NumberField label="Hours per tender today" value={hoursPerTender} onChange={setHoursPerTender} min={0} />
        <NumberField label="Cost per hour (R)" value={hourlyRate} onChange={setHourlyRate} min={0} />
      </div>
      <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 sm:grid-cols-3">
        <Stat
          label={`${estimate.monthlyHoursSaved}h saved / month`}
          subtitle={`(${estimate.annualHoursSaved} hours / year)`}
        />
        <Stat
          label={`${formatRand(estimate.monthlyRandSaved)} / month`}
          subtitle={`(${formatRand(estimate.annualRandSaved)} / year)`}
          money
        />
        <Stat
          label={`+${estimate.monthlyExtraCapacity} extra tenders / month`}
          subtitle={`Room for ~${estimate.annualExtraCapacity} additional bids a year without hiring`}
        />
      </div>

      <details className="mt-4 rounded-lg border border-border">
        <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-semibold text-foreground">
          How is this calculated?
        </summary>
        <div className="space-y-2.5 px-3 pb-3 text-xs leading-relaxed text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">Compilation time saved. </span>
            We estimate Tender Ready eliminates ~{adminSavedPct}% of administrative bid preparation (finding
            compliance docs, formatting staff CVs, indexing returnables, and assembling the submission pack). Based
            on your {hoursPerTender}h estimate, you save ~{estimate.adminHoursSavedPerTender}h on every tender.
          </p>
          <p>
            <span className="font-medium text-foreground">Direct cost saving. </span>
            {estimate.monthlyHoursSaved} hours freed up per month &times; R{hourlyRate}/hour ={" "}
            {formatRand(estimate.monthlyRandSaved)} in recovered billable value each month.
          </p>
          <p>
            <span className="font-medium text-foreground">Capacity math. </span>
            Freeing up {estimate.monthlyHoursSaved} hours a month gives your existing team the hours to submit +
            {estimate.monthlyExtraCapacity} additional tenders per month (~{estimate.annualExtraCapacity} per year)
            without adding headcount.
          </p>
          <p>
            <span className="font-medium text-foreground">Note: </span>
            Estimating, bill of quantities (BoQ) pricing, site visits, and design still require your professional
            judgment. Tender Ready eliminates the administrative paperwork so your estimators can focus on winning.
          </p>
        </div>
      </details>

      <div className="mt-4 text-xs leading-relaxed text-muted-foreground">
        That&apos;s {formatRand(estimate.annualRandSaved)} a year against the Professional plan&apos;s{" "}
        {formatRand(professionalAnnualZar)} a year (R{PROFESSIONAL_MONTHLY_ZAR.toLocaleString()}/month). Not a
        guarantee for every tender.
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

function Stat({ label, subtitle, money }: { label: string; subtitle: string; money?: boolean }) {
  return (
    <div>
      <div className={`font-display text-lg font-medium ${money ? "text-money" : "text-foreground"}`}>{label}</div>
      <div className="text-xs text-muted-foreground">{subtitle}</div>
    </div>
  );
}
