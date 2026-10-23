"use client";

import { useTransition } from "react";
import { advanceDispatchStatus } from "@/app/tenders/[id]/logistics-actions";
import type { DispatchStatus } from "@/lib/dispatchTriage";

const STATUS_LABEL: Record<DispatchStatus, { label: string; className: string }> = {
  not_ready: { label: "Not ready", className: "bg-muted text-muted-foreground" },
  compiling: { label: "Compiling", className: "bg-warning/10 text-warning" },
  print_ready: { label: "Print ready", className: "bg-warning/10 text-warning" },
  printed_and_bound: { label: "Printed & bound", className: "bg-success/10 text-success" },
  out_for_delivery: { label: "Out for delivery", className: "bg-success/10 text-success" },
  submitted_and_receipted: { label: "Submitted & receipted", className: "bg-success/10 text-success" },
};

const NEXT_ACTION_LABEL: Record<DispatchStatus, string> = {
  not_ready: "Start compiling",
  compiling: "Mark print-ready",
  print_ready: "Mark printed & bound",
  printed_and_bound: "Mark out for delivery",
  out_for_delivery: "Mark submitted & receipted",
  submitted_and_receipted: "Done",
};

/**
 * Lane C's own "tap to advance" checklist control - same shape as
 * tender_tasks' own TaskStatusButton, for the same reason: dispatch_status
 * is a real, manually-advanced column (migration 0090), the one piece of
 * the Tender Command Center nothing else can derive.
 */
export function DispatchStatusButton({
  tenderPackId,
  tenderId,
  status,
}: {
  tenderPackId: string;
  tenderId: string;
  status: DispatchStatus;
}) {
  const [isPending, startTransition] = useTransition();
  const chip = STATUS_LABEL[status];

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${chip.className}`}>
        {chip.label}
      </span>
      {status !== "submitted_and_receipted" && (
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(() => {
              advanceDispatchStatus(tenderPackId, tenderId, status);
            })
          }
          className={`rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-foreground ${isPending ? "cursor-default opacity-60" : "cursor-pointer"}`}
        >
          {isPending ? "…" : NEXT_ACTION_LABEL[status]}
        </button>
      )}
    </div>
  );
}
