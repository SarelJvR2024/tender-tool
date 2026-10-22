import { Field, fieldGridClass, VaultSection } from "./shared";
import { formatRand } from "@/lib/savingsCounter";
import type { CompanyRow } from "../types";

export function SavingsBaselineSection({ company }: { company: CompanyRow }) {
  return (
    <VaultSection
      id="savings-baseline"
      title="Time and cost saved"
      description="Used to estimate how many hours and how much money Tender Ready saves you (Home, final review, the pricing calculator) - your own numbers, not a universal average."
    >
      <div className={fieldGridClass}>
        <Field label="Hours your team usually spends on one tender" value={company.savings_baseline_hours_per_tender} />
        <Field label="Cost per hour of that person's time" value={formatRand(company.savings_baseline_hourly_cost_zar)} />
      </div>
    </VaultSection>
  );
}
