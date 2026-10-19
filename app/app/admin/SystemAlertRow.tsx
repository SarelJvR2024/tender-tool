"use client";

import { useState } from "react";
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

const SEVERITY_CHIP = {
  critical: { bg: "#FEE2E2", color: "#991B1B", label: "critical" },
  error: { bg: "#FEE2E2", color: "#B91C1C", label: "error" },
  warning: { bg: "#FEF3C7", color: "#B45309", label: "warning" },
} as const;

// One system_alerts row (migration 0042). Client-only for the expand/collapse;
// the data is server-rendered by page.tsx and the buttons post to Server
// Actions in ./actions.ts - the same pattern as HarnessRunRow's review.
export default function SystemAlertRow({ alert }: { alert: SystemAlert }) {
  const [open, setOpen] = useState(false);
  const sev = SEVERITY_CHIP[alert.severity] ?? SEVERITY_CHIP.error;
  const status = alert.resolved_at
    ? { bg: "#DCFCE7", color: "#15803D", label: "resolved" }
    : alert.reported_at
      ? { bg: "#FEF3C7", color: "#B45309", label: "open - e-mailed" }
      : { bg: "#FEE2E2", color: "#B91C1C", label: "open - new" };
  const context = Object.entries(alert.context ?? {});

  return (
    <div style={{ borderTop: "1px solid #ECEEF1" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", flexWrap: "wrap", gap: "6px 12px", alignItems: "center",
          padding: "11px 18px", background: open ? "#FFFFFF" : "transparent", border: "none",
          textAlign: "left", cursor: "pointer", font: "inherit", boxSizing: "border-box",
        }}
      >
        <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: sev.bg, color: sev.color }}>
          {sev.label}
        </span>
        <span style={{ fontSize: 12, fontFamily: "monospace", color: "#4B5563" }}>{alert.source}</span>
        <span style={{ flex: "1 1 320px", minWidth: 0, fontSize: 13, color: "#16233B", overflowWrap: "anywhere" }}>{alert.message}</span>
        <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: status.bg, color: status.color }}>
          {status.label}
        </span>
        <span style={{ fontSize: 11, color: "#8A93A0" }}>
          {alert.occurrences > 1 ? `${alert.occurrences}x, last ` : ""}
          {new Date(alert.last_seen_at).toLocaleString()}
          <span style={{ marginLeft: 6, color: "#D97706" }}>{open ? "hide ▲" : "open ▼"}</span>
        </span>
      </button>

      {open && (
        <div style={{ padding: "4px 18px 18px 18px", background: "#FFFFFF" }}>
          <div style={{ fontSize: 12, color: "#4B5563", marginBottom: 8 }}>
            First seen {new Date(alert.first_seen_at).toLocaleString()}
            {alert.occurrences > 1 && ` - happened ${alert.occurrences} times`}
            {alert.reported_at && ` - e-mailed ${new Date(alert.reported_at).toLocaleString()}`}
          </div>
          {context.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              {context.map(([k, v]) => (
                <span key={k} style={{ fontSize: 11, padding: "2px 9px", borderRadius: 100, border: "1px solid #E3E6EA", background: "#FFFFFF", color: "#4B5563", fontFamily: "monospace", overflowWrap: "anywhere" }}>
                  {k}: {typeof v === "string" ? v : JSON.stringify(v)}
                </span>
              ))}
            </div>
          )}
          {alert.detail && (
            <pre style={{ fontSize: 11, color: "#4B5563", whiteSpace: "pre-wrap", overflowWrap: "anywhere", background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 9, padding: "10px 12px", maxHeight: 320, overflow: "auto", margin: "0 0 12px" }}>
              {alert.detail}
            </pre>
          )}

          <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 9, padding: "12px 14px" }}>
            {alert.resolved_at ? (
              <form action={reopenSystemAlert} style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
                <input type="hidden" name="alert_id" value={alert.id} />
                <div style={{ flex: "1 1 240px", fontSize: 12, color: "#15803D" }}>
                  Resolved {new Date(alert.resolved_at).toLocaleString()}
                  {alert.resolution_note && <div style={{ color: "#4B5563", marginTop: 4, whiteSpace: "pre-wrap" }}>{alert.resolution_note}</div>}
                </div>
                <button type="submit" style={{ fontSize: 12, padding: "6px 12px", borderRadius: 7, border: "1px solid #E3E6EA", background: "#FFFFFF", color: "#16233B", cursor: "pointer" }}>
                  Reopen
                </button>
              </form>
            ) : (
              <form action={markSystemAlertResolved} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
                <input type="hidden" name="alert_id" value={alert.id} />
                <textarea
                  name="note"
                  rows={2}
                  placeholder="Note (optional) - e.g. what was fixed, or why it is not a bug"
                  style={{ flex: "1 1 240px", font: "inherit", fontSize: 12, padding: "7px 9px", border: "1px solid #E3E6EA", borderRadius: 7, resize: "vertical" }}
                />
                <button type="submit" style={{ fontSize: 12, fontWeight: 600, padding: "8px 14px", minHeight: 44, borderRadius: 7, border: "none", background: "#D97706", color: "#FFFFFF", cursor: "pointer" }}>
                  Mark resolved
                </button>
              </form>
            )}
            <div style={{ fontSize: 11, color: "#8A93A0", marginTop: 6 }}>
              A resolved alert is never e-mailed again. If the same failure happens later it comes back as a new alert.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
