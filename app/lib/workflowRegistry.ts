// The static list of every GitHub Actions workflow this product relies on
// to send a notification - name, cadence, and which script it runs, kept
// here (not in the workflow_heartbeats table, migration 0099) so the YAML
// files stay the one source of truth for scheduling and this file stays a
// plain, PR-reviewable mirror of them. If this drifts from .github/
// workflows/*.yml, that's a real bug to fix here, not a sign the DB needs
// its own copy of the cron string too.
//
// 10 workflows, not 6 - the Notification Command Center brief assumed 6;
// the repo actually has 10 cron-scheduled senders today (confirmed by
// reading .github/workflows/ directly, 2026-10-27, most recently
// returnables-digest.yml, Phase 6). Shown as-is rather than arbitrarily
// dropped to match a number from before this list was audited.
export type WorkflowCadenceKind = "cron" | "event_driven";

export type WorkflowRegistryEntry = {
  /** Matches workflow_heartbeats.workflow_key (migration 0099) and the --key record_heartbeat.py is called with in the workflow's own YAML. */
  key: string;
  workflowName: string;
  workflowFile: string;
  kind: WorkflowCadenceKind;
  /** Raw 5-field cron expression, UTC - null for an event-driven workflow with no schedule trigger. */
  cronUtc: string | null;
  /** Human cadence in SAST (UTC+2, no DST), for display - matches each workflow's own YAML comment. */
  cadenceSast: string;
  targetAudience: string;
  scriptPaths: string[];
};

export const WORKFLOW_REGISTRY: WorkflowRegistryEntry[] = [
  {
    key: "daily_discovery",
    workflowName: "Daily Tender Discovery",
    workflowFile: "daily-discovery.yml",
    kind: "cron",
    cronUtc: "45 2 * * *",
    cadenceSast: "Daily, 04:45 SAST",
    targetAudience: "Every company with a saved discovery filter (discovered_tenders_digest)",
    scriptPaths: ["engine/discovery/watch_new_tenders.py", "scripts/send-discovered-tenders.ts"],
  },
  {
    key: "daily_digest",
    workflowName: "Daily Tender Digest",
    workflowFile: "daily-digest.yml",
    kind: "cron",
    cronUtc: "45 3 * * *",
    cadenceSast: "Daily, 05:45 SAST",
    targetAudience: "Every company tracking at least one tender (digest of status changes)",
    scriptPaths: ["engine/notify/daily_digest.py", "engine/notify/send_digest_emails.py"],
  },
  {
    key: "compliance_digest",
    workflowName: "Compliance Expiry Digest",
    workflowFile: "compliance-alerts.yml",
    kind: "cron",
    cronUtc: "30 3 * * *",
    cadenceSast: "Daily, 05:30 SAST",
    targetAudience: "Companies with a SARS/COID/B-BBEE/CIDB/registration/ECSA/SACPCMP item crossing 30, 14 or 7 days",
    scriptPaths: ["scripts/send-compliance-digest.ts"],
  },
  {
    key: "corrigendum_alerts",
    workflowName: "Corrigenda & Addenda Alerts",
    workflowFile: "corrigendum-alerts.yml",
    kind: "cron",
    cronUtc: "0 5-17/2 * * 1-5",
    cadenceSast: "Every 2h, 07:00-19:00 SAST, Mon-Fri",
    targetAudience: "Companies pursuing a tender with a new closing-date/document change in the last 14 days",
    scriptPaths: ["scripts/send-corrigendum-alerts.ts"],
  },
  {
    key: "deadline_reminders",
    workflowName: "Deadline Reminders",
    workflowFile: "deadline-reminders.yml",
    kind: "cron",
    cronUtc: "10 4 * * *",
    cadenceSast: "Daily, 06:10 SAST",
    targetAudience: "Companies with a tender closing inside the reminder window",
    scriptPaths: ["scripts/send-deadline-reminders.ts"],
  },
  {
    key: "operational_alerts",
    workflowName: "Operational Alerts (print cutoff, briefing, clarification window)",
    workflowFile: "operational-alerts.yml",
    kind: "cron",
    cronUtc: "20 4 * * *",
    cadenceSast: "Daily, 06:20 SAST",
    targetAudience: "Companies with a tender crossing its print/transit cutoff, briefing countdown, or clarification-question deadline",
    scriptPaths: ["scripts/send-operational-alerts.ts"],
  },
  {
    key: "onboarding_nudges",
    workflowName: "Onboarding Nudges",
    workflowFile: "onboarding-nudges.yml",
    kind: "cron",
    cronUtc: "30 4 * * *",
    cadenceSast: "Daily, 06:30 SAST",
    targetAudience: "Trialing companies at vault-kickstart, first-tender, day-7, 48h-left or trial-expired milestones",
    scriptPaths: ["scripts/send-onboarding-nudges.ts"],
  },
  {
    key: "scout_alerts",
    workflowName: "Quality Scout Alerts",
    workflowFile: "scout-alerts.yml",
    kind: "cron",
    cronUtc: "*/10 * * * *",
    cadenceSast: "Every 10 minutes",
    targetAudience: "Sarel only (ADMIN_NOTIFICATION_EMAIL) - batched extraction/worker anomalies",
    scriptPaths: ["scripts/send-scout-alerts.ts"],
  },
  {
    key: "returnables_digest",
    workflowName: "Pack Incomplete / Returnables Checklist Digest",
    workflowFile: "returnables-digest.yml",
    kind: "cron",
    cronUtc: "40 4 * * *",
    cadenceSast: "Daily, 06:40 SAST",
    targetAudience: "Companies with a tracked tender 3-5 business days from closing and a mandatory returnable missing, expired or unverified",
    scriptPaths: ["scripts/send-returnables-digest.ts"],
  },
  {
    key: "founder_digest",
    workflowName: "Founder Daily Digest",
    workflowFile: "founder-digest.yml",
    kind: "cron",
    cronUtc: "0 5 * * *",
    cadenceSast: "Daily, 07:00 SAST",
    targetAudience: "Sarel only (ADMIN_NOTIFICATION_EMAIL) - new signups, conversions, platform-wide counts",
    scriptPaths: ["scripts/send-founder-digest.ts"],
  },
];

export type HeartbeatStatus = "never_run" | "healthy" | "running" | "failed" | "stale";

export type WorkflowHeartbeatRow = {
  workflow_key: string;
  last_started_at: string | null;
  last_completed_at: string | null;
  last_status: "running" | "success" | "failed";
  last_error: string | null;
  items_processed: number | null;
  duration_ms: number | null;
  updated_at: string;
};

/** How long a cron can run late (clock drift, GitHub Actions scheduling jitter, which is real and documented by GitHub itself) before "hasn't run since its last expected time" becomes "stale" rather than just "due soon" - scaled to each workflow's OWN cadence (half the interval, 15-minute floor) rather than one flat number: a flat grace either flags a 10-minute job stale after a harmless few minutes' jitter, or lets a once-daily job go silent for days before anyone notices - neither is useful. */
const STALE_GRACE_FLOOR_MS = 15 * 60 * 1000;
function staleGraceMs(intervalMs: number): number {
  return Math.max(STALE_GRACE_FLOOR_MS, intervalMs / 2);
}
/** A 'running' row older than this never got its own finish step called (a dead runner, a cancelled job) - treated as failed, not perpetually "in progress". Flat, not cadence-scaled: this is about one run taking impossibly long, not about how often the workflow fires. */
const RUNNING_TIMEOUT_MS = 2 * 60 * 60 * 1000;

function cronIntervalMs(cronUtc: string | null): number | null {
  if (!cronUtc) return null;
  if (cronUtc === "*/10 * * * *") return 10 * 60 * 1000;
  // Every 5-17/2-style "every N hours" or once-daily - both are well
  // covered by a 24h-or-less assumption for staleness purposes; a workflow
  // this infrequent genuinely has no tighter guarantee than "once a day".
  if (/^0?\s+\d+-\d+\/(\d+)\s/.test(cronUtc)) {
    const everyHours = Number(cronUtc.match(/\/(\d+)/)?.[1] ?? 24);
    return everyHours * 60 * 60 * 1000;
  }
  return 24 * 60 * 60 * 1000;
}

/** Pure function: given this workflow's own cadence and its latest heartbeat row (or none), what badge should the admin UI show. No network call, no `now` ambiguity - callers pass `nowMs` explicitly so this stays a pure function and is trivially testable. */
export function heartbeatStatusFor(entry: WorkflowRegistryEntry, row: WorkflowHeartbeatRow | null, nowMs: number): HeartbeatStatus {
  if (!row) return "never_run";
  if (row.last_status === "running") {
    const startedMs = row.last_started_at ? new Date(row.last_started_at).getTime() : 0;
    return nowMs - startedMs > RUNNING_TIMEOUT_MS ? "failed" : "running";
  }
  if (row.last_status === "failed") return "failed";
  const intervalMs = cronIntervalMs(entry.cronUtc);
  if (intervalMs === null || !row.last_completed_at) return "healthy";
  const sinceMs = nowMs - new Date(row.last_completed_at).getTime();
  return sinceMs > intervalMs + staleGraceMs(intervalMs) ? "stale" : "healthy";
}
