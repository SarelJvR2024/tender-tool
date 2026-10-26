"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/dates";
import { markSystemAlertResolved, reopenSystemAlert } from "./actions";

export type SystemAlert = {
  id: string;
  source: string;
  severity: "critical" | "error" | "warning";
  message: string;
  detail: string | null;
  context: Record<string, unknown> | null;
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  reported_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
};

// Color-token migration (2026-10-21): was raw inline-CSSProperties with a
// literal hex pair per chip (red/amber/green tints) - now the same soft
// 10%-tint convention every other status chip in this app uses
// (bg-*/10, full-strength text, border-*/20). "Mark resolved" moved from
// the old gold CTA to bg-accent/text-accent-foreground - the single most
// important action on an open alert row, exactly what accent is reserved
// for.
const SEVERITY_TONE = {
  critical: "destructive",
  error: "destructive",
  warning: "warning",
} as const;

// Tailwind's scanner needs full, static class strings - a template-literal
// `bg-${tone}/10` is invisible to it, so each tone is spelled out in full.
const CHIP_TONE_CLASS = {
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  success: "bg-success/10 text-success border-success/20",
} as const;

function chipClass(tone: keyof typeof CHIP_TONE_CLASS) {
  return `inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${CHIP_TONE_CLASS[tone]}`;
}

// One system_alerts row (migration 0042). Client-only for the expand/collapse;
// the data is server-rendered by page.tsx and the buttons post to Server
// Actions in ./actions.ts - the same pattern as HarnessRunRow's review.
export default function SystemAlertRow({ alert }: { alert: SystemAlert }) {
  const [open, setOpen] = useState(false);
  const sevTone = SEVERITY_TONE[alert.severity] ?? "destructive";
  const sevLabel = alert.severity;
  const status = alert.resolved_at
    ? { tone: "success" as const, label: "resolved" }
    : alert.reported_at
      ? { tone: "warning" as const, label: "open - e-mailed" }
      : { tone: "destructive" as const, label: "open - new" };
  const context = Object.entries(alert.context ?? {});

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4.5 py-2.5 text-left font-[inherit] ${open ? "bg-card" : "bg-transparent"}`}
      >
        <span className={chipClass(sevTone)}>{sevLabel}</span>
        <span className="font-mono text-xs text-muted-foreground">{alert.source}</span>
        <span className="min-w-0 flex-[1_1_320px] text-[13px] break-words text-foreground">{alert.message}</span>
        <span className={chipClass(status.tone)}>{status.label}</span>
        <span className="text-[11px] text-muted-foreground">
          {alert.occurrences > 1 ? `${alert.occurrences}x, last ` : ""}
          {formatDateTime(alert.last_seen_at) ?? alert.last_seen_at}
          <span className="ml-1.5 text-accent">{open ? "hide ▲" : "open ▼"}</span>
        </span>
      </button>

      {open && (
        <div className="bg-card px-4.5 pb-4.5 pt-1">
          <div className="mb-2 text-xs text-muted-foreground">
            First seen {formatDateTime(alert.first_seen_at) ?? alert.first_seen_at}
            {alert.occurrences > 1 && ` - happened ${alert.occurrences} times`}
            {alert.reported_at && ` - e-mailed ${formatDateTime(alert.reported_at) ?? alert.reported_at}`}
          </div>
          {context.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-1.5">
              {context.map(([k, v]) => (
                <span key={k} className="rounded-full border border-border bg-card px-2.5 py-0.5 font-mono text-[11px] break-words text-muted-foreground">
                  {k}: {typeof v === "string" ? v : JSON.stringify(v)}
                </span>
              ))}
            </div>
          )}
          {alert.detail && (
            <pre className="mb-3 max-h-80 overflow-auto rounded-lg border border-border bg-card p-2.5 text-[11px] whitespace-pre-wrap break-words text-muted-foreground">
              {alert.detail}
            </pre>
          )}

          <div className="rounded-lg border border-border bg-card p-3.5">
            {alert.resolved_at ? (
              <form action={reopenSystemAlert} className="flex flex-wrap items-start gap-3">
                <input type="hidden" name="alert_id" value={alert.id} />
                <div className="flex-[1_1_240px] text-xs text-success">
                  Resolved {formatDateTime(alert.resolved_at) ?? alert.resolved_at}
                  {alert.resolution_note && <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{alert.resolution_note}</div>}
                </div>
                <button type="submit" className="min-h-11 rounded-md border border-border bg-card px-3 text-xs text-foreground">
                  Reopen
                </button>
              </form>
            ) : (
              <form action={markSystemAlertResolved} className="flex flex-wrap items-start gap-2.5">
                <input type="hidden" name="alert_id" value={alert.id} />
                <textarea
                  name="note"
                  rows={2}
                  placeholder="Note (optional) - e.g. what was fixed, or why it is not a bug"
                  className="flex-[1_1_240px] resize-y rounded-md border border-border px-2.5 py-1.5 font-[inherit] text-xs"
                />
                <button type="submit" className="min-h-11 rounded-md bg-accent px-3.5 text-xs font-semibold text-accent-foreground">
                  Mark resolved
                </button>
              </form>
            )}
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              A resolved alert is never e-mailed again. If the same failure happens later it comes back as a new alert.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
