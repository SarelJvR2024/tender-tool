import { describe, expect, it } from "vitest";
import { heartbeatStatusFor, WORKFLOW_REGISTRY, type WorkflowHeartbeatRow } from "./workflowRegistry";

const NOW = new Date("2026-10-27T12:00:00Z").getTime();
const entry = WORKFLOW_REGISTRY.find((w) => w.key === "compliance_digest")!; // once-daily
const scout = WORKFLOW_REGISTRY.find((w) => w.key === "scout_alerts")!; // every 10 min

function row(overrides: Partial<WorkflowHeartbeatRow>): WorkflowHeartbeatRow {
  return {
    workflow_key: entry.key,
    last_started_at: null,
    last_completed_at: null,
    last_status: "success",
    last_error: null,
    items_processed: null,
    duration_ms: null,
    updated_at: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe("WORKFLOW_REGISTRY", () => {
  it("has exactly 9 entries, one per real cron-relevant workflow file", () => {
    expect(WORKFLOW_REGISTRY).toHaveLength(9);
    expect(new Set(WORKFLOW_REGISTRY.map((w) => w.key)).size).toBe(9);
  });
});

describe("heartbeatStatusFor", () => {
  it("never_run when no heartbeat row exists yet", () => {
    expect(heartbeatStatusFor(entry, null, NOW)).toBe("never_run");
  });

  it("healthy when the last completed run is within its own cadence + grace", () => {
    const completedAt = new Date(NOW - 2 * 60 * 60 * 1000).toISOString(); // 2h ago, daily cadence
    expect(heartbeatStatusFor(entry, row({ last_completed_at: completedAt }), NOW)).toBe("healthy");
  });

  it("stale when the last completed run is well past its cadence + grace", () => {
    const completedAt = new Date(NOW - 48 * 60 * 60 * 1000).toISOString(); // 2 days ago, daily cadence
    expect(heartbeatStatusFor(entry, row({ last_completed_at: completedAt }), NOW)).toBe("stale");
  });

  it("failed when the last run's own status was failed", () => {
    expect(heartbeatStatusFor(entry, row({ last_status: "failed", last_completed_at: new Date(NOW).toISOString() }), NOW)).toBe("failed");
  });

  it("running when a run started recently and hasn't finished yet", () => {
    const startedAt = new Date(NOW - 5 * 60 * 1000).toISOString();
    expect(heartbeatStatusFor(entry, row({ last_status: "running", last_started_at: startedAt, last_completed_at: null }), NOW)).toBe("running");
  });

  it("a 'running' row stuck past the timeout reads as failed, not perpetually in progress", () => {
    const startedAt = new Date(NOW - 3 * 60 * 60 * 1000).toISOString(); // 3h ago
    expect(heartbeatStatusFor(entry, row({ last_status: "running", last_started_at: startedAt, last_completed_at: null }), NOW)).toBe("failed");
  });

  it("a 10-minute-cadence workflow goes stale much sooner than a once-daily one", () => {
    const completedAt = new Date(NOW - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
    expect(heartbeatStatusFor(scout, row({ workflow_key: scout.key, last_completed_at: completedAt }), NOW)).toBe("stale");
  });
});
