// No "use client" - purely a server-rendered table, no interactivity needed.
// heartbeatStatusFor() (app/lib/workflowRegistry.ts) is a pure function;
// page.tsx calls it and passes already-computed, serializable rows here.
import { formatDateTime } from "@/lib/dates";
import type { HeartbeatStatus, WorkflowRegistryEntry } from "@/lib/workflowRegistry";

export type ScheduleRow = {
  entry: WorkflowRegistryEntry;
  status: HeartbeatStatus;
  lastCompletedAt: string | null;
  lastStatus: "running" | "success" | "failed" | null;
  lastError: string | null;
  itemsProcessed: number | null;
};

const STATUS_BADGE: Record<HeartbeatStatus, { label: string; className: string; dot: string }> = {
  healthy: { label: "Healthy", className: "bg-success/10 text-success border-success/20", dot: "🟢" },
  running: { label: "Running", className: "bg-accent/10 text-accent border-accent/20", dot: "🔵" },
  failed: { label: "Failed", className: "bg-destructive/10 text-destructive border-destructive/20", dot: "🔴" },
  stale: { label: "Overdue / stale", className: "bg-warning/10 text-warning border-warning/20", dot: "⚪" },
  never_run: { label: "Never run yet", className: "bg-muted text-muted-foreground border-border", dot: "⚪" },
};

export function ScheduleHealthTable({ rows }: { rows: ScheduleRow[] }) {
  return (
    <>
      <p className="mb-4 text-[13px] text-muted-foreground">
        All 9 GitHub Actions workflows this product relies on to send a notification - not 6 (the brief&apos;s own
        assumption didn&apos;t match this repo). Status is a heartbeat each workflow writes to itself (migration
        0099) as its own first and last step - not a live read of the GitHub Actions API, which the deployed app
        has no credential for.
      </p>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                <th className="px-4.5 py-2 font-semibold">Workflow</th>
                <th className="px-4.5 py-2 font-semibold">Cadence (SAST)</th>
                <th className="px-4.5 py-2 font-semibold">Target audience</th>
                <th className="px-4.5 py-2 font-semibold">Status</th>
                <th className="px-4.5 py-2 font-semibold">Last completed</th>
                <th className="px-4.5 py-2 font-semibold">Items</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ entry, status, lastCompletedAt, lastError, itemsProcessed }) => {
                const badge = STATUS_BADGE[status];
                return (
                  <tr key={entry.key} className="border-b border-border last:border-b-0">
                    <td className="px-4.5 py-2 text-foreground">
                      <div className="font-semibold">{entry.workflowName}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{entry.workflowFile}</div>
                    </td>
                    <td className="whitespace-nowrap px-4.5 py-2 text-muted-foreground">{entry.cadenceSast}</td>
                    <td className="max-w-[260px] px-4.5 py-2 text-muted-foreground">{entry.targetAudience}</td>
                    <td className="whitespace-nowrap px-4.5 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${badge.className}`}
                        title={status === "failed" && lastError ? lastError : undefined}
                      >
                        {badge.dot} {badge.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4.5 py-2 text-muted-foreground">
                      {lastCompletedAt ? (formatDateTime(lastCompletedAt) ?? "—") : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4.5 py-2 text-muted-foreground">{itemsProcessed ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
