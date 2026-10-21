import { Field, fieldGridClass, VaultSection } from "./shared";
import type { CompanyRow } from "../types";

export function CompanyIdentitySection({ company }: { company: CompanyRow }) {
  return (
    <VaultSection id="company-identity" title="Company identity">
      <div className={fieldGridClass}>
        <Field label="Legal name" value={company.legal_name} />
        <Field label="CSD trading name" value={company.csd_trading_name} />
        <Field label="CIPC registration number" value={company.cipc_registration_number} />
        <Field label="VAT number" value={company.vat_number} />
        <Field label="Income tax number" value={company.income_tax_number} />
        <Field label="PAYE number" value={company.paye_number} />
        <Field label="CSD supplier number" value={company.csd_supplier_number} />
        <Field label="Registered address" value={company.registered_address} />
        <Field label="Postal address" value={company.postal_address} />
      </div>
    </VaultSection>
  );
}
