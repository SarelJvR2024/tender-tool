import Link from "next/link";
import { daysUntil } from "@/lib/dates";
import { WizardShell } from "./WizardShell";
import { Field, FormError } from "./fields";
import { saveComplianceStep } from "../actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CompanyCompliance = {
  id: string;
  csd_supplier_number: string | null;
  sars_tcs_pin: string | null;
  sars_tcs_pin_expiry: string | null;
  bee_level: number | null;
  bee_proof_expiry: string | null;
  cidb_grading: string | null;
  cidb_expiry: string | null;
  savings_baseline_hours_per_tender: number;
  savings_baseline_hourly_cost_zar: number;
};

function expiryTone(dateStr: string | null): { label: string; className: string } {
  const left = daysUntil(dateStr);
  if (left === null) return { label: "Not on file", className: "text-muted-foreground" };
  if (left < 0) return { label: "Expired", className: "text-destructive" };
  if (left <= 60) return { label: "Renew soon", className: "text-warning" };
  return { label: "Current", className: "text-success" };
}

export function Step2({ company, error }: { company: CompanyCompliance; error?: string }) {
  const cidbStatus = expiryTone(company.cidb_expiry);
  const save = saveComplianceStep.bind(null, company.id);

  return (
    <WizardShell step={2} description="What you have on file today - everything here can be updated later in Company vault.">
      <FormError message={error} />
      <form action={save} className="flex flex-col gap-4">
        <Field name="csd_supplier_number" label="CSD supplier number" defaultValue={company.csd_supplier_number} />

        <div className="grid grid-cols-2 gap-3">
          <Field name="sars_tcs_pin" label="SARS tax compliance PIN" defaultValue={company.sars_tcs_pin} />
          <Field name="sars_tcs_pin_expiry" label="PIN expiry" type="date" defaultValue={company.sars_tcs_pin_expiry} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field name="bee_level" label="B-BBEE level" type="number" step="1" defaultValue={company.bee_level} />
          <Field name="bee_proof_expiry" label="B-BBEE certificate expiry" type="date" defaultValue={company.bee_proof_expiry} />
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">CIDB grade &amp; class</span>
            <span className={cn("text-xs font-medium", cidbStatus.className)}>{cidbStatus.label}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {company.cidb_grading ? `Grading ${company.cidb_grading}` : "Not on file yet"} - CIDB details are read from your uploaded
            certificate, not typed in here.{" "}
            <Link href="/company#bee-cidb" className="font-medium underline">
              Upload it in Company vault
            </Link>
            .
          </p>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <div className="mb-1 text-sm font-medium text-foreground">Time and cost saved</div>
          <p className="mb-3 text-xs text-muted-foreground">
            Used to estimate how many hours and how much money Tender Ready saves you - your own numbers. Change this any time in Company vault.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field
              name="savings_baseline_hours_per_tender"
              label="Hours your team usually spends on one tender"
              type="number"
              step="1"
              defaultValue={company.savings_baseline_hours_per_tender}
            />
            <Field
              name="savings_baseline_hourly_cost_zar"
              label="Cost per hour of that time (Rand)"
              type="number"
              step="1"
              defaultValue={company.savings_baseline_hourly_cost_zar}
            />
          </div>
        </div>

        <Button type="submit" className="mt-2 h-11">
          Continue
        </Button>
      </form>
    </WizardShell>
  );
}
