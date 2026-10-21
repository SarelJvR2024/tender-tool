import { WizardShell } from "./WizardShell";
import { ComingSoonField, FormError } from "./fields";
import { saveNotificationStep } from "../actions";
import { Button } from "@/components/ui/button";

export function Step5({ digestOptIn, error }: { digestOptIn: boolean; error?: string }) {
  return (
    <WizardShell step={5} description="Who to bid on and how to hear about it - the buyers and value range are on their way.">
      <FormError message={error} />

      <div className="mb-5 flex flex-col gap-4">
        <ComingSoonField
          label="Preferred buyers"
          note="e.g. SANRAL, ACSA, SASSA - not tracked yet. Flagged to Sarel; Discovery already surfaces every open SANRAL tender regardless, so nothing is hidden in the meantime."
        />
        <ComingSoonField label="Typical tender value range" note="Not tracked yet - flagged to Sarel." />
      </div>

      <form action={saveNotificationStep} className="flex flex-col gap-4">
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-3">
          <div>
            <div className="text-sm font-medium text-foreground">Daily digest email</div>
            <div className="text-xs text-muted-foreground">A role-based summary of what needs your attention.</div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="opt_in" value="true" defaultChecked={digestOptIn} className="size-4 accent-accent" />
            Opt in
          </label>
        </div>

        <Button type="submit" className="h-11">
          Finish setup
        </Button>
      </form>
    </WizardShell>
  );
}
