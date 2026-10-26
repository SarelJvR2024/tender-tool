import { updateCompanyProfile } from "../actions";
import { BEE_PROOF_TYPES } from "@/lib/vaultDocuments";
import { BASELINE_HOURS_MAX, BASELINE_HOURS_MIN, HOURLY_COST_MAX_ZAR, HOURLY_COST_MIN_ZAR } from "@/lib/savingsCounter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { VaultSection, fieldGridClass } from "./shared";
import type { CompanyRow } from "../types";

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function EditForm({ company }: { company: CompanyRow }) {
  const updateWithId = updateCompanyProfile.bind(null, company.id);

  return (
    <form action={updateWithId} className="flex flex-col gap-6">
      <VaultSection title="Company identity">
        <div className={fieldGridClass}>
          <TextInput name="legal_name" label="Legal name" defaultValue={company.legal_name} required />
          <TextInput name="csd_trading_name" label="CSD trading name" defaultValue={company.csd_trading_name} />
          <TextInput name="cipc_registration_number" label="CIPC registration number" defaultValue={company.cipc_registration_number} />
          <TextInput name="vat_number" label="VAT number" defaultValue={company.vat_number} />
          <TextInput name="income_tax_number" label="Income tax number" defaultValue={company.income_tax_number} />
          <TextInput name="paye_number" label="PAYE number" defaultValue={company.paye_number} />
          <TextInput name="csd_supplier_number" label="CSD supplier number" defaultValue={company.csd_supplier_number} />
          <TextInput name="registered_address" label="Registered address" defaultValue={company.registered_address} textarea fullWidth />
          <TextInput name="postal_address" label="Postal address" defaultValue={company.postal_address} textarea fullWidth />
        </div>
      </VaultSection>

      <VaultSection title="Size & offices (SANRAL Form B3)" description="Leave blank if you don't know - blank is never written as 0.">
        <div className={fieldGridClass}>
          <TextInput name="head_office" label="Head office (city/town)" defaultValue={company.head_office} />
          <NumberInput name="other_offices" label="Other offices (number)" defaultValue={company.other_offices} step="1" />
          <NumberInput name="total_employees" label="Total employees" defaultValue={company.total_employees} step="1" />
          <NumberInput name="typical_jv_share_pct" label="% share of JV agreement (usual; 100 when bidding alone)" defaultValue={company.typical_jv_share_pct} step="0.1" />
          {(() => {
            // Spec v3 O23, one level up from the person-level fix (Batch 4,
            // app/people/[id]/page.tsx): ECSA/SACPCMP staff counts used to
            // render unconditionally on every company, the same "ECSA as the
            // universal category" problem - a non-engineering company saw
            // two engineering-only fields by default, with nothing to enter.
            // "Recorded" means either count is non-null - this section's own
            // description says blank is never written as 0, so a real 0 is
            // still a recorded answer, same meaning as "held" at the person
            // level.
            const recorded = company.ecsa_registered_staff_count != null || company.sacpcmp_registered_staff_count != null;
            const fields = (
              <>
                <NumberInput name="ecsa_registered_staff_count" label="ECSA-registered professionals" defaultValue={company.ecsa_registered_staff_count} step="1" />
                <NumberInput name="sacpcmp_registered_staff_count" label="SACPCMP-registered professionals" defaultValue={company.sacpcmp_registered_staff_count} step="1" />
              </>
            );
            if (recorded) return fields;
            return (
              <details className="col-span-full mb-2.5">
                <summary className="flex min-h-11 cursor-pointer items-center py-1.5 text-xs font-semibold text-accent">
                  + Add ECSA or SACPCMP staff counts - only engineering-focused companies need these
                </summary>
                <div className={`${fieldGridClass} mt-2`}>{fields}</div>
              </details>
            );
          })()}
        </div>
      </VaultSection>

      <VaultSection
        id="savings-baseline"
        title="Time and cost saved"
        description="Used to estimate how many hours and how much money Tender Ready saves you (Home, final review, the pricing calculator) - your own numbers, not a universal average."
      >
        <div className={fieldGridClass}>
          <NumberInput
            name="savings_baseline_hours_per_tender"
            label="Hours your team usually spends on one tender"
            defaultValue={company.savings_baseline_hours_per_tender}
            step="1"
            min={BASELINE_HOURS_MIN}
            max={BASELINE_HOURS_MAX}
          />
          <NumberInput
            name="savings_baseline_hourly_cost_zar"
            label="Cost per hour of that person's time (Rand)"
            defaultValue={company.savings_baseline_hourly_cost_zar}
            step="1"
            min={HOURLY_COST_MIN_ZAR}
            max={HOURLY_COST_MAX_ZAR}
          />
        </div>
      </VaultSection>

      <VaultSection title="How we work">
        <Label htmlFor="how_we_work" className="mb-1.5 block">
          Who you are and how you approach a tender, in your own words
        </Label>
        <div className="mb-2 text-xs leading-relaxed text-muted-foreground">
          Your real methodology, what you are known for, how you run a project - written the way you would say it.
          Tender Ready reproduces this exactly as written; it never rewrites or pads it.
        </div>
        <Textarea
          id="how_we_work"
          name="how_we_work"
          defaultValue={company.how_we_work ?? ""}
          rows={10}
          maxLength={10000}
          className="min-h-44 text-sm leading-relaxed"
        />
        <div className="mt-1.5 text-xs text-muted-foreground">Up to 10 000 characters.</div>
      </VaultSection>

      <VaultSection title="Compliance documents">
        <div className={fieldGridClass}>
          <TextInput name="coid_registration_number" label="COID registration number" defaultValue={company.coid_registration_number} />
          <TextInput name="coid_letter_of_good_standing_number" label="COID Letter of Good Standing number" defaultValue={company.coid_letter_of_good_standing_number} />
          <DateInput name="coid_letter_of_good_standing_expiry" label="COID Letter of Good Standing expiry" defaultValue={company.coid_letter_of_good_standing_expiry} />
          <TextInput name="sars_tcs_pin" label="SARS Tax Compliance Status PIN" defaultValue={company.sars_tcs_pin} />
          <DateInput name="sars_tcs_pin_expiry" label="SARS TCS PIN expiry" defaultValue={company.sars_tcs_pin_expiry} />
          <TextInput name="pi_insurance_insurer" label="Professional indemnity insurer" defaultValue={company.pi_insurance_insurer} />
          <TextInput name="pi_insurance_policy_number" label="PI policy number" defaultValue={company.pi_insurance_policy_number} />
          <NumberInput name="pi_insurance_cover_zar" label="PI limit of indemnity (R)" defaultValue={company.pi_insurance_cover_zar} />
          <DateInput name="pi_insurance_expiry" label="PI policy expiry (period to)" defaultValue={company.pi_insurance_expiry} />
          <SelectInput
            name="iso_9001_certified"
            label="ISO 9001 certified?"
            defaultValue={company.iso_9001_certified === true ? "yes" : company.iso_9001_certified === false ? "no" : ""}
            options={[
              { value: "", label: "Not stated" },
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
          />
          <TextInput name="iso_9001_certificate_number" label="ISO 9001 certificate number" defaultValue={company.iso_9001_certificate_number} />
          <DateInput name="iso_9001_expiry" label="ISO 9001 certificate expiry" defaultValue={company.iso_9001_expiry} />
          <DateInput name="bank_confirmation_letter_date" label="Bank confirmation letter date" defaultValue={company.bank_confirmation_letter_date} />
        </div>
      </VaultSection>

      <VaultSection title="B-BBEE & CIDB">
        <div className={fieldGridClass}>
          <NumberInput name="bee_level" label="B-BBEE level" defaultValue={company.bee_level} />
          <NumberInput name="black_ownership_pct" label="Black ownership %" defaultValue={company.black_ownership_pct} step="0.1" />
          <NumberInput name="bee_procurement_recognition_pct" label="B-BBEE procurement recognition %" defaultValue={company.bee_procurement_recognition_pct} step="0.1" />
          <TextInput name="status" label="Status (e.g. QSE)" defaultValue={company.status} />
          <SelectInput
            name="bee_proof_type"
            label="B-BBEE proof held"
            defaultValue={company.bee_proof_type ?? ""}
            options={[{ value: "", label: "Not recorded" }, ...BEE_PROOF_TYPES.map((t) => ({ value: t.value, label: t.label }))]}
          />
          <DateInput name="bee_proof_expiry" label="B-BBEE proof expiry" defaultValue={company.bee_proof_expiry} />
        </div>
      </VaultSection>

      <VaultSection title="Bank details" description="Account numbers are not collected here - they go on the restricted Bank accounts page (owners and admins only).">
        <div className={fieldGridClass}>
          <TextInput name="bank_name" label="Bank name" defaultValue={company.bank_name} />
          <TextInput name="bank_branch_code" label="Branch code" defaultValue={company.bank_branch_code} />
        </div>
      </VaultSection>

      <div className="flex flex-wrap gap-2.5">
        <Button type="submit" variant="accent" size="lg" className="min-h-10 px-5">
          Save changes
        </Button>
        <a href="/company" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-card px-5 text-sm font-semibold text-foreground no-underline hover:bg-muted/50">
          Cancel
        </a>
      </div>
    </form>
  );
}

function TextInput({
  name,
  label,
  defaultValue,
  required,
  textarea,
  fullWidth,
}: {
  name: string;
  label: string;
  defaultValue: string | null;
  required?: boolean;
  textarea?: boolean;
  /** Spec v3 §10/§28: a long value (an address) needs the grid's full row, not a 1-of-3 share. */
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "col-span-full" : undefined}>
      <Label htmlFor={name} className="mb-1.5 block">
        {label}
      </Label>
      {textarea ? (
        <Textarea id={name} name={name} defaultValue={defaultValue ?? ""} rows={2} className="min-h-11 text-sm" />
      ) : (
        <Input id={name} name={name} defaultValue={defaultValue ?? ""} required={required} className="min-h-11 text-sm" />
      )}
    </div>
  );
}

function DateInput({ name, label, defaultValue }: { name: string; label: string; defaultValue: string | null }) {
  return (
    <div>
      <Label htmlFor={name} className="mb-1.5 block">
        {label}
      </Label>
      <Input type="date" id={name} name={name} defaultValue={defaultValue ?? ""} className="min-h-11 text-sm" />
    </div>
  );
}

function NumberInput({
  name,
  label,
  defaultValue,
  step,
  min,
  max,
}: {
  name: string;
  label: string;
  defaultValue: number | null;
  step?: string;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <Label htmlFor={name} className="mb-1.5 block">
        {label}
        {min !== undefined && max !== undefined && <span className="ml-1 text-muted-foreground">({min}-{max})</span>}
      </Label>
      <Input
        type="number"
        step={step ?? "1"}
        min={min}
        max={max}
        id={name}
        name={name}
        defaultValue={defaultValue ?? ""}
        className="min-h-11 text-sm"
      />
    </div>
  );
}

function SelectInput({
  name,
  label,
  defaultValue,
  options,
}: {
  name: string;
  label: string;
  defaultValue: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <Label htmlFor={name} className="mb-1.5 block">
        {label}
      </Label>
      <select id={name} name={name} defaultValue={defaultValue} className={selectClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
