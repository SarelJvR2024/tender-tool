// Thin wrapper over the `resend` npm package (server-side only - never
// imported into a "use client" component). Framework-agnostic: no Next.js
// import, so scripts/send-deadline-reminders.ts (a standalone script, not
// part of the deployed Next.js app) can import it directly too, alongside
// the welcome-email Server Action.
//
// No RESEND_API_KEY yet (confirmed by grep before writing this - an
// earlier audit found no smtplib/sendgrid/resend/nodemailer call anywhere
// in app/, only the opt-in flag existing): sendTransactionalEmail() reads
// it at call time and, when unset, logs a clear message and returns
// without sending or throwing - the rest of the app (billing, everything
// else) keeps working while this one piece waits on a real key. Mirrors
// engine/notify/send_digest_emails.py's own "never crash, never pretend to
// have sent anything" rule for the exact same situation.
import { Resend } from "resend";

const DEFAULT_FROM = "Tender Ready <onboarding@resend.dev>";

// Operational Notification Engine (Batch: Resend sender addresses, Sarel's
// own brief): bid-deadline/print-cutoff mail reads as coming from "the bids
// desk", compliance-expiry mail from "the compliance desk" - two different
// senders a recipient can filter/trust independently, same reasoning a real
// ops team splits these inboxes. Both fall back to RESEND_FROM_ADDRESS (or
// the single onboarding@resend.dev default) until the real tenderready.app
// domain is verified with Resend and these two env vars are set - so this
// never crashes or silently uses the wrong address, it just degrades to the
// one address every other email already used.
export type EmailCategory = "bids" | "compliance";

function fromFor(category?: EmailCategory): string {
  if (category === "bids") return process.env.RESEND_FROM_BIDS || process.env.RESEND_FROM_ADDRESS || "Tender Ready Bids <bids@tenderready.app>";
  if (category === "compliance") return process.env.RESEND_FROM_COMPLIANCE || process.env.RESEND_FROM_ADDRESS || "Tender Ready Compliance <compliance@tenderready.app>";
  return process.env.RESEND_FROM_ADDRESS || DEFAULT_FROM;
}

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Picks the from-address (bids@ / compliance@); omit for the existing single-address emails (welcome, closing-soon). */
  category?: EmailCategory;
};

export type SendEmailResult = { status: "sent" } | { status: "skipped_no_api_key" } | { status: "failed"; error: string };

export async function sendTransactionalEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`RESEND_API_KEY not set - email not sent (to: ${input.to}, subject: "${input.subject}").`);
    return { status: "skipped_no_api_key" };
  }

  const from = fromFor(input.category);
  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    if (error) {
      console.error("Resend rejected the send", error);
      return { status: "failed", error: error.message ?? String(error) };
    }
    return { status: "sent" };
  } catch (e) {
    console.error("Could not send email via Resend", e);
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}
