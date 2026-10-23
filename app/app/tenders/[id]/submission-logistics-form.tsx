import { saveSubmissionLogistics } from "./logistics-actions";
import type { SubmissionType } from "@/lib/dispatchTriage";

const SUBMISSION_TYPE_OPTIONS: { value: SubmissionType; label: string }[] = [
  { value: "physical_box", label: "Physical box (printed & delivered to the tender box)" },
  { value: "etenders_portal", label: "eTenders portal upload" },
  { value: "email", label: "Email submission" },
  { value: "other_digital", label: "Other digital submission" },
];

/**
 * Tender Command Center (Sarel's own brief, 2026-10-24) - the Pack
 * compiler tab's own logistics form. One real write path
 * (saveSubmissionLogistics, logistics-actions.ts) for every field migration
 * 0090 added to tender_packs; nothing here computes a deadline itself - that
 * stays lib/dispatchTriage.ts's job, read back through the header's
 * SubmissionModeBadge once this form redirects back with #pack-compiler.
 */
export function SubmissionLogisticsForm({
  tenderId,
  submissionType,
  deliveryLocation,
  estimatedPrintHours,
  estimatedTransitHours,
  courierContact,
}: {
  tenderId: string;
  submissionType: SubmissionType;
  deliveryLocation: string | null;
  estimatedPrintHours: number;
  estimatedTransitHours: number;
  courierContact: string | null;
}) {
  return (
    <form action={saveSubmissionLogistics} className="rounded-lg border border-border bg-card p-4">
      <input type="hidden" name="tender_id" value={tenderId} />
      <h3 className="mb-3 font-display text-sm font-semibold text-foreground">Submission logistics</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs font-semibold text-foreground sm:col-span-2">
          Submission type
          <select
            name="submission_type"
            defaultValue={submissionType}
            className="rounded-md border border-border bg-background px-2.5 py-2 text-xs font-normal text-foreground"
          >
            {SUBMISSION_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
          Delivery location
          <input
            type="text"
            name="delivery_location"
            defaultValue={deliveryLocation ?? ""}
            placeholder="e.g. SANRAL Head Office, Tender Box 3"
            className="rounded-md border border-border bg-background px-2.5 py-2 text-xs font-normal text-foreground placeholder:text-muted-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
          Courier / driver contact
          <input
            type="text"
            name="courier_contact"
            defaultValue={courierContact ?? ""}
            placeholder="e.g. Fast Courier - 082 000 0000"
            className="rounded-md border border-border bg-background px-2.5 py-2 text-xs font-normal text-foreground placeholder:text-muted-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
          Print &amp; bind hours
          <input
            type="number"
            step="0.5"
            min="0"
            name="estimated_print_hours"
            defaultValue={estimatedPrintHours}
            className="rounded-md border border-border bg-background px-2.5 py-2 text-xs font-normal text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-foreground">
          Transit hours
          <input
            type="number"
            step="0.5"
            min="0"
            name="estimated_transit_hours"
            defaultValue={estimatedTransitHours}
            className="rounded-md border border-border bg-background px-2.5 py-2 text-xs font-normal text-foreground"
          />
        </label>
      </div>
      <button
        type="submit"
        className="mt-3 rounded-md border border-border bg-foreground px-3 py-1.5 text-xs font-semibold text-background hover:opacity-90"
      >
        Save submission logistics
      </button>
    </form>
  );
}
