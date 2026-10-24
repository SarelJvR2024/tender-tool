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
  operationalMessage,
}: {
  submissionType: SubmissionType;
  closingDate: string | null;
  estimatedPrintHours: number;
  estimatedTransitHours: number;
  printDeadline: Date | null;
  operationalMessage: string | null;
}) {
  const isPhysical = submissionType === "physical_box";
  const urgent = operationalMessage?.startsWith("CRITICAL") || operationalMessage?.startsWith("PRINT OVERDUE");

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
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
            <dt>Closing time</dt>
            <dd className="text-right text-foreground">{closingDate ? formatClosingDateTime(closingDate) : "—"}</dd>
            <dt>Less transit</dt>
            <dd className="text-right">- {estimatedTransitHours}h</dd>
            <dt>Less print &amp; bind buffer</dt>
            <dd className="text-right">- {estimatedPrintHours}h</dd>
            <dt className="font-semibold text-foreground">Hard target</dt>
            <dd className="text-right font-semibold text-foreground">{printDeadline ? formatDateTime(printDeadline.toISOString()) : "—"}</dd>
          </dl>
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
