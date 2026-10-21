import { Field, fieldGridClass, VaultSection } from "./shared";
import type { CompanyRow } from "../types";

export function BeeCidbSection({ company }: { company: CompanyRow }) {
  return (
    <VaultSection id="bee-cidb" title="BEE & CIDB">
      <div className={fieldGridClass}>
        <Field label="BEE level" value={company.bee_level} />
        <Field label="Black ownership %" value={company.black_ownership_pct} />
        <Field label="BEE procurement recognition %" value={company.bee_procurement_recognition_pct} />
        <Field label="Status" value={company.status} />
      </div>
    </VaultSection>
  );
}
