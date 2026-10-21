import { MapPin } from "lucide-react";
import { PROVINCES, OFFICE_KINDS, type CompanyOffice } from "@/lib/locality";
import { WizardShell } from "./WizardShell";
import { Field, SelectField, ComingSoonField, FormError } from "./fields";
import { saveOfficeStep } from "../actions";
import { Button } from "@/components/ui/button";

const PROVINCE_OPTIONS = PROVINCES.map((p) => ({ value: p, label: p }));

export function Step3({ companyId, offices, error }: { companyId: string; offices: CompanyOffice[]; error?: string }) {
  const save = saveOfficeStep.bind(null, companyId);

  return (
    <WizardShell step={3} description="Office locations and the disciplines you work in - tenders score locality and scope against these.">
      <FormError message={error} />

      {offices.length > 0 && (
        <ul className="mb-4 flex flex-col gap-1.5">
          {offices.map((o) => (
            <li key={o.id} className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
              <MapPin className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-medium text-foreground">{o.label || o.province}</span>
              <span className="text-muted-foreground">
                {[o.town, o.local_municipality, o.province].filter(Boolean).join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form action={save} className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <SelectField name="province" label="Province" required options={PROVINCE_OPTIONS} />
          <SelectField name="office_kind" label="Office type" defaultValue="branch" options={OFFICE_KINDS} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field name="town" label="Town" />
          <Field name="label" label="Label" placeholder="e.g. Head office" />
        </div>
        <Field name="local_municipality" label="Local municipality" placeholder="e.g. Stellenbosch" />

        <Button type="submit" variant="outline" className="h-11">
          Add this office
        </Button>
      </form>

      <div className="mt-6 border-t border-border pt-5">
        <ComingSoonField
          label="Disciplines you work in"
          note="Not tracked at company level yet - coming soon. Flagged to Sarel; in the meantime, Discovery and the Experience page already use discipline tags per tender and per project."
        />
      </div>
    </WizardShell>
  );
}
