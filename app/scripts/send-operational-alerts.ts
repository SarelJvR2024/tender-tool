#!/usr/bin/env node
// Operational Notification Engine (Sarel's own brief) - 2 of the original 3
// critical operational alerts beyond the existing "closing in 3 days/24
// hours" reminder (scripts/send-deadline-reminders.ts, left untouched):
//   1. Print & transit cutoff - 48 hours before a physical-box submission's
//      real operational deadline (lib/dispatchTriage.ts's own
//      printSignDeadline(): closing time minus the tender's own print +
//      transit hour estimates).
//   2. Briefing session countdown - 5 days and 24 hours before
//      tenders.briefing_date.
//   3. Clarification window expiry - 10 days and 2 days ("48h", the
//      closest honest equivalent on a date-only column) before a
//      tender_tasks row of kind='clarification' is due. Added 2026-10-27 -
//      notification engine migration, item A4. This schema has no
//      auto-extracted question-cutoff date anywhere, so coverage is
//      limited to tenders where a person has manually added this task -
//      see lib/clarificationWindowReminders.ts's own header.
//
// Compliance-document expiry (originally a 3rd stage here: SARS PIN/COID
// only, 14 days) was REMOVED 2026-10-27 - notification engine migration -
// once scripts/send-compliance-digest.ts started covering those same 2
// fields (plus B-BBEE/CIDB/registrations/ECSA/SACPCMP, at 30/14/7 days).
// Keeping both would have double-emailed every company about the same
// SARS PIN/COID expiry from two different scripts with two different
// idempotency-key formats - notification_claims' uniqueness can't catch
// that, since the keys genuinely differ. lib/complianceExpiryReminders.ts
// and emailTemplates.ts's complianceExpiryEmail() are now unused by any
// live sender - left in place (still tested, harmless) rather than deleted
// as part of an unrelated cleanup; a candidate for a future dead-code pass.
//
// Same architecture as scripts/send-deadline-reminders.ts, on purpose - one
// standalone script (not a Next.js route: needs the Supabase SERVICE ROLE
// key, which the deployed app never holds - see that script's own header
// comment), run by .github/workflows/operational-alerts.yml. The 2
// remaining triggers are scaffolded as one script with one schedule rather
// than two nearly-identical ones: they share the same Supabase setup and
// Resend transport, and each still dedupes and fails independently (one
// stage's error doesn't stop the other - see runStage() below).
//
// Run: node --experimental-strip-types scripts/send-operational-alerts.ts
// Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
// (missing RESEND_API_KEY: every stage exits early and claims nothing, same
// rule as send-deadline-reminders.ts - a dedupe claim is one-time-only, so
// claiming it without actually sending would permanently waste it).
//
// Recipient emails resolved via lib/notificationRecipients.ts's
// operationalRecipients() (company_notification_recipients() RPC, migration
// 0094/0095) - NOT company_member_labels() (0033), which this script called
// until 2026-10-24: that RPC gates on auth.uid(), NULL for this script's
// service-role caller, so it silently returned zero rows every run - this
// script was very likely sending nobody an operational alert since PR #144
// merged. Real bug, found while wiring Tier 0/3 (PR #147), fixed here same
// day Sarel asked for it - see docs/specs/System-Status.md.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { daysUntil } from "../lib/dates.ts";
import { printCutoffCandidates, type PrintCutoffTenderPackRow, type PrintCutoffTenderRow } from "../lib/printCutoffReminders.ts";
import { briefingReminderCandidates, type BriefingReminderTenderRow } from "../lib/briefingReminders.ts";
import { clarificationWindowCandidates, type ClarificationTaskRow } from "../lib/clarificationWindowReminders.ts";
import { printCutoffEmail, briefingReminderEmail } from "../lib/emailTemplates.ts";
import { clarificationWindowReminderEmail } from "../lib/emailTemplatesTier1.ts";
import { sendTransactionalEmail } from "../lib/resendEmail.ts";
import { printSignDeadline } from "../lib/dispatchTriage.ts";
import { operationalRecipients as companyRecipients } from "../lib/notificationRecipients.ts";
import { parseSenderCliArgs, printDryRunTable, type DryRunRow } from "../lib/senderCliArgs.ts";

type SupabaseService = SupabaseClient;

type RunOpts = { dryRun: boolean; scopeCompanyId: string | null; testRecipient: string | null };

/** Audit-log write for /admin/notifications (the unified Tier 0-3 dispatch log) - record_notification_sent() (migration 0093) is a plain, no-constraint audit insert, deliberately decoupled from this script's own record_operational_alert_sent()/notification_claims dedupe, so this can be added without touching that dedupe flow at all. */
async function logSend(
  supabase: SupabaseService,
  notificationType: string,
  idempotencyKey: string,
  to: string,
  companyId: string,
  tenderId: string | null,
  subject: string,
  result: Awaited<ReturnType<typeof sendTransactionalEmail>>,
) {
  const { error } = await supabase.rpc("record_notification_sent", {
    p_idempotency_key: idempotencyKey,
    p_notification_type: notificationType,
    p_recipient_email: to,
    p_company_id: companyId,
    p_tender_id: tenderId,
    p_subject: subject,
    p_status: result.status,
    p_resend_id: result.status === "sent" ? result.resendId : null,
    p_error: result.status === "failed" ? result.error : null,
  });
  if (error) console.error(`record_notification_sent failed for ${notificationType}`, error);
}

async function companyName(supabase: SupabaseService, companyId: string): Promise<string> {
  const { data } = await supabase.from("companies").select("legal_name").eq("id", companyId).maybeSingle();
  return data?.legal_name || "your company";
}

async function claim(supabase: SupabaseService, alertType: string, tenderId: string | null, companyId: string, thresholdKey: string, opts: RunOpts): Promise<boolean> {
  // --dry-run never claims - the whole point is leaving every real future
  // send untouched; the caller treats a dry run as "always claimed" so
  // every candidate shows up for review. A --test-recipient send still
  // claims for real, but under a test-prefixed threshold key so it can
  // never collide with (and burn) the real one-time claim.
  if (opts.dryRun) return true;
  const key = opts.testRecipient ? `test-${thresholdKey}` : thresholdKey;
  const { data: claimed, error } = await supabase.rpc("record_operational_alert_sent", {
    p_alert_type: alertType,
    p_tender_id: tenderId,
    p_company_id: companyId,
    p_threshold_key: key,
  });
  if (error) {
    console.error(`record_operational_alert_sent failed (${alertType}, tender ${tenderId}, company ${companyId}, ${key})`, error);
    return false;
  }
  return !!claimed;
}

async function runPrintCutoff(supabase: SupabaseService, appUrl: string, opts: RunOpts, dryRunRows: DryRunRow[]): Promise<{ sent: number; candidates: number }> {
  let query = supabase
    .from("tender_packs")
    .select("id, tender_id, company_id, pipeline_stage, submission_type, estimated_print_hours, estimated_transit_hours, dispatch_status, tenders(id, contract_no, description, closing_date)")
    .eq("submission_type", "physical_box");
  if (opts.scopeCompanyId) query = query.eq("company_id", opts.scopeCompanyId);
  const { data: packRows, error } = await query;
  if (error) {
    console.error("print-cutoff: could not read tender_packs", error);
    return { sent: 0, candidates: 0 };
  }
  const packs: PrintCutoffTenderPackRow[] = [];
  const tendersById = new Map<string, PrintCutoffTenderRow>();
  for (const row of (packRows ?? []) as Record<string, unknown>[]) {
    const tender = row.tenders as PrintCutoffTenderRow | null;
    if (!tender) continue;
    tendersById.set(tender.id, tender);
    packs.push(row as unknown as PrintCutoffTenderPackRow);
  }
  const candidates = printCutoffCandidates(packs, tendersById);
  let sent = 0;
  for (const { pack, tender, hoursLeft } of candidates) {
    const firstClaim = await claim(supabase, "print_cutoff", tender.id, pack.company_id, "48h", opts);
    if (!firstClaim) continue;
    const recipients = await companyRecipients(supabase, pack.company_id);
    const deadline = printSignDeadline({
      closingDate: tender.closing_date,
      submissionType: pack.submission_type,
      estimatedPrintHours: pack.estimated_print_hours,
      estimatedTransitHours: pack.estimated_transit_hours,
      dispatchStatus: pack.dispatch_status,
    });
    if (!deadline) continue;
    const contractLabel = tender.contract_no || tender.description || "Tender";
    const { subject, html, text } = printCutoffEmail({ contractLabel, printSignDeadline: deadline.toISOString(), hoursLeft, appUrl, tenderId: tender.id });
    if (opts.dryRun) {
      dryRunRows.push({
        companyName: await companyName(supabase, pack.company_id), companyId: pack.company_id, recipients, targetItems: contractLabel, subject,
        status: recipients.length === 0 ? "Skipped (no opted-in recipients)" : "Simulated OK",
      });
      continue;
    }
    if (recipients.length === 0) continue;
    const sendTo = opts.testRecipient ? [opts.testRecipient] : recipients;
    for (const to of sendTo) {
      const result = await sendTransactionalEmail({ to, subject, html, text, category: "bids" });
      if (result.status === "sent") sent++;
      await logSend(supabase, "print_sign_cutoff", `${opts.testRecipient ? "test-" : ""}print-cutoff-${tender.id}-${pack.company_id}-${to}`, to, pack.company_id, tender.id, subject, result);
    }
  }
  return { sent, candidates: candidates.length };
}

async function runBriefingReminders(supabase: SupabaseService, appUrl: string, opts: RunOpts, dryRunRows: DryRunRow[]): Promise<{ sent: number; candidates: number }> {
  const { data: tenderRows, error } = await supabase
    .from("tenders")
    .select("id, contract_no, description, briefing_date, briefing_time, tender_packs!inner(company_id)")
    .not("briefing_date", "is", null);
  if (error) {
    console.error("briefing: could not read tenders", error);
    return { sent: 0, candidates: 0 };
  }
  let candidates = briefingReminderCandidates((tenderRows ?? []) as unknown as BriefingReminderTenderRow[], daysUntil);
  // --company-id post-filters here (no direct FK-friendly way to push this
  // into the query above without an extra join) - still safe: nothing is
  // claimed or sent for a filtered-out candidate, it's just discarded from
  // this in-memory list before any action is taken on it.
  if (opts.scopeCompanyId) candidates = candidates.filter((c) => c.companyId === opts.scopeCompanyId);
  let sent = 0;
  for (const { tender, companyId, daysLeft, threshold } of candidates) {
    const firstClaim = await claim(supabase, "briefing", tender.id, companyId, String(threshold), opts);
    if (!firstClaim) continue;
    const recipients = await companyRecipients(supabase, companyId);
    const contractLabel = tender.contract_no || tender.description || "Tender";
    const { subject, html, text } = briefingReminderEmail({
      contractLabel,
      briefingDate: tender.briefing_date!,
      briefingTime: tender.briefing_time,
      daysLeft,
      appUrl,
      tenderId: tender.id,
    });
    if (opts.dryRun) {
      dryRunRows.push({
        companyName: await companyName(supabase, companyId), companyId, recipients, targetItems: contractLabel, subject,
        status: recipients.length === 0 ? "Skipped (no opted-in recipients)" : "Simulated OK",
      });
      continue;
    }
    if (recipients.length === 0) continue;
    const sendTo = opts.testRecipient ? [opts.testRecipient] : recipients;
    for (const to of sendTo) {
      const result = await sendTransactionalEmail({ to, subject, html, text, category: "bids" });
      if (result.status === "sent") sent++;
      await logSend(supabase, "briefing_reminder", `${opts.testRecipient ? "test-" : ""}briefing-${tender.id}-${companyId}-${threshold}-${to}`, to, companyId, tender.id, subject, result);
    }
  }
  return { sent, candidates: candidates.length };
}

async function runClarificationWindow(supabase: SupabaseService, appUrl: string, opts: RunOpts, dryRunRows: DryRunRow[]): Promise<{ sent: number; candidates: number }> {
  let query = supabase
    .from("tender_tasks")
    .select("id, company_id, tender_id, description, due_date, status, kind, tenders(id, contract_no, description, buyer)")
    .eq("kind", "clarification")
    .not("due_date", "is", null);
  if (opts.scopeCompanyId) query = query.eq("company_id", opts.scopeCompanyId);
  const { data: taskRows, error } = await query;
  if (error) {
    console.error("clarification-window: could not read tender_tasks", error);
    return { sent: 0, candidates: 0 };
  }
  const tasks = (taskRows ?? []) as unknown as ClarificationTaskRow[];

  // tender_packs has no direct foreign key to tender_tasks (both
  // independently reference company_id+tender_id, so PostgREST can't
  // auto-embed across that) - a small up-front lookup, keyed the same way,
  // so clarificationWindowCandidates() can apply submission-suppression as
  // a pure, synchronous, independently-tested function rather than an
  // inline async check buried in this script.
  const stageByKey = new Map<string, string | null>();
  for (const task of tasks) {
    const key = `${task.company_id}:${task.tender_id}`;
    if (stageByKey.has(key)) continue;
    const { data: pack } = await supabase.from("tender_packs").select("pipeline_stage").eq("company_id", task.company_id).eq("tender_id", task.tender_id).maybeSingle();
    stageByKey.set(key, pack?.pipeline_stage ?? null);
  }

  const candidates = clarificationWindowCandidates(tasks, daysUntil, (task) => stageByKey.get(`${task.company_id}:${task.tender_id}`));
  let sent = 0;
  for (const { task, daysLeft, threshold } of candidates) {
    const tender = (task as unknown as { tenders: { id: string; contract_no: string | null; description: string | null; buyer: string | null } | null }).tenders;
    if (!tender) continue;
    const firstClaim = await claim(supabase, "clarification_window", tender.id, task.company_id, String(threshold), opts);
    if (!firstClaim) continue;
    const recipients = await companyRecipients(supabase, task.company_id);
    const { subject, html, text } = clarificationWindowReminderEmail({
      reference: tender.contract_no || tender.id,
      tenderTitle: tender.description,
      buyerShortName: tender.buyer || "the buyer",
      taskDescription: task.description,
      dueDate: task.due_date!,
      daysLeft,
      appUrl,
      tenderId: tender.id,
    });
    if (opts.dryRun) {
      dryRunRows.push({
        companyName: await companyName(supabase, task.company_id), companyId: task.company_id, recipients,
        targetItems: tender.contract_no || tender.id, subject,
        status: recipients.length === 0 ? "Skipped (no opted-in recipients)" : "Simulated OK",
      });
      continue;
    }
    if (recipients.length === 0) continue;
    const sendTo = opts.testRecipient ? [opts.testRecipient] : recipients;
    for (const to of sendTo) {
      const result = await sendTransactionalEmail({ to, subject, html, text, category: "bids" });
      if (result.status === "sent") sent++;
      await logSend(supabase, "clarification_window", `${opts.testRecipient ? "test-" : ""}clarification-${tender.id}-${task.company_id}-${threshold}-${to}`, to, task.company_id, tender.id, subject, result);
    }
  }
  return { sent, candidates: candidates.length };
}

async function main() {
  const { dryRun, companyId: scopeCompanyId, testRecipient } = parseSenderCliArgs(process.argv.slice(2));
  const opts: RunOpts = { dryRun, scopeCompanyId, testRecipient };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
    process.exit(1);
  }
  const appUrl = process.env.APP_URL || "https://tender-ready.vercel.app";

  if (!dryRun && !process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set - not sending or claiming any operational alert this run (will retry once a key is added).");
    return;
  }

  const supabase = createClient(url, serviceKey);

  // Each stage runs and reports independently - one stage's own error
  // (logged inside it) never stops the other two from running. Each also
  // gets its own dry-run table - they're genuinely different email types,
  // not one combined list.
  const printCutoffRows: DryRunRow[] = [];
  const printCutoff = await runPrintCutoff(supabase, appUrl, opts, printCutoffRows);
  if (dryRun) printDryRunTable("Print & Transit Cutoff", printCutoffRows);
  else console.log(`Print & transit cutoff: ${printCutoff.sent} sent, out of ${printCutoff.candidates} candidate(s).`);

  const briefingRows: DryRunRow[] = [];
  const briefing = await runBriefingReminders(supabase, appUrl, opts, briefingRows);
  if (dryRun) printDryRunTable("Briefing Countdown", briefingRows);
  else console.log(`Briefing countdown: ${briefing.sent} sent, out of ${briefing.candidates} candidate(s).`);

  const clarificationRows: DryRunRow[] = [];
  const clarification = await runClarificationWindow(supabase, appUrl, opts, clarificationRows);
  if (dryRun) printDryRunTable("Clarification Window Expiry", clarificationRows);
  else console.log(`Clarification window: ${clarification.sent} sent, out of ${clarification.candidates} candidate(s).`);
}

main().catch((e) => {
  console.error("send-operational-alerts failed", e);
  process.exit(1);
});
