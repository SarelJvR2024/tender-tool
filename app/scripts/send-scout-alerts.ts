#!/usr/bin/env node
// Tier 3 - instant Quality Scout exception alerts (notification engine
// brief, section 3, Tier 3). Sarel's own ask, 2026-10-24: "instant Quality
// Scout exception alerts". Email, not instant in the literal sense (there is
// no event bus in this codebase - every notification type here is a
// scheduled candidate scan, same as every other tier) - this script is run
// on a tight schedule (.github/workflows/scout-alerts.yml, every 10 minutes)
// so a critical/error system_alerts row reaches Sarel within minutes of
// being written, the closest a GitHub Actions cron can get to "instant"
// without standing up a second always-on process this app has never needed
// before.
//
// Deliberately its OWN dedupe signal, NOT system_alerts.reported_at/
// reported_occurrences (migration 0042) - those are already owned by
// engine/alerts/check_system_alerts.py's own pre-existing "an external
// scheduled Claude session with Gmail access e-mails what's new" mechanism.
// See lib/scoutAnomalyAlerts.ts's own header comment for the full reasoning
// and the real, honestly-flagged consequence: until/unless Sarel retires
// that older mechanism, an open critical/error alert now reaches him twice
// (Gmail + this Resend path) rather than once.
//
// Anti-noise throttle (2026-10-25, Sarel - the real production backlog of
// 47 historical system_alerts rows was about to drain out as one separate
// email every 10 minutes for days): lib/scoutAnomalyAlerts.ts's own
// scoutAnomalyCandidates() now excludes anything with no activity in the
// last SCOUT_ANOMALY_MAX_AGE_MINUTES (still covered by founder_daily_digest's
// scoutBacklogCount, just not as its own interrupt), and this script sends
// every candidate from one run as ONE batched email, never one per alert.
//
// That batching is why this script does NOT use lib/notificationEngine.ts's
// sendNotification() helper (every other sender script does): that helper
// is built around exactly one claim -> one send -> one log, and batching
// breaks that 1:1 shape on purpose. Instead this script talks to the same
// 3 underlying primitives directly, in a claim-many -> send-once -> log-many
// order: each alert is claimed individually first (so a specific alert is
// only ever included in one email, ever, regardless of whether the batch
// send itself succeeds), the one email covers every alert that claim
// succeeded for, and one notification_logs row is written per alert
// (sharing the batch's own subject/resend_id/status) so the audit trail
// still answers "was THIS alert reported, and in which email" per row.
//
// Run: node --experimental-strip-types scripts/send-scout-alerts.ts
// Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
// ADMIN_NOTIFICATION_EMAIL.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { scoutAnomalyCandidates, scoutAnomalyIdempotencyKey, SCOUT_ANOMALY_MAX_AGE_MINUTES, type SystemAlertRow } from "../lib/scoutAnomalyAlerts.ts";
import { scoutAnomalyBatchEmail } from "../lib/emailTemplatesTier3.ts";
import { resendApiKeyConfigured, sendTransactionalEmail } from "../lib/resendEmail.ts";
import { adminNotificationEmail } from "../lib/resendEmail.ts";

type SupabaseService = SupabaseClient;

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
    process.exit(1);
  }
  const appUrl = process.env.APP_URL || "https://tender-ready.vercel.app";

  const to = adminNotificationEmail();
  if (!to) {
    console.log("ADMIN_NOTIFICATION_EMAIL not set - nowhere to send Quality Scout alerts to this run.");
    return;
  }

  const supabase: SupabaseService = createClient(url, serviceKey);

  const { data, error } = await supabase
    .from("system_alerts")
    .select("id, source, severity, message, detail, context, occurrences, first_seen_at, last_seen_at, resolved_at")
    .is("resolved_at", null)
    .order("last_seen_at", { ascending: false });
  if (error) {
    console.error("send-scout-alerts: could not read system_alerts", error);
    process.exit(1);
  }

  const openTotal = (data ?? []).length;
  const candidates = scoutAnomalyCandidates((data ?? []) as SystemAlertRow[]);
  if (candidates.length === 0) {
    console.log(`Quality Scout anomaly alerts: nothing new in the last ${SCOUT_ANOMALY_MAX_AGE_MINUTES} minutes (${openTotal} open alert(s) total).`);
    return;
  }

  if (!resendApiKeyConfigured()) {
    // Same rule every other sender script follows: a notification_claims row
    // is a one-time-only token (migration 0093's own comment), so claiming
    // it without actually being able to send would permanently waste it -
    // never claim before this check.
    console.log(`RESEND_API_KEY not set - not sending or claiming any of the ${candidates.length} candidate(s) this run (will retry once a key is added).`);
    return;
  }

  // Claim first, batch second - this is what actually prevents the same
  // alert being reported twice, independent of whether the one email that
  // follows succeeds or fails.
  const claimed: SystemAlertRow[] = [];
  for (const alert of candidates) {
    const { data: ok, error: claimError } = await supabase.rpc("claim_notification", {
      p_idempotency_key: scoutAnomalyIdempotencyKey(alert),
      p_notification_type: "scout_anomaly",
    });
    if (claimError) {
      console.error(`claim_notification failed for ${scoutAnomalyIdempotencyKey(alert)}`, claimError);
      continue;
    }
    if (ok) claimed.push(alert);
  }

  if (claimed.length === 0) {
    console.log(`Quality Scout anomaly alerts: all ${candidates.length} candidate(s) already claimed by an earlier run, nothing new to send (${openTotal} open alert(s) total).`);
    return;
  }

  const email = scoutAnomalyBatchEmail({
    alerts: claimed.map((a) => ({ source: a.source, severity: a.severity, message: a.message, occurrences: a.occurrences, firstSeenAt: a.first_seen_at })),
    appUrl,
  });
  const result = await sendTransactionalEmail({ to, subject: email.subject, html: email.html, text: email.text, from: "scout" });

  for (const alert of claimed) {
    const { error: logError } = await supabase.rpc("record_notification_sent", {
      p_idempotency_key: scoutAnomalyIdempotencyKey(alert),
      p_notification_type: "scout_anomaly",
      p_recipient_email: to,
      p_company_id: null,
      p_tender_id: null,
      p_subject: email.subject,
      p_status: result.status,
      p_resend_id: result.status === "sent" ? result.resendId : null,
      p_error: result.status === "failed" ? result.error : null,
    });
    if (logError) {
      // Same rule sendNotification() itself follows: the send already
      // happened (or didn't) - a failed log write is loud, never fatal, and
      // never retried (a retry here would double-send on the next run,
      // since this alert is already claimed).
      console.error(`record_notification_sent failed for ${scoutAnomalyIdempotencyKey(alert)} (send itself: ${result.status})`, logError);
    }
  }

  console.log(
    `Quality Scout anomaly alerts: ${result.status} (1 batch email covering ${claimed.length} of ${candidates.length} candidate(s) from the last ${SCOUT_ANOMALY_MAX_AGE_MINUTES}m, ${openTotal} open alert(s) total).`
  );
}

main().catch((e) => {
  console.error("send-scout-alerts failed", e);
  process.exit(1);
});
