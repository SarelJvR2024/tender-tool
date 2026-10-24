// Thin wrapper over the `resend` npm package (server-side only - never
// imported into a "use client" component). Framework-agnostic: no Next.js
// import, so scripts/send-deadline-reminders.ts (a standalone script, not
// part of the deployed Next.js app) can import it directly too, alongside
// the welcome-email Server Action and every lib/notificationEngine.ts
// caller.
//
// sendTransactionalEmail() reads RESEND_API_KEY at call time and, when
// unset, logs a clear message and returns without sending or throwing -
// the rest of the app (billing, everything else) keeps working while this
// one piece waits on a real key. Mirrors engine/notify/send_digest_emails.py's
// own "never crash, never pretend to have sent anything" rule for the exact
// same situation.
//
// Sender profiles (notification engine brief, section 1.2): routing
// different notification categories from different sub-addresses so a
// recipient's own mail rules can separate them, all replying to one
// support inbox. Real values (Sarel, 2026-10-24, set as GitHub Actions +
// Vercel env vars):
//   RESEND_FROM_ADDRESS     - Tier 0 (general/onboarding/welcome/trial) -
//                             ALSO this file's pre-existing single-sender
//                             default, so a caller that passes no profile
//                             at all (the "system" profile) keeps using
//                             exactly this var, unchanged from before this
//                             file had profiles.
//   RESEND_FROM_BIDS        - Tier 1 (live tender alerts, briefings, cutoffs)
//   RESEND_FROM_COMPLIANCE  - Tier 2 (CSD/SARS/COIDA/CIDB expiry)
//   RESEND_FROM_SCOUT       - Tier 3 (system health / Quality Scout, to admin)
//   RESEND_REPLY_TO         - support@tenderready.app, every tier
// Each is independently optional - an unset one falls back to this file's
// own hardcoded default address below, so a partially-configured
// environment degrades per-tier rather than failing every send.
import { Resend } from "resend";

const DEFAULT_FROM = "Tender Ready <onboarding@resend.dev>";
const DEFAULT_REPLY_TO = "support@tenderready.app";

export type SenderProfile = "system" | "ops" | "compliance" | "scout";

const SENDER_PROFILE_DEFAULTS: Record<SenderProfile, string> = {
  system: DEFAULT_FROM,
  ops: "Tender Ready Bids <bids@tenderready.app>",
  compliance: "Tender Ready Compliance <compliance@tenderready.app>",
  scout: "Quality Scout <scout@tenderready.app>",
};

// One env var per profile, each resolved independently - no single var
// overrides every profile at once any more (an earlier version of this
// file had RESEND_FROM_ADDRESS do exactly that, for "the domain isn't
// verified yet, route everything through one working address" testing -
// but Sarel has now set 4 DIFFERENT real addresses, one per tier, so a
// blanket override would silently route Tier 1/2/3 mail through the Tier 0
// address instead of their own. If every tier ever does need to collapse
// onto one address again, unset the other 3 and only RESEND_FROM_ADDRESS
// will be live.
const SENDER_PROFILE_ENV_VAR: Record<SenderProfile, string> = {
  system: "RESEND_FROM_ADDRESS",
  ops: "RESEND_FROM_BIDS",
  compliance: "RESEND_FROM_COMPLIANCE",
  scout: "RESEND_FROM_SCOUT",
};

function resolveFromAddress(profile: SenderProfile): string {
  const envValue = process.env[SENDER_PROFILE_ENV_VAR[profile]];
  return envValue || SENDER_PROFILE_DEFAULTS[profile];
}

/** Whether a send would actually go out right now. notificationEngine.ts checks this BEFORE claiming an idempotency key - see its own comment on why claiming without a real send would permanently waste a one-time claim (same rule send-deadline-reminders.ts already follows for the same reason). */
export function resendApiKeyConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/** Sarel's own inbox for Tier 3 (founder digest, Quality Scout anomaly alerts) - set as ADMIN_NOTIFICATION_EMAIL (2026-10-24). Null, not a guessed fallback, when unset - a Tier 3 sender script must treat that as "nowhere to send this yet" and skip cleanly, never silently drop it onto some other address. */
export function adminNotificationEmail(): string | null {
  return process.env.ADMIN_NOTIFICATION_EMAIL || null;
}

export type EmailAttachment = { filename: string; content: string };

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Which sender sub-address this notification is routed from. Defaults to "system" (the pre-existing single-sender behaviour) - every Tier 1/2/3 caller should pass its own tier's profile. */
  from?: SenderProfile;
  /** Overrides the default support@tenderready.app reply-to for this one send, if a notification ever needs a different one. */
  replyTo?: string;
  attachments?: EmailAttachment[];
};

export type SendEmailResult = { status: "sent"; resendId: string } | { status: "skipped_no_api_key" } | { status: "failed"; error: string };

export async function sendTransactionalEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`RESEND_API_KEY not set - email not sent (to: ${input.to}, subject: "${input.subject}").`);
    return { status: "skipped_no_api_key" };
  }

  const from = resolveFromAddress(input.from ?? "system");
  const replyTo = input.replyTo ?? process.env.RESEND_REPLY_TO ?? DEFAULT_REPLY_TO;
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: input.to,
      replyTo,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments,
    });
    if (error) {
      console.error("Resend rejected the send", error);
      return { status: "failed", error: error.message ?? String(error) };
    }
    return { status: "sent", resendId: data?.id ?? "" };
  } catch (e) {
    console.error("Could not send email via Resend", e);
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}
