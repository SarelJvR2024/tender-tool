"use client";

import { useTransition } from "react";
import { reassignTenderTask } from "./actions";

export type AssignablePerson = { id: string; name: string };

/**
 * Inline reassign control for one tender task row - same "plain select,
 * tap it, it persists" shape as task-status-button.tsx's own pattern, but
 * for tender_tasks.assigned_to (migration 0011) instead of status.
 */
export function TaskAssigneeSelect({
  taskId,
  tenderId,
  assignedTo,
  people,
}: {
  taskId: string;
  tenderId: string;
  assignedTo: string | null;
  people: AssignablePerson[];
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      value={assignedTo ?? ""}
      disabled={isPending}
      onChange={(e) =>
        startTransition(() => {
          reassignTenderTask(taskId, tenderId, e.target.value || null);
        })
      }
      style={{
        minHeight: 30,
        padding: "0 8px",
        borderRadius: 7,
        border: "1px solid #E5E1D5",
        background: "#FFFFFF",
        color: "#16233B",
        fontSize: 11,
        fontWeight: 600,
        cursor: isPending ? "default" : "pointer",
        opacity: isPending ? 0.6 : 1,
        maxWidth: 160,
      }}
    >
      <option value="">Unassigned</option>
      {people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
