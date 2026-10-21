import { Field, fieldGridClass, VaultSection } from "./shared";
import type { CompanyRow } from "../types";

export function SizeOfficesSection({ company }: { company: CompanyRow }) {
  return (
    <VaultSection
      id="size-offices"
      title="Size & offices (SANRAL Form B3)"
      description="Written into SANRAL's Form B3. Blank means not recorded - the pack leaves it blank and lists it, never a 0."
    >
      <div className={fieldGridClass}>
        <Field label="Head office (city/town)" value={company.head_office} />
        <Field label="Other offices (number)" value={company.other_offices} />
        <Field label="ECSA-registered professionals" value={company.ecsa_registered_staff_count} />
        <Field label="SACPCMP-registered professionals" value={company.sacpcmp_registered_staff_count} />
        <Field label="Total employees" value={company.total_employees} />
        <Field label="% share of JV agreement (usual)" value={company.typical_jv_share_pct} />
      </div>
    </VaultSection>
  );
}
