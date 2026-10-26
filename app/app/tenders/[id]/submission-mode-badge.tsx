import { formatDateTime, formatClosingDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { SubmissionType } from "@/lib/dispatchTriage";

const SUBMISSION_TYPE_LABEL: Record<SubmissionType, string> = {
  physical_box: "Physical box submission",
  etenders_portal: "eTenders portal upload",
  email: "Email submission",
  other_digital: "Digital submission",
};

/**
 * Tender Command Center (Sarel's own brief, 2026-10-24) - the workspace
 * header's own submission-mode badge. Rendered as a native <details> element
 * on purpose, not a hover popover: PR #131 fixed this exact mistake on
 * PrimaryPackActionLink's disabled reason ("make it visible, not hover-
 * only") - no reason to reintroduce it here for the print/transit buffer
 * math, which matters at least as much.
 */
export function SubmissionModeBadge({
  submissionType,
  closingDate,
  estimatedPrintHours,
  estimatedTransitHours,
  printDeadline,
  departureDeadline,
  deliveryLocation,
  courierContact,
  operationalMessage,
}: {
  submissionType: SubmissionType;
  closingDate: string | null;
  estimatedPrintHours: number;
  estimatedTransitHours: number;
  printDeadline: Date | null;
  departureDeadline: Date | null;
  deliveryLocation: string | null;
  courierContact: string | null;
  operationalMessage: string | null;
}) {
  const isPhysical = submissionType === "physical_box";
  const urgent = operationalMessage?.startsWith("CRITICAL") || operationalMessage?.startsWith("PRINT OVERDUE");
  const missingAddress = isPhysical && !deliveryLocation;
  const missingCourier = isPhysical && !courierContact;

  return (
    <details className="group mt-2 overflow-hidden rounded-md border border-border bg-muted/30">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-xs font-semibold [&::-webkit-details-marker]:hidden",
          urgent ? "text-destructive" : "text-foreground",
        )}
      >
        <span className="flex items-center gap-1.5">
          <span aria-hidden>{isPhysical ? "🏢" : "💻"}</span>
          {SUBMISSION_TYPE_LABEL[submissionType]}
        </span>
        <span className="text-[11px] font-normal text-muted-foreground">
          <span className="group-open:hidden">Submission plan ▾</span>
          <span className="hidden group-open:inline">Hide ▴</span>
        </span>
      </summary>
      <div className="border-t border-border px-3 py-2.5 text-xs">
        {operationalMessage && (
          <div className={cn("mb-2.5 rounded px-2.5 py-1.5 font-semibold", urgent ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>
            {operationalMessage}
          </div>
        )}
        {isPhysical ? (
          <>
            {/* 3 sequential steps, not one collapsed "hard target" (QA
                finding, 2026-10-26: a single number read as "the one thing
                to hit" when prep finishing and the vehicle leaving are two
                different moments with two different owners). "Print, bind
                & sign" names signing explicitly - this schema has no
                separate signing-hours field, so it happens inside the same
                print buffer; said honestly rather than implied as covered
                by a step that doesn't exist. */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
              <dt className="font-semibold text-foreground">1. Print, bind &amp; sign complete by</dt>
              <dd className="text-right font-semibold text-foreground">{printDeadline ? formatDateTime(printDeadline.toISOString()) : "—"}</dd>
              <dt className="font-semibold text-foreground">2. Depart for delivery by</dt>
              <dd className="text-right font-semibold text-foreground">{departureDeadline ? formatDateTime(departureDeadline.toISOString()) : "—"}</dd>
              <dt className="font-semibold text-foreground">3. Official closing (RFP deadline)</dt>
              <dd className="text-right font-semibold text-foreground">{closingDate ? formatClosingDateTime(closingDate) : "—"}</dd>
            </dl>
            <div className="mt-2 text-muted-foreground">
              Built from a {estimatedPrintHours}h print/bind/sign buffer and a {estimatedTransitHours}h transit
              buffer - <strong className="text-foreground">editable planning defaults you set below, not verified facts.</strong>
            </div>
            {(missingAddress || missingCourier) && (
              <div className="mt-2 rounded bg-warning/10 px-2.5 py-1.5 font-semibold text-warning">
                {missingAddress && missingCourier
                  ? "No delivery address or courier/driver on file yet - step 2 above can't actually be confirmed."
                  : missingAddress
                    ? "No delivery address on file yet - step 2 above can't actually be confirmed."
                    : "No courier/driver confirmed yet for delivery."}
              </div>
            )}
          </>
        ) : (
          <div className="text-muted-foreground">
            No print or transit buffer applies to a digital submission - the tender box closing time itself is the hard target.
          </div>
        )}
        <a href="#pack-compiler" className="mt-2.5 inline-block text-[11px] font-semibold text-accent no-underline hover:underline">
          Edit submission logistics →
        </a>
      </div>
    </details>
  );
}
