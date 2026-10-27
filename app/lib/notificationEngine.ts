// The one entrypoint every Tier 0-3 notification should call to actually
// dispatch an email - wires together the three pieces migration 0092 and
// lib/resendEmail.ts each added on their own: claim the idempotency key
// (claim_notification), send via Resend (sendTransactionalEmail), and log
// the outcome (record_notification_sent) - in that order, every time,
// regardless of whether the caller is a Next.js Server Action (anon/
// authenticated Supabase client, no service-role key) or a standalone
// script/engine job (service-role client). Both kinds of caller pass
// whatever SupabaseClient they already have; the RPCs underneath are
// SECURITY DEFINER either way (see 0092's own header for why that's not
// redundant for a service-role caller: one consistent write path).
//
// Framework-agnostic on purpose, same reasoning lib/resendEmail.ts and
// lib/emailTemplates.ts already give: scripts/send-deadline-reminders.ts
// and the handful of new scripts/cron routes this engine adds both need to
// import this directly, outside Next.js.
import type { SupabaseClient } from "@supabase/supabase-js";
import { resendApiKeyConfigured, sendTransactionalEmail, type EmailAttachment, type SenderProfile } from "./resendEmail.ts";

export type NotificationType =
  // Tier 0 - onboarding & lifecycle
  | "welcome_user"
  | "nudge_vault_kickstart"
  | "nudge_first_tender"
  | "trial_day_7_milestone"
  | "trial_expiring_48h"
  | "trial_expired"
  | "team_invite"
  | "admin_new_signup"
  | "admin_paid_conversion"
  // Tier 1 - tender operational alerts
  | "briefing_reminder"
  | "print_sign_cutoff"
  | "corrigendum_alert"
  | "discovered_tenders_digest"
  | "clarification_window"
  | "pack_ready"
  // Tier 2 - compliance & vault alerts
  | "sars_pin_expiry"
  | "csd_refresh"
  | "coida_cidb_expiry"
  // Tier 3 - founder & Quality Scout alerts
  | "scout_anomaly"
  | "founder_daily_digest";

export type NotificationEmail = { subject: string; html: string; text: string; attachments?: EmailAttachment[]; headers?: Record<string, string> };

export type SendNotificationInput = {
  /** The dedupe key for this exact notification - e.g. `briefing-24h-<tender_id>-<company_id>`. Must be stable across retries/re-runs of the same logical send and unique across every OTHER notification this engine ever sends. */
  idempotencyKey: string;
  notificationType: NotificationType;
  senderProfile: SenderProfile;
  to: string;
  email: NotificationEmail;
  companyId?: string | null;
  tenderId?: string | null;
};

export type SendNotificationResult =
  | { outcome: "sent"; resendId: string }
  | { outcome: "already_sent" }
  | { outcome: "skipped_no_api_key" }
  | { outcome: "failed"; error: string };

/**
 * Claims the idempotency key, sends if (and only if) the claim is new, and
 * always logs the attempt once a claim is held. Never sends twice for the
 * same key, even under two overlapping callers (the claim's own unique
 * constraint is the race-safe gate - see 0092).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SupabaseClient's generic Database param varies by caller; this function only ever calls two narrow RPCs by name.
export async function sendNotification(supabase: SupabaseClient<any>, input: SendNotificationInput): Promise<SendNotificationResult> {
  // Checked BEFORE claiming, not after: notification_claims (0092) is a
  // one-time-only token, same as sent_deadline_reminders already was -
  // claiming it without a real send would permanently waste it, so once
  // RESEND_API_KEY is finally set, this exact notification could never be
  // sent at all (send-deadline-reminders.ts's own established rule for the
  // identical situation - see that script's header comment).
  if (!resendApiKeyConfigured()) {
    console.log(`RESEND_API_KEY not set - not sending or claiming ${input.idempotencyKey} this run (will retry once a key is added).`);
    return { outcome: "skipped_no_api_key" };
  }

  const { data: claimed, error: claimError } = await supabase.rpc("claim_notification", {
    p_idempotency_key: input.idempotencyKey,
    p_notification_type: input.notificationType,
  });
  if (claimError) {
    console.error(`claim_notification failed for ${input.idempotencyKey}`, claimError);
    return { outcome: "failed", error: claimError.message };
  }
  if (!claimed) {
    return { outcome: "already_sent" };
  }

  const result = await sendTransactionalEmail({
    to: input.to,
    subject: input.email.subject,
    html: input.email.html,
    text: input.email.text,
    from: input.senderProfile,
    attachments: input.email.attachments,
    headers: input.email.headers,
  });

  const { error: logError } = await supabase.rpc("record_notification_sent", {
    p_idempotency_key: input.idempotencyKey,
    p_notification_type: input.notificationType,
    p_recipient_email: input.to,
    p_company_id: input.companyId ?? null,
    p_tender_id: input.tenderId ?? null,
    p_subject: input.email.subject,
    p_status: result.status,
    p_resend_id: result.status === "sent" ? result.resendId : null,
    p_error: result.status === "failed" ? result.error : null,
  });
  if (logError) {
    // The send itself already happened (or was skipped) - a failed log
    // write must never be treated as a failed send, and must never trigger
    // a retry (that would double-send). Loud, not fatal.
    console.error(`record_notification_sent failed for ${input.idempotencyKey} (send itself: ${result.status})`, logError);
  }

  if (result.status === "sent") return { outcome: "sent", resendId: result.resendId };
  if (result.status === "skipped_no_api_key") return { outcome: "skipped_no_api_key" };
  return { outcome: "failed", error: result.error };
}
