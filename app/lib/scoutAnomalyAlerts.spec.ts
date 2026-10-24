import { describe, expect, it } from "vitest";
import { scoutAnomalyCandidates, scoutAnomalyIdempotencyKey, type SystemAlertRow } from "./scoutAnomalyAlerts";

function alert(overrides: Partial<SystemAlertRow>): SystemAlertRow {
  return {
    id: "a1",
    source: "worker",
    severity: "error",
    message: "boom",
    detail: null,
    context: {},
    occurrences: 1,
    first_seen_at: "2026-10-24T00:00:00Z",
    resolved_at: null,
    ...overrides,
  };
}

describe("scoutAnomalyCandidates", () => {
  it("includes error and critical alerts by default", () => {
    const errorAlert = alert({ severity: "error" });
    const criticalAlert = alert({ id: "a2", severity: "critical" });
    expect(scoutAnomalyCandidates([errorAlert, criticalAlert]).map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("excludes plain warnings - instant alerts are urgent-only, warnings stay in the digest's own backlog count", () => {
    expect(scoutAnomalyCandidates([alert({ severity: "warning" })])).toEqual([]);
  });

  it("excludes resolved alerts", () => {
    expect(scoutAnomalyCandidates([alert({ resolved_at: "2026-10-24T01:00:00Z" })])).toEqual([]);
  });

  it("a lower minSeverity widens the set to include warnings", () => {
    expect(scoutAnomalyCandidates([alert({ severity: "warning" })], "warning")).toHaveLength(1);
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
