import { WizardShell } from "./WizardShell";
import { Field, FormError } from "./fields";
import { createCompanyBasics } from "../actions";
import { Button } from "@/components/ui/button";

export function Step1({ error }: { error?: string }) {
  return (
    <WizardShell step={1} description="Everything else - documents, compliance, people - comes next, or any time later from Company vault.">
      <FormError message={error} />
      <form action={createCompanyBasics} className="flex flex-col gap-4">
        <Field name="legal_name" label="Company legal name" required placeholder="Registered name, as on your CIPC certificate" />
        <Field name="csd_trading_name" label="Trading name" placeholder="If different from the legal name" />
        <Field name="cipc_registration_number" label="CIPC registration number" />
        <Button type="submit" className="mt-2 h-11">
          Continue
        </Button>
      </form>
    </WizardShell>
  );
}
