#!/usr/bin/env node
// Tier 1 - Buyer Corrigenda / Addenda Alert (notification engine migration
// brief, 2026-10-27). Wires the orphaned corrigendumAlertEmail() template
// (lib/emailTemplatesTier1.ts) - it existed, with a header comment already
// describing the intended data source, but no sender script ever called it.
// The "legacy" mechanism this replaces: the Claude-scheduled "Tender
// update/addendum watch" check-in running engine/discovery/watch_tender_updates.py
// and e-mailing a plain-text report via a Gmail connector by hand.
//
// Deliberately does NOT re-implement that script's detection logic (reading
// eTenders/SANRAL, classifying documents, extracting closing/briefing-date
// changes) in TypeScript - that logic lives in engine/, already works, and
// duplicating it here would be the exact wrong-layer rebuild this project's
// own conventions warn against (see lib/savingsEstimateCalculator.ts's
// header for the same "one formula, checked once" principle applied
// elsewhere). Instead, this script reads what that Python watch already
// writes - tender_update_notifications (migration 0039/0048), one row per
// (company, newly-seen document) - and is purely the render-and-send half.
//
// Dedup: tender_update_notifications.alerted_at/digested_at serve the
// Python watch's OWN purposes (alerted_at = included in its own report;
// digested_at = carried by the Python daily digest) and are left untouched
// here. This script uses its own, independent claim via
// claim_notification() (migration 0093), keyed per (document, company,
// recipient) - safe to run on every row every time; a row already sent
// through this exact key is a no-op claim, not a re-send.
//
// Submission-suppression: tender_update_notifications.pipeline_stage is the
// stage AT THE TIME the update was found (denormalised by watch_tender_updates.py's
// own notify()). 'won'/'lost' are genuinely terminal - skipped. 'submitted'
// is deliberately NOT suppressed: watch_tender_updates.py's own header
// comment is explicit that an addendum before closing can still require a
// resubmission even after a company has submitted, so stopping alerts at
// 'submitted' would reintroduce the exact gap this feature was built to
// close. (This app's real pipeline_stage enum - found/bidding/submitted/
// won/lost, migration 0021 - has no 'dispatched'/'awarded'/'declined'
// value; a literal filter against those strings would silently match
// nothing.)
//
// Run: node --experimental-strip-types scripts/send-corrigendum-alerts.ts
// Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
import { createClient } from "@supabase/supabase-js";
import { corrigendumAlertEmail } from "../lib/emailTemplatesTier1.ts";
import { sendTransactionalEmail } from "../lib/resendEmail.ts";
import { operationalRecipients } from "../lib/notificationRecipients.ts";
import { changesForDoc, isCorrigendumCandidate, type WatchedDocRow } from "../lib/corrigendumAlerts.ts";
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

  if (!dryRun && !process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set - not sending or claiming any corrigendum alert this run (will retry once a key is added).");
    return;
  }

  const supabase = createClient(url, serviceKey);

  // Bounded window, not the whole table's history: a notification row this
  // old has already been through every prior run's claim attempt, so
  // nothing new to find past this horizon - same reasoning
  // deadlineReminderCandidates() bounds its own tender read.
  const sinceIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  let query = supabase
    .from("tender_update_notifications")
    .select("company_id, watched_document_id, tender_id, pipeline_stage, created_at")
    .gte("created_at", sinceIso);
  if (scopeCompanyId) query = query.eq("company_id", scopeCompanyId);
  const { data: rows, error: rowsError } = await query;
  if (rowsError) {
    console.error("Could not read tender_update_notifications", rowsError);
    process.exit(1);
  }
  const candidates = (rows ?? []).filter(isCorrigendumCandidate);
  if (candidates.length === 0) {
    console.log("No corrigendum/addendum notifications in the last 14 days worth alerting on.");
    return;
  }

  const dryRunRows: DryRunRow[] = [];
  let sent = 0;
  let skippedAlreadySent = 0;
  let skippedNoRecipients = 0;

  for (const row of candidates) {
    const { data: doc, error: docError } = await supabase
      .from("tender_watched_documents")
      .select("id, kind, title, summary, changes")
      .eq("id", row.watched_document_id)
      .maybeSingle();
    if (docError || !doc) {
      console.error(`Could not read tender_watched_documents ${row.watched_document_id}`, docError);
      continue;
    }
    const { data: tender, error: tenderError } = await supabase
      .from("tenders")
      .select("id, contract_no, description, buyer")
      .eq("id", row.tender_id)
      .maybeSingle();
    if (tenderError || !tender) {
      console.error(`Could not read tender ${row.tender_id}`, tenderError);
      continue;
    }
    const { data: company } = await supabase.from("companies").select("legal_name").eq("id", row.company_id).maybeSingle();

    const recipients = await operationalRecipients(supabase, row.company_id);
    const companyName = company?.legal_name || "your company";

    const { subject, html, text } = corrigendumAlertEmail({
      reference: tender.contract_no || tender.id,
      tenderTitle: tender.description,
      buyerShortName: tender.buyer || "the buyer",
      companyName,
      changes: changesForDoc(doc as WatchedDocRow),
      appUrl,
      tenderId: tender.id,
    });

    if (dryRun) {
      dryRunRows.push({
        companyName,
        companyId: row.company_id,
        recipients,
        targetItems: tender.contract_no || tender.id,
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
      const realKey = `corrigendum-${row.watched_document_id}-${row.company_id}-${email}`;
      const idempotencyKey = testRecipient ? testIdempotencyKey(realKey) : realKey;
      const { data: claimed, error: claimError } = await supabase.rpc("claim_notification", {
        p_idempotency_key: idempotencyKey,
        p_notification_type: "corrigendum_alert",
      });
      if (claimError) {
        console.error(`claim_notification failed for ${idempotencyKey}`, claimError);
        continue;
      }
      if (!claimed) {
        skippedAlreadySent++;
        continue;
      }

      const result = await sendTransactionalEmail({ to: email, subject, html, text, from: "ops" });
      if (result.status === "sent") sent++;
      else console.log(`  ${result.status} -> ${email} (${tender.contract_no ?? tender.id})`);

      const { error: logError } = await supabase.rpc("record_notification_sent", {
        p_idempotency_key: idempotencyKey,
        p_notification_type: "corrigendum_alert",
        p_recipient_email: email,
        p_company_id: row.company_id,
        p_tender_id: tender.id,
        p_subject: subject,
        p_status: result.status,
        p_resend_id: result.status === "sent" ? result.resendId : null,
        p_error: result.status === "failed" ? result.error : null,
      });
      if (logError) console.error("record_notification_sent failed for corrigendum_alert", logError);
    }
  }

  if (dryRun) {
    printDryRunTable("Corrigenda / Addenda Alerts", dryRunRows);
    return;
  }

  console.log(`Corrigendum alerts: ${sent} sent, ${skippedAlreadySent} already sent before, ${skippedNoRecipients} skipped (no opted-in recipients).`);
}

main();
