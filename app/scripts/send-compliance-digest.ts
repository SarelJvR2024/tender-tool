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
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { complianceDigestEmail } from "../lib/emailTemplatesTier2.ts";
import { resendApiKeyConfigured, sendTransactionalEmail } from "../lib/resendEmail.ts";
import { operationalRecipients } from "../lib/notificationRecipients.ts";
import { complianceDigestCandidatesForCompany, complianceDigestIdempotencyKey, type ComplianceDigestCandidate } from "../lib/complianceDigestCandidates.ts";
import { parseSenderCliArgs, printDryRunTable, testIdempotencyKey, type DryRunRow } from "../lib/senderCliArgs.ts";

type ComplianceDigestCompanyOutcome = {
  claimedCount: number;
  sent: number;
  skippedNoRecipients: number; // 0 or 1, for this one company
  dryRunRow: DryRunRow | null;
};

/**
 * Processes ONE company's already-fetched compliance candidates: looks up
 * recipients, claims (real runs only), renders and sends. Split out from
 * main() so the ordering below is independently testable with a mocked
 * Supabase client - this exact ordering is the fix for a real bug found
 * 2026-11-07 (see the recipients-before-claim comment below).
 */
export async function processComplianceDigestForCompany(
  supabase: SupabaseClient,
  company: { id: string; legal_name: string | null },
  candidates: ComplianceDigestCandidate[],
  appUrl: string,
  opts: { dryRun: boolean; testRecipient: string | null },
): Promise<ComplianceDigestCompanyOutcome> {
  const { dryRun, testRecipient } = opts;
  const recipients = await operationalRecipients(supabase, company.id);
  const companyName = company.legal_name || "your company";

  // --dry-run never claims - every candidate is shown as if new.
  let claimedItems: ComplianceDigestCandidate[];
  if (dryRun) {
    claimedItems = candidates;
  } else {
    // Recipients looked up and checked BEFORE the one-time claim, not
    // after (standing review, 2026-11-07 - the same "claim a one-time-ever
    // token before something that can genuinely be empty" bug class
    // already fixed for scripts/send-deadline-reminders.ts/
    // send-operational-alerts.ts, 2026-11-06, under a different RPC name,
    // so that pass's own grep for claim_notification never found this one -
    // it was explicitly flagged and left alone that same pass, pending
    // this dedicated fix). Each candidate's threshold only matches ONE
    // exact day (daysLeft === 30/14/7, thresholdFor()'s own exact-match,
    // not a range) - claiming it for a company with zero opted-in
    // recipients right now would permanently waste THAT threshold's own
    // one-shot reminder, even once someone opts in before the document
    // actually expires (the later 14-/7-day thresholds, if any remain,
    // would still fire normally; only the missed one is lost for good).
    if (recipients.length === 0) {
      return { claimedCount: 0, sent: 0, skippedNoRecipients: 1, dryRunRow: null };
    }
    claimedItems = [];
    for (const candidate of candidates) {
      const idempotencyKey = complianceDigestIdempotencyKey(company.id, candidate.itemKey, candidate.threshold);
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
    if (claimedItems.length === 0) return { claimedCount: 0, sent: 0, skippedNoRecipients: 0, dryRunRow: null };
  }

  const { subject, html, text } = complianceDigestEmail({
    companyName,
    items: claimedItems.map((c) => c.item),
    appUrl,
  });

  if (dryRun) {
    return {
      claimedCount: 0,
      sent: 0,
      skippedNoRecipients: 0,
      dryRunRow: {
        companyName,
        companyId: company.id,
        recipients,
        targetItems: claimedItems.map((c) => c.item.label).join(", "),
        subject,
        status: recipients.length === 0 ? "Skipped (no opted-in recipients)" : "Simulated OK",
      },
    };
  }

  // recipients.length === 0 is already handled above, before the claim -
  // no second check needed here (and none would be safe to re-add: by this
  // point claimedItems may already be non-empty).
  let sent = 0;
  const sendTo = testRecipient ? [testRecipient] : recipients;
  for (const email of sendTo) {
    const result = await sendTransactionalEmail({ to: email, subject, html, text, from: "compliance" });
    if (result.status === "sent") sent++;
    else console.log(`  ${result.status} -> ${email} (company ${company.id})`);

    for (const candidate of claimedItems) {
      const realKey = complianceDigestIdempotencyKey(company.id, candidate.itemKey, candidate.threshold);
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

  return { claimedCount: claimedItems.length, sent, skippedNoRecipients: 0, dryRunRow: null };
}

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

    const outcome = await processComplianceDigestForCompany(
      supabase,
      { id: company.id as string, legal_name: (company.legal_name as string) ?? null },
      candidates,
      appUrl,
      { dryRun, testRecipient },
    );
    itemsClaimed += outcome.claimedCount;
    companiesSent += outcome.sent;
    skippedNoRecipients += outcome.skippedNoRecipients;
    if (outcome.dryRunRow) dryRunRows.push(outcome.dryRunRow);
  }

  if (dryRun) {
    printDryRunTable("Comprehensive Compliance Expiry Digest", dryRunRows);
    return;
  }

  console.log(`Compliance digest: ${itemsClaimed} item(s) claimed, ${companiesSent} email send attempt(s), ${skippedNoRecipients} company(ies) skipped (no opted-in recipients).`);
}

// Only runs main() when this file is executed directly, not when a test
// file imports processComplianceDigestForCompany() above - same guard
// scripts/send-deadline-reminders.ts already established, 2026-11-06.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("send-compliance-digest failed", e);
    process.exit(1);
  });
}
