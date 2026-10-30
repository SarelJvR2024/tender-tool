import { Pencil } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Field, fieldGridClass, VaultSection } from "./shared";
import type { CompanyRow } from "../types";

const EDIT_HREF = "/company?edit=1#company-identity";

export function CompanyIdentitySection({ company }: { company: CompanyRow }) {
  return (
    <VaultSection
      id="company-identity"
      title="Company identity"
      actions={
        // Real finding, 2026-10-29 (Sarel: "fields ... cannot be manually
        // clicked or edited"): every one of these fields was already
        // editable via the page's own "Edit" button at the very top of
        // /company (EditForm.tsx) - the real gap was that nothing on THIS
        // card, scrolled to deep in the page, pointed back to it. Same fix
        // as ComplianceDocumentsView's own matching "Edit" link.
        <a href={EDIT_HREF} className={buttonVariants({ variant: "ghost", size: "sm", className: "gap-1 text-xs text-muted-foreground" })}>
          <Pencil className="size-3.5" /> Edit
        </a>
      }
    >
      <div className={fieldGridClass}>
        <Field label="Legal name" value={company.legal_name} editHref={EDIT_HREF} />
        <Field label="CSD trading name" value={company.csd_trading_name} editHref={EDIT_HREF} />
        <Field label="CIPC registration number" value={company.cipc_registration_number} editHref={EDIT_HREF} />
        <Field label="VAT number" value={company.vat_number} editHref={EDIT_HREF} />
        <Field label="Income tax number" value={company.income_tax_number} editHref={EDIT_HREF} />
        <Field label="PAYE number" value={company.paye_number} editHref={EDIT_HREF} />
        <Field label="CSD supplier number" value={company.csd_supplier_number} editHref={EDIT_HREF} />
        <Field label="Registered address" value={company.registered_address} fullWidth editHref={EDIT_HREF} />
        <Field label="Postal address" value={company.postal_address} fullWidth editHref={EDIT_HREF} />
      </div>
    </VaultSection>
  );
}
