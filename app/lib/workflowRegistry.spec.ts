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
  it("has exactly 10 entries, one per real cron-relevant workflow file", () => {
    expect(WORKFLOW_REGISTRY).toHaveLength(10);
    expect(new Set(WORKFLOW_REGISTRY.map((w) => w.key)).size).toBe(10);
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

  describe("corrigendum_alerts (business-hours + weekday-only cron: '0 5-17/2 * * 1-5')", () => {
    const corrigendum = WORKFLOW_REGISTRY.find((w) => w.key === "corrigendum_alerts")!;

    it("stays healthy over a weekend gap - Friday's last run to Monday morning, before Monday's window even opens", () => {
      const fridayLastRun = new Date("2026-10-23T17:00:00Z").toISOString(); // Fri 17:00 UTC (last in-window firing)
      const mondayMorning = new Date("2026-10-26T06:00:00Z").getTime(); // Mon 06:00 UTC, window opens 05:00
      expect(heartbeatStatusFor(corrigendum, row({ workflow_key: corrigendum.key, last_completed_at: fridayLastRun }), mondayMorning)).toBe("healthy");
    });

    it("stays healthy overnight - Wednesday's last run to Thursday, before Thursday's window opens", () => {
      const wedLastRun = new Date("2026-10-21T17:00:00Z").toISOString();
      const thuEarlyMorning = new Date("2026-10-22T04:30:00Z").getTime(); // before the 05:00 UTC window opens
      expect(heartbeatStatusFor(corrigendum, row({ workflow_key: corrigendum.key, last_completed_at: wedLastRun }), thuEarlyMorning)).toBe("healthy");
    });

    it("goes stale on a genuine multi-day mid-week outage, even though no weekend is involved", () => {
      // Regression guard for a bug an earlier version of this same fix introduced: widening the
      // allowed gap to cover the worst case (the Friday-to-Monday span) and applying that one flat
      // number everywhere silently hid a real 3-day mid-week failure too, since all of Tue/Wed
      // counted as "within the generous weekend-sized allowance" even though no weekend fell in it.
      const mondayLastRun = new Date("2026-10-19T17:00:00Z").toISOString();
      const thursdayMidday = new Date("2026-10-22T12:00:00Z").getTime(); // missed Tue + Wed + half of Thu entirely
      expect(heartbeatStatusFor(corrigendum, row({ workflow_key: corrigendum.key, last_completed_at: mondayLastRun }), thursdayMidday)).toBe("stale");
    });

    it("goes stale after missing just one in-window firing, same business day", () => {
      const lastRun = new Date("2026-10-22T09:00:00Z").toISOString(); // Thu 09:00 UTC
      const missedNextFiring = new Date("2026-10-22T13:30:00Z").getTime(); // 11:00 firing never happened
      expect(heartbeatStatusFor(corrigendum, row({ workflow_key: corrigendum.key, last_completed_at: lastRun }), missedNextFiring)).toBe("stale");
    });

    it("stays healthy within one normal in-window gap", () => {
      const lastRun = new Date("2026-10-22T09:00:00Z").toISOString();
      const soonAfter = new Date("2026-10-22T10:30:00Z").getTime();
      expect(heartbeatStatusFor(corrigendum, row({ workflow_key: corrigendum.key, last_completed_at: lastRun }), soonAfter)).toBe("healthy");
    });
  });
});
