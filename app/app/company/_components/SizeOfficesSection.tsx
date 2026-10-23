import { Field, fieldGridClass, VaultSection } from "./shared";
import type { CompanyRow } from "../types";

export function SizeOfficesSection({ company }: { company: CompanyRow }) {
  // Spec v3 O23 (same rule as EditForm.tsx's own fix, one level up from the
  // person-level pattern in Batch 4): don't show two "Not on file" rows for
  // engineering-only fields on a company that's never recorded either -
  // there's nothing to view here read-only, "add one" lives in edit mode.
  const ecsaOrSacpcmpRecorded = company.ecsa_registered_staff_count != null || company.sacpcmp_registered_staff_count != null;
  return (
    <VaultSection
      id="size-offices"
      title="Size & offices (SANRAL Form B3)"
      description="Written into SANRAL's Form B3. Blank means not recorded - the pack leaves it blank and lists it, never a 0."
    >
      <div className={fieldGridClass}>
        <Field label="Head office (city/town)" value={company.head_office} />
        <Field label="Other offices (number)" value={company.other_offices} />
        <Field label="Total employees" value={company.total_employees} />
        <Field label="% share of JV agreement (usual)" value={company.typical_jv_share_pct} />
        {ecsaOrSacpcmpRecorded && (
          <>
            <Field label="ECSA-registered professionals" value={company.ecsa_registered_staff_count} />
            <Field label="SACPCMP-registered professionals" value={company.sacpcmp_registered_staff_count} />
          </>
        )}
      </div>
    </VaultSection>
  );
}
