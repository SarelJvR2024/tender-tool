#!/usr/bin/env node
// One-off isolated Resend verification for templates with zero live
// candidates right now (compliance digest, corrigendum alert,
// clarification window). Realistic SAMPLE data only - no real company or
// tender rows are read or touched. Logged to notification_logs under a
// test-sample- prefixed idempotency key (via claim_notification) so it's
// visible in /admin/notifications for inspection, but can never collide
// with a real notification's own claim.
//
// Run: node --experimental-strip-types scripts/send-test-samples.ts --to <email>
import { createClient } from "@supabase/supabase-js";
import { complianceDigestEmail, SARS_PIN_RISK_NOTE } from "../lib/emailTemplatesTier2.ts";
import { corrigendumAlertEmail, clarificationWindowReminderEmail, packReadyEmail } from "../lib/emailTemplatesTier1.ts";
import { sendTransactionalEmail } from "../lib/resendEmail.ts";

const APP_URL = "https://tenderready.app";

async function main() {
  const toIdx = process.argv.indexOf("--to");
  const to = toIdx >= 0 ? process.argv[toIdx + 1] : null;
  if (!to) {
    console.error("Usage: send-test-samples.ts --to <email>");
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = url && serviceKey ? createClient(url, serviceKey) : null;

  const samples = [
    {
      name: "compliance_expiry",
      from: "compliance" as const,
      email: complianceDigestEmail({
        companyName: "Reviewer Civils (Pty) Ltd",
        items: [
          { label: "SARS Tax Compliance PIN", expiryDate: "2026-11-10", daysLeft: 14, href: "/company", riskNote: SARS_PIN_RISK_NOTE },
          { label: "CIDB Grade 6GB", expiryDate: "2026-12-08", daysLeft: 30, href: "/company/registrations" },
          { label: "ECSA registration - Jane Smith", expiryDate: "2026-11-03", daysLeft: 7, href: "/people/sample-id" },
        ],
        appUrl: APP_URL,
      }),
    },
    {
      name: "corrigendum_alert",
      from: "ops" as const,
      email: corrigendumAlertEmail({
        reference: "N.007-030-2026/1F",
        tenderTitle: "Rehabilitation of N2 Section 7",
        buyerShortName: "SANRAL",
        companyName: "Reviewer Civils (Pty) Ltd",
        changes: [{ kind: "closing_date", date: "2026-12-05", previousDate: "2026-11-21", quote: "the closing date has been extended" }],
        appUrl: APP_URL,
        tenderId: "sample-tender-id",
      }),
    },
    {
      name: "clarification_window",
      from: "ops" as const,
      email: clarificationWindowReminderEmail({
        reference: "N.007-030-2026/1F",
        tenderTitle: "Rehabilitation of N2 Section 7",
        buyerShortName: "SANRAL",
        taskDescription: "Submit clarification questions on specification ambiguity",
        dueDate: "2026-11-05",
        daysLeft: 10,
        appUrl: APP_URL,
        tenderId: "sample-tender-id",
      }),
    },
    {
      name: "pack_ready",
      from: "ops" as const,
      email: packReadyEmail({
        reference: "N.007-030-2026/1F",
        tenderTitle: "Rehabilitation of N2 Section 7",
        buyerShortName: "SANRAL",
        companyName: "Reviewer Civils (Pty) Ltd",
        pageCount: 42,
        appUrl: APP_URL,
        tenderId: "sample-tender-id",
      }),
    },
  ];

  for (const sample of samples) {
    const result = await sendTransactionalEmail({ to, subject: sample.email.subject, html: sample.email.html, text: sample.email.text, from: sample.from });
    console.log(`${sample.name}: ${result.status}${result.status === "sent" ? ` (resend id ${result.resendId})` : ""}`);
    if (supabase) {
      const idempotencyKey = `test-sample-${sample.name}-${Date.now()}`;
      await supabase.rpc("claim_notification", { p_idempotency_key: idempotencyKey, p_notification_type: sample.name });
      await supabase.rpc("record_notification_sent", {
        p_idempotency_key: idempotencyKey,
        p_notification_type: sample.name,
        p_recipient_email: to,
        p_company_id: null,
        p_tender_id: null,
        p_subject: sample.email.subject,
        p_status: result.status,
        p_resend_id: result.status === "sent" ? result.resendId : null,
        p_error: result.status === "failed" ? result.error : null,
      });
    }
  }
}

main();
