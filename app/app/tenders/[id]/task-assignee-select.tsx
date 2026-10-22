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
  taskDescription,
}: {
  taskId: string;
  tenderId: string;
  assignedTo: string | null;
  people: AssignablePerson[];
  taskDescription: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <select
      aria-label={`Assigned to, for task "${taskDescription}"`}
      value={assignedTo ?? ""}
      disabled={isPending}
      onChange={(e) =>
        startTransition(() => {
          reassignTenderTask(taskId, tenderId, e.target.value || null);
        })
      }
      className={`min-h-[30px] max-w-[160px] rounded-md border border-border bg-card px-2 text-[11px] font-semibold text-foreground ${isPending ? "cursor-default opacity-60" : "cursor-pointer"}`}
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
