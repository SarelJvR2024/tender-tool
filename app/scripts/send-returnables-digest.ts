#!/usr/bin/env node
// "Pack Incomplete / Returnables Checklist" digest - Sarel's own explicit
// Phase 6 spec (2026-10-27): once a tracked tender enters the 3-5 BUSINESS
// day window before closing, and at least one MANDATORY returnable is
// missing, expired or unverified, send ONE nudge naming exactly what's
// outstanding. See lib/returnablesDigestCandidates.ts for what "mandatory"
// and "missing" honestly mean per tender family - this script only wires
// that pure/async logic to Resend + the idempotency/log engine.
//
// A STANDALONE SCRIPT, not a Next.js route - same reasoning every other
// cron sender here gives (scripts/send-deadline-reminders.ts's own header):
// this job needs to read every company's tracked tenders and company vault
// data in one run, which needs the Supabase SERVICE ROLE key, and the
// deployed app itself never holds that key.
//
// Idempotency: claim_notification()/record_notification_sent() (migration
// 0093) - the GENERALISED engine every notification type since Tier 0-3
// uses, not a new one-off claim table (that migration's own header warns
// against exactly that). Key is `returnables-digest-<tender>-<company>`
// with NO date component: this fires at most ONCE EVER per tender/company
// pair, the same "once per real threshold crossed, never re-sent for the
// same state" rule record_deadline_reminder_sent's own per-threshold claim
// already uses - Sarel's own "does not spam... for the same tender state"
// requirement, met by never re-sending at all for one tender/company once
// sent, rather than a time-based re-send window that could still double up.
//
// Run: node --experimental-strip-types scripts/send-returnables-digest.ts
// Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
import { createClient } from "@supabase/supabase-js";
import { formatDate } from "../lib/dates.ts";
import { businessDaysBetween } from "../lib/publicHolidays.ts";
import { returnablesWindowCandidates, returnablesMissingMandatoryItems, type ReturnablesWindowTenderRow } from "../lib/returnablesDigestCandidates.ts";
import { returnablesDigestEmail } from "../lib/emailTemplates.ts";
import { sendTransactionalEmail } from "../lib/resendEmail.ts";
import { operationalRecipients } from "../lib/notificationRecipients.ts";

const NOTIFICATION_TYPE = "returnables_digest";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
    process.exit(1);
  }
  const appUrl = process.env.APP_URL || "https://tender-ready.vercel.app";

  // Same rule as every other sender here (deadline-reminders.ts's own
  // comment): without a real key, exit clean having claimed NOTHING - a
  // claim without a real send would permanently waste this tender/
  // company's one-shot idempotency key.
  if (!process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set - not sending or claiming anything this run (will retry once a key is added).");
    return;
  }

  const supabase = createClient(url, serviceKey);
  const todayStr = new Date().toISOString().slice(0, 10);

  const { data: tenderRows, error: tenderError } = await supabase
    .from("tenders")
    .select("id, contract_no, description, title, closing_date, family, document_requirements, tender_packs!inner(company_id)")
    .not("closing_date", "is", null);
  if (tenderError) {
    console.error("Could not read tenders", tenderError);
    process.exit(1);
  }

  const candidates = returnablesWindowCandidates((tenderRows ?? []) as unknown as ReturnablesWindowTenderRow[], todayStr, businessDaysBetween);

  if (candidates.length === 0) {
    console.log("No tenders at the 3-5 business day returnables-digest window today.");
    return;
  }

  let sent = 0;
  let skippedNotMapped = 0;
  let skippedNothingMissing = 0;
  let skippedAlreadyClaimed = 0;
  let skippedNoOptedInMembers = 0;

  for (const { tender, companyId, businessDaysLeft } of candidates) {
    const result = await returnablesMissingMandatoryItems(supabase, tender, companyId);
    if (!result.mapped) {
      skippedNotMapped++;
      continue;
    }
    if (result.missingLabels.length === 0) {
      skippedNothingMissing++;
      continue;
    }

    const idempotencyKey = `returnables-digest-${tender.id}-${companyId}`;
    const { data: claimed, error: claimError } = await supabase.rpc("claim_notification", {
      p_idempotency_key: idempotencyKey,
      p_notification_type: NOTIFICATION_TYPE,
    });
    if (claimError) {
      console.error(`claim_notification failed for tender ${tender.id}, company ${companyId}`, claimError);
      continue;
    }
    if (!claimed) {
      skippedAlreadyClaimed++;
      continue;
    }

    const recipients = await operationalRecipients(supabase, companyId);
    if (recipients.length === 0) {
      skippedNoOptedInMembers++;
      continue;
    }

    const contractLabel = tender.contract_no || tender.title || tender.description || "Tender";
    const { subject, html, text } = returnablesDigestEmail({
      contractLabel,
      tenderTitle: tender.title,
      closingDateText: formatDate(tender.closing_date) ?? tender.closing_date!,
      businessDaysLeft,
      missingLabels: result.missingLabels,
      appUrl,
      tenderId: tender.id,
      workspaceAnchor: result.workspaceAnchor,
    });

    for (const email of recipients) {
      const sendResult = await sendTransactionalEmail({ to: email, subject, html, text });
      if (sendResult.status === "sent") sent++;
      else console.log(`  ${sendResult.status} -> ${email} (${contractLabel})`);
      const { error: logError } = await supabase.rpc("record_notification_sent", {
        p_idempotency_key: idempotencyKey,
        p_notification_type: NOTIFICATION_TYPE,
        p_recipient_email: email,
        p_company_id: companyId,
        p_tender_id: tender.id,
        p_subject: subject,
        p_status: sendResult.status,
        p_resend_id: sendResult.status === "sent" ? sendResult.resendId : null,
        p_error: sendResult.status === "failed" ? sendResult.error : null,
      });
      if (logError) console.error("record_notification_sent failed for returnables_digest", logError);
    }
  }

  console.log(
    `Returnables digest: ${sent} sent, ${skippedNotMapped} not mapped for this family yet, ${skippedNothingMissing} with nothing mandatory missing, ` +
      `${skippedAlreadyClaimed} already sent for this tender/company, ${skippedNoOptedInMembers} with no opted-in member, out of ${candidates.length} candidate tender/company pair(s).`
  );
}

main().catch((e) => {
  console.error("send-returnables-digest failed", e);
  process.exit(1);
});
