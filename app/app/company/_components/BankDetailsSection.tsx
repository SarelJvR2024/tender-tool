import { Field, fieldGridClass, VaultSection } from "./shared";
import type { CompanyRow } from "../types";

export function BankDetailsSection({ company }: { company: CompanyRow }) {
  return (
    <VaultSection id="bank-details" title="Bank details">
      <div className={fieldGridClass}>
        <Field label="Bank name" value={company.bank_name} />
        <Field label="Branch code" value={company.bank_branch_code} />
      </div>
      <div className="mt-2.5 text-xs text-muted-foreground">
        The account number itself is kept on the restricted{" "}
        <a href="/company/bank-accounts" className="font-semibold text-accent no-underline">
          Bank accounts
        </a>{" "}
        page (owners and admins only). Generated documents still print &quot;WITHHELD&quot; - it is copied onto a form by hand.
      </div>
    </VaultSection>
  );
}
