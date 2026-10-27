#!/usr/bin/env node
// Tier 2 - Comprehensive Compliance Expiry Digest (notification engine
// migration brief, 2026-10-27). Wires the orphaned complianceDigestEmail()
// template (lib/emailTemplatesTier2.ts) against lib/complianceDigestCandidates.ts -
// SARS Tax PIN, COID Letter of Good Standing, B-BBEE proof, CIDB
// registration, catalog/property registrations, and per-person ECSA/
// SACPCMP, all at 30/14/7-day thresholds. CSD registration is deliberately
// not included - see complianceDigestCandidates.ts's own header for why
// (no expiry field exists anywhere in this schema for it).
//
// Scope note vs the old Claude-scheduled "Compliance deadline reminder
// check-in" (engine/compliance/watch_deadlines.py): that script's
// `documents_before_closing` category (a document that will have lapsed by
// a SPECIFIC tender's own closing date, not a flat 30/14/7-day calendar
// threshold) and generic tender `tasks` reminders are a different shape of
// fact entirely - not covered here, and not claimed to be. See this
// migration's own tracking notes before disabling that Claude trigger.
//
// Run: node --experimental-strip-types scripts/send-compliance-digest.ts
// Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
import { createClient } from "@supabase/supabase-js";
import { complianceDigestEmail } from "../lib/emailTemplatesTier2.ts";
import { resendApiKeyConfigured, sendTransactionalEmail } from "../lib/resendEmail.ts";
import { operationalRecipients } from "../lib/notificationRecipients.ts";
import { complianceDigestCandidatesForCompany, complianceDigestIdempotencyKey } from "../lib/complianceDigestCandidates.ts";
import { parseSenderCliArgs, printDryRunTable, testIdempotencyKey, type DryRunRow } from "../lib/senderCliArgs.ts";

async function main() {
  const { dryRun, companyId: scopeCompanyId, testRecipient } = parseSenderCliArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
    process.exit(1);
  }
  const appUrl = process.env.APP_URL || "https://tender-ready.vercel.app";
  const supabase = createClient(url, serviceKey);

  let companiesQuery = supabase.from("companies").select("id, legal_name");
  if (scopeCompanyId) companiesQuery = companiesQuery.eq("id", scopeCompanyId);
  const { data: companies, error: companiesError } = await companiesQuery;
  if (companiesError) {
    console.error("Could not read companies", companiesError);
    process.exit(1);
  }

  if (!dryRun && !resendApiKeyConfigured()) {
    console.log("RESEND_API_KEY not set - not sending or claiming any compliance-digest item this run (will retry once a key is added).");
    return;
  }

  const dryRunRows: DryRunRow[] = [];
  let companiesSent = 0;
  let skippedNoRecipients = 0;
  let itemsClaimed = 0;

  for (const company of companies ?? []) {
    const candidates = await complianceDigestCandidatesForCompany(supabase, company.id as string);
    if (candidates.length === 0) continue;

    // --dry-run never claims - every candidate is shown as if new.
    let claimedItems: typeof candidates;
    if (dryRun) {
      claimedItems = candidates;
    } else {
      claimedItems = [];
      for (const candidate of candidates) {
        const idempotencyKey = complianceDigestIdempotencyKey(company.id as string, candidate.itemKey, candidate.threshold);
        const { data: ok, error: claimError } = await supabase.rpc("claim_notification", {
          p_idempotency_key: idempotencyKey,
          p_notification_type: "compliance_expiry",
        });
        if (claimError) {
          console.error(`claim_notification failed for ${idempotencyKey}`, claimError);
          continue;
        }
        if (ok) claimedItems.push(candidate);
      }
      if (claimedItems.length === 0) continue;
      itemsClaimed += claimedItems.length;
    }

    const recipients = await operationalRecipients(supabase, company.id as string);
    const companyName = (company.legal_name as string) || "your company";

    const { subject, html, text } = complianceDigestEmail({
      companyName,
      items: claimedItems.map((c) => c.item),
      appUrl,
    });

    if (dryRun) {
      dryRunRows.push({
        companyName,
        companyId: company.id as string,
        recipients,
        targetItems: claimedItems.map((c) => c.item.label).join(", "),
        subject,
        status: recipients.length === 0 ? "Skipped (no opted-in recipients)" : "Simulated OK",
      });
      continue;
    }

    if (recipients.length === 0) {
      skippedNoRecipients++;
      continue;
    }

    const sendTo = testRecipient ? [testRecipient] : recipients;
    for (const email of sendTo) {
      const result = await sendTransactionalEmail({ to: email, subject, html, text, from: "compliance" });
      if (result.status === "sent") companiesSent++;
      else console.log(`  ${result.status} -> ${email} (company ${company.id})`);

      for (const candidate of claimedItems) {
        const realKey = complianceDigestIdempotencyKey(company.id as string, candidate.itemKey, candidate.threshold);
        const idempotencyKey = testRecipient ? testIdempotencyKey(realKey) : realKey;
        const { error: logError } = await supabase.rpc("record_notification_sent", {
          p_idempotency_key: idempotencyKey,
          p_notification_type: "compliance_expiry",
          p_recipient_email: email,
          p_company_id: company.id,
          p_tender_id: null,
          p_subject: subject,
          p_status: result.status,
          p_resend_id: result.status === "sent" ? result.resendId : null,
          p_error: result.status === "failed" ? result.error : null,
        });
        if (logError) console.error(`record_notification_sent failed for compliance_expiry (${idempotencyKey})`, logError);
      }
    }
  }

  if (dryRun) {
    printDryRunTable("Comprehensive Compliance Expiry Digest", dryRunRows);
    return;
  }

  console.log(`Compliance digest: ${itemsClaimed} item(s) claimed, ${companiesSent} email send attempt(s), ${skippedNoRecipients} company(ies) skipped (no opted-in recipients).`);
}

main();
