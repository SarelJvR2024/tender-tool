"use client";

import { useTransition } from "react";
import { advanceTaskStatus, type TenderTaskStatus } from "./actions";

const STATUS_LABEL: Record<TenderTaskStatus, { label: string; bg: string; color: string }> = {
  not_started: { label: "Not started", bg: "#F0EEE6", color: "#6B6758" },
  in_progress: { label: "In progress", bg: "#FEF3C7", color: "#B45309" },
  done: { label: "Done", bg: "#DCFCE7", color: "#15803D" },
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
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "3px 10px",
          borderRadius: 100,
          fontSize: 11,
          fontWeight: 600,
          background: chip.bg,
          color: chip.color,
          whiteSpace: "nowrap",
        }}
      >
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
          style={{
            padding: "4px 10px",
            borderRadius: 7,
            border: "1px solid #E5E1D5",
            background: "#FFFFFF",
            color: "#16233B",
            fontSize: 11,
            fontWeight: 600,
            cursor: isPending ? "default" : "pointer",
            opacity: isPending ? 0.6 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {isPending ? "…" : NEXT_ACTION_LABEL[status]}
        </button>
      )}
    </div>
  );
}
