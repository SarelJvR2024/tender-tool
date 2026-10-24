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
// Run: node --experimental-strip-types scripts/send-scout-alerts.ts
// Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
// ADMIN_NOTIFICATION_EMAIL.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { scoutAnomalyCandidates, scoutAnomalyIdempotencyKey, type SystemAlertRow } from "../lib/scoutAnomalyAlerts.ts";
import { scoutAnomalyEmail } from "../lib/emailTemplatesTier3.ts";
import { sendNotification } from "../lib/notificationEngine.ts";
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

  if (!process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set - not sending or claiming any Scout alert this run (will retry once a key is added).");
    return;
  }

  const supabase: SupabaseService = createClient(url, serviceKey);

  const { data, error } = await supabase
    .from("system_alerts")
    .select("id, source, severity, message, detail, context, occurrences, first_seen_at, resolved_at")
    .is("resolved_at", null)
    .order("last_seen_at", { ascending: false });
  if (error) {
    console.error("send-scout-alerts: could not read system_alerts", error);
    process.exit(1);
  }

  const candidates = scoutAnomalyCandidates((data ?? []) as SystemAlertRow[]);
  let sent = 0;
  for (const alert of candidates) {
    const email = scoutAnomalyEmail({
      source: alert.source,
      severity: alert.severity,
      message: alert.message,
      detail: alert.detail,
      occurrences: alert.occurrences,
      firstSeenAt: alert.first_seen_at,
      context: alert.context,
      appUrl,
    });
    const result = await sendNotification(supabase, {
      idempotencyKey: scoutAnomalyIdempotencyKey(alert),
      notificationType: "scout_anomaly",
      senderProfile: "scout",
      to,
      email,
    });
    if (result.outcome === "sent") sent++;
  }

  console.log(`Quality Scout anomaly alerts: ${sent} sent, out of ${candidates.length} candidate(s) (${(data ?? []).length} open alert(s) total).`);
}

main().catch((e) => {
  console.error("send-scout-alerts failed", e);
  process.exit(1);
});
