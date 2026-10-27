import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../../_components/AppShell";
import { AdminNav } from "../AdminNav";
import { StatCard } from "@/components/tt/stat-card";
import { HEALTH_SOURCE_GROUPS } from "@/lib/adminHealthGroups";

// Reads per-request session/DB data (gated by is_platform_admin() - migration
// 0101) - same escape hatch as every other admin page.
export const instant = false;

type TelemetryRow = {
  queue_key: string;
  queue_label: string;
  queued_count: number;
  active_count: number;
  completed_24h_count: number;
  failed_24h_count: number;
  avg_latency_seconds: number | null;
};

function formatLatency(seconds: number | null): string {
  if (seconds === null) return "no completions in the last 7 days";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/**
 * Worker queue depth + engine latency + a 24h error-rate breakdown
 * (Admin Command Center Phase 3, 2026-10-27) - every number here is a plain
 * aggregate over the 4 real job-queue tables and system_alerts, none of it
 * new instrumentation (see migration 0101's own header for exactly which
 * tables/columns). Deliberately NOT a live GitHub Actions read and NOT a
 * new heartbeat table of its own - a prior pass (2026-10-25) already
 * decided against that for these same queues, and nothing here needed to
 * override that call the way Phase 1's notification workflow_heartbeats
 * did (those genuinely had no other signal; these job tables already
 * carry real status/timestamp columns).
 */
export default async function AdminTelemetryPage() {
  const supabase = await createClient();

  const [{ data: queueRows, error: queueError }, { data: alertRows, error: alertError }] = await Promise.all([
    supabase.rpc("platform_admin_engine_telemetry"),
    supabase.rpc("platform_admin_alert_counts_24h"),
  ]);
  if (queueError) console.error("platform_admin_engine_telemetry rpc failed", queueError);
  if (alertError) console.error("platform_admin_alert_counts_24h rpc failed", alertError);

  const rows = (queueRows ?? []) as TelemetryRow[];
  const alertCountBySource = new Map(((alertRows ?? []) as { source: string; alert_count: number }[]).map((a) => [a.source, a.alert_count]));
  const errorGroups = Object.entries(HEALTH_SOURCE_GROUPS).map(([label, sources]) => ({
    label,
    count: sources.reduce((sum, s) => sum + (alertCountBySource.get(s) ?? 0), 0),
  }));

  const totalQueued = rows.reduce((s, r) => s + r.queued_count, 0);
  const totalActive = rows.reduce((s, r) => s + r.active_count, 0);
  const totalFailed24h = rows.reduce((s, r) => s + r.failed_24h_count, 0);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1100px] p-4 sm:p-6 md:px-8 md:py-6">
        <AdminNav active="telemetry" />

        <h1 className="mb-1 font-display text-[22px] font-bold text-foreground">Telemetry</h1>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Worker queue depth and engine latency across every real job-queue table this product has - submission
          pack builds, requirement extraction, CV generation, narrative drafting, and onboarding document
          classification. Nothing here is a live read of GitHub Actions or a new heartbeat - every number is an
          aggregate over status/timestamp columns that were already being written.
        </p>

        {(queueError || alertError) && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
            {"Couldn't load telemetry - try refreshing. If it keeps happening, let us know."}
          </div>
        )}

        <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          <StatCard label="Queued across every engine" value={totalQueued} tone={totalQueued > 0 ? "warning" : "default"} />
          <StatCard label="Actively running" value={totalActive} tone="muted" />
          <StatCard label="Failed in the last 24h" value={totalFailed24h} tone={totalFailed24h > 0 ? "destructive" : "success"} />
        </div>

        <div className="mb-8 overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                  <th className="px-4.5 py-2 font-semibold">Engine</th>
                  <th className="px-4.5 py-2 font-semibold">Queued</th>
                  <th className="px-4.5 py-2 font-semibold">Active</th>
                  <th className="px-4.5 py-2 font-semibold">Completed (24h)</th>
                  <th className="px-4.5 py-2 font-semibold">Failed (24h)</th>
                  <th className="px-4.5 py-2 font-semibold">Avg latency (7d)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.queue_key} className="border-b border-border last:border-b-0">
                    <td className="px-4.5 py-2 text-foreground">{r.queue_label}</td>
                    <td className="px-4.5 py-2 text-muted-foreground">{r.queued_count}</td>
                    <td className="px-4.5 py-2 text-muted-foreground">{r.active_count}</td>
                    <td className="px-4.5 py-2 text-muted-foreground">{r.completed_24h_count}</td>
                    <td className={`px-4.5 py-2 ${r.failed_24h_count > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{r.failed_24h_count}</td>
                    <td className="whitespace-nowrap px-4.5 py-2 text-muted-foreground">{formatLatency(r.avg_latency_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <h2 className="mb-1 font-display text-[18px] font-bold text-foreground">Error rate (last 24h)</h2>
        <p className="mb-4 text-[13px] text-muted-foreground">
          How many system_alerts occurrences landed in the last 24 hours, by engine area - a different question
          from the main Alerts page&apos;s &quot;what&apos;s still open right now&quot;. A recurring open alert
          counts again each day it keeps happening.
        </p>
        <div className="flex flex-wrap gap-2.5">
          {errorGroups.map((g) => (
            <span
              key={g.label}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold ${
                g.count === 0 ? "border-success/20 bg-success/10 text-success" : "border-warning/20 bg-warning/10 text-warning"
              }`}
            >
              {g.label}
              <span className="font-normal opacity-80">- {g.count} in 24h</span>
            </span>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
