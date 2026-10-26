import { describe, expect, it } from "vitest";
import { scoutAnomalyCandidates, scoutAnomalyIdempotencyKey, SCOUT_ANOMALY_MAX_AGE_MINUTES, type SystemAlertRow } from "./scoutAnomalyAlerts";

const NOW = new Date("2026-10-25T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000).toISOString();

function alert(overrides: Partial<SystemAlertRow>): SystemAlertRow {
  return {
    id: "a1",
    source: "worker",
    severity: "error",
    message: "boom",
    detail: null,
    context: {},
    occurrences: 1,
    first_seen_at: minutesAgo(5),
    last_seen_at: minutesAgo(5),
    resolved_at: null,
    ...overrides,
  };
}

describe("scoutAnomalyCandidates", () => {
  it("includes error and critical alerts by default", () => {
    const errorAlert = alert({ severity: "error" });
    const criticalAlert = alert({ id: "a2", severity: "critical" });
    expect(scoutAnomalyCandidates([errorAlert, criticalAlert], { now: NOW }).map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("excludes plain warnings - instant alerts are urgent-only, warnings stay in the digest's own backlog count", () => {
    expect(scoutAnomalyCandidates([alert({ severity: "warning" })], { now: NOW })).toEqual([]);
  });

  it("excludes resolved alerts", () => {
    expect(scoutAnomalyCandidates([alert({ resolved_at: "2026-10-24T01:00:00Z" })], { now: NOW })).toEqual([]);
  });

  it("a lower minSeverity widens the set to include warnings", () => {
    expect(scoutAnomalyCandidates([alert({ severity: "warning" })], { now: NOW, minSeverity: "warning" })).toHaveLength(1);
  });

  it("excludes a stale alert with no recent activity - the backlog-throttle rule", () => {
    const stale = alert({ last_seen_at: minutesAgo(SCOUT_ANOMALY_MAX_AGE_MINUTES + 1) });
    expect(scoutAnomalyCandidates([stale], { now: NOW })).toEqual([]);
  });

  it("includes an alert right at the age boundary", () => {
    const atBoundary = alert({ last_seen_at: minutesAgo(SCOUT_ANOMALY_MAX_AGE_MINUTES) });
    expect(scoutAnomalyCandidates([atBoundary], { now: NOW })).toHaveLength(1);
  });

  it("includes a long-open alert that JUST recurred - last_seen_at is what matters, not first_seen_at", () => {
    const oldButRecurring = alert({ first_seen_at: "2026-01-01T00:00:00Z", last_seen_at: minutesAgo(2) });
    expect(scoutAnomalyCandidates([oldButRecurring], { now: NOW })).toHaveLength(1);
  });

  it("a wider maxAgeMinutes picks up older activity", () => {
    const old = alert({ last_seen_at: minutesAgo(120) });
    expect(scoutAnomalyCandidates([old], { now: NOW, maxAgeMinutes: 180 })).toHaveLength(1);
  });
});

describe("scoutAnomalyIdempotencyKey", () => {
  it("changes when occurrences grows, so a recurring failure re-notifies once per new batch", () => {
    const first = scoutAnomalyIdempotencyKey(alert({ occurrences: 1 }));
    const second = scoutAnomalyIdempotencyKey(alert({ occurrences: 2 }));
    expect(first).not.toBe(second);
  });

  it("is stable for the same alert id and occurrence count", () => {
    expect(scoutAnomalyIdempotencyKey(alert({ id: "x", occurrences: 3 }))).toBe(scoutAnomalyIdempotencyKey(alert({ id: "x", occurrences: 3 })));
  });
});
