"use client";

import { useTransition } from "react";
import { advanceTaskStatus, type TenderTaskStatus } from "./actions";

const STATUS_LABEL: Record<TenderTaskStatus, { label: string; className: string }> = {
  not_started: { label: "Not started", className: "bg-muted text-muted-foreground" },
  in_progress: { label: "In progress", className: "bg-warning/10 text-warning" },
  done: { label: "Done", className: "bg-success/10 text-success" },
};

const NEXT_ACTION_LABEL: Record<TenderTaskStatus, string> = {
  not_started: "Start",
  in_progress: "Mark done",
  done: "Done",
};

/**
 * Inline status control for one tender task row - same "tap to advance"
 * shape as review-button.tsx, but this one persists for real via
 * advanceTaskStatus (tender_tasks.status is a real column, unlike
 * field_provenance's missing reviewed_at).
 */
export function TaskStatusButton({
  taskId,
  tenderId,
  status,
}: {
  taskId: string;
  tenderId: string;
  status: TenderTaskStatus;
}) {
  const [isPending, startTransition] = useTransition();
  const chip = STATUS_LABEL[status];

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${chip.className}`}>
        {chip.label}
      </span>
      {status !== "done" && (
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(() => {
              advanceTaskStatus(taskId, tenderId, status);
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
