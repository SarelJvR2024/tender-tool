// Tier 3 - instant Quality Scout exception alerts, candidate selection only.
//
// Deliberately its OWN, separate dedupe signal from system_alerts'
// reported_at/reported_occurrences (migration 0042) - those columns are
// already owned by engine/alerts/check_system_alerts.py's own seen store,
// for the pre-existing "an external scheduled Claude session with real
// Gmail access runs this script and e-mails what's new" mechanism (that
// file's own header comment, written before this Resend pipeline existed:
// "Building a mail sender here would be a second, parallel notification
// mechanism"). This file's own script (scripts/send-scout-alerts.ts) IS now
// that second, parallel mechanism - built because Sarel explicitly asked
// for "instant Quality Scout exception alerts" as part of this very brief.
// Sharing reported_at with the Python checker would make the two race for
// the same claim and silently starve one of them of alerts it should have
// gotten; using notification_claims (migration 0093, via
// lib/notificationEngine.ts's sendNotification()) instead means both can
// safely read the same open system_alerts rows without stepping on each
// other. Flagged plainly here and in this change's own PR description:
// until/unless Sarel retires the older Gmail mechanism, an open alert now
// reaches him twice (Gmail + Resend) rather than once - a real decision for
// him to make, not guessed at silently.
const SEVERITY_RANK: Record<string, number> = { warning: 1, error: 2, critical: 3 };

// "Instant exception alert" means urgent only - critical + error. A plain
// warning still counts toward founder_daily_digest's own scoutBacklogCount
// (the full, unfiltered backlog), just not an instant interrupt of its own.
export const SCOUT_ANOMALY_MIN_SEVERITY = "error";

export type SystemAlertRow = {
  id: string;
  source: string;
  severity: "critical" | "error" | "warning";
  message: string;
  detail: string | null;
  context: Record<string, unknown>;
  occurrences: number;
  first_seen_at: string;
  resolved_at: string | null;
};

export function scoutAnomalyCandidates(alerts: SystemAlertRow[], minSeverity: string = SCOUT_ANOMALY_MIN_SEVERITY): SystemAlertRow[] {
  const floor = SEVERITY_RANK[minSeverity] ?? 1;
  return alerts.filter((a) => !a.resolved_at && (SEVERITY_RANK[a.severity] ?? 2) >= floor);
}

/** This alert's current idempotency key - re-notifies once per new batch of occurrences (mirrors check_system_alerts.py's own "still_occurring" rule: a failure that keeps happening is not silently absorbed into one old notification), independent of reported_at/reported_occurrences. */
export function scoutAnomalyIdempotencyKey(alert: SystemAlertRow): string {
  return `scout-anomaly-${alert.id}-${alert.occurrences}`;
}
