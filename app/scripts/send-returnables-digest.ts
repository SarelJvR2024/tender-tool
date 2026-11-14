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
// Consent: bypasses company_members.daily_digest_opt_in on purpose (Sarel,
// 2026-10-30) - a mandatory returnable missing days before closing is
// critical, bid-protecting information, not a discretionary digest; gating
// it the same way as the opt-in discovered-tenders digest meant 32 of 33
// real companies had never seen one. Recipients resolved via
// lib/notificationRecipients.ts's criticalBidRecipients() - every
// registered company_members email, unconditionally. Candidate selection
// (returnablesWindowCandidates(), lib/returnablesDigestCandidates.ts)
// excludes submitted/briefing_shortlisted/won/lost, so this never fires on
// a bid that's already handed in or decided.
//
// Cancellation: filterCancelledTenders() (below) drops any candidate whose
// tender already has a `tender_watched_documents` cancellation notice on
// file - see that function's own header for the full reasoning (Finding
// 451, reusing Findings 448/449/450's tendersWithCancellationNotice()
// unchanged).
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
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { formatDate } from "../lib/dates.ts";
import { businessDaysBetween, sastToday } from "../lib/publicHolidays.ts";
import { returnablesWindowCandidates, returnablesMissingMandatoryItems, type ReturnablesWindowCandidate, type ReturnablesWindowTenderRow } from "../lib/returnablesDigestCandidates.ts";
import { tendersWithCancellationNotice, type DeadlineWatchedDocRow } from "../lib/deadlineReminders.ts";
import { returnablesDigestEmail } from "../lib/emailTemplates.ts";
import { sendTransactionalEmail } from "../lib/resendEmail.ts";
import { criticalBidRecipients } from "../lib/notificationRecipients.ts";
import { fetchAllRows } from "../lib/supabasePaging.ts";

type SupabaseService = SupabaseClient;

const NOTIFICATION_TYPE = "returnables_digest";

/**
 * QA finding (2026-11-12, this track's own pass, Finding 451): drops every
 * candidate whose tender has at least one `tender_watched_documents` row
 * with `kind === "cancellation"` - the same whole-tender-cancellation signal
 * Findings 448/449/450 already wired into `send-deadline-reminders.ts`'s
 * closing-date email, the topbar bell (`lib/notifications.ts`) and the
 * Dashboard's `closingThisWeekCount` (`lib/dashboardStats.ts`), via the
 * identical, reused `tendersWithCancellationNotice()`
 * (`lib/deadlineReminders.ts`) - never duplicated, never reimplemented.
 *
 * Without this, a cancelled tender keeps its (now meaningless) real
 * `closing_date`, nothing clears `tender_packs.pipeline_stage` on
 * cancellation either (confirmed by reading `engine/discovery/
 * tender_updates.py`'s `classify_document()` in full - it only ever writes
 * `tender_watched_documents`, never touches `tender_packs`), so a tracked,
 * still-"building" pack for a tender the buyer has already cancelled
 * outright would keep entering `returnablesWindowCandidates()`'s 3-5
 * business day window and fire a "you're missing a mandatory returnable"
 * nudge for a bid that was never going to be submitted - the same recipients
 * who were already told, via the Tender Workspace page's own "Cancellation
 * notice" card and `send-corrigendum-alerts.ts`'s one-time alert, that the
 * tender is dead. Reachable and real, not contrived: this digest's own
 * `RETURNABLES_EXCLUDED_STAGES` check (submitted/briefing_shortlisted/won/
 * lost) does nothing here - a cancelled tender's pack is routinely still
 * `found`/`assessing`/`building` right up to its original closing date,
 * since nothing in this codebase ever auto-advances or auto-abandons a
 * pipeline stage on a buyer-side cancellation.
 *
 * Scoped to just the tender ids already in play (typically a handful per
 * run), same shape as `send-deadline-reminders.ts`'s own identical
 * `filterCancelledTenders()`. Read-only - never writes `tenders.closing_date`
 * or `tender_watched_documents` itself. Fails OPEN on a read error: logs and
 * returns every candidate unfiltered, same behaviour as before this fix
 * existed, rather than risk silently losing a real "missing returnable"
 * nudge over a flaky secondary query.
 */
export async function filterCancelledTenders(
  supabase: SupabaseService,
  candidates: ReturnablesWindowCandidate[],
): Promise<ReturnablesWindowCandidate[]> {
  if (candidates.length === 0) return candidates;
  const tenderIds = Array.from(new Set(candidates.map((c) => c.tender.id)));
  const { rows: docRows, error } = await fetchAllRows<DeadlineWatchedDocRow>(
    (from, to) =>
      supabase
        .from("tender_watched_documents")
        .select("tender_id, kind")
        .in("tender_id", tenderIds)
        .eq("kind", "cancellation")
        .range(from, to),
    20_000,
  );
  if (error) {
    console.error("returnables digest: could not read tender_watched_documents for cancellation check", error);
    return candidates;
  }
  const cancelledTenderIds = tendersWithCancellationNotice(docRows);
  return candidates.filter((c) => !cancelledTenderIds.has(c.tender.id));
}

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
  // SAST, not raw UTC - the scheduled 04:40 UTC run never crosses this, but
  // a manual workflow_dispatch run (or a future schedule change) in the
  // 22:00-00:00 UTC window would otherwise compute yesterday's SAST date as
  // "today", shifting businessDaysBetween() by a day against the real 3-5
  // business day window - the same UTC-vs-SAST bug class fixed in the
  // deadline calculator (lib/publicHolidays.ts's sastToday()).
  const todayStr = sastToday();

  // Paginated via fetchAllRows(), not a plain `.select()` - same reasoning
  // as scripts/send-deadline-reminders.ts's own identical read: this runs
  // under the SERVICE ROLE key against `tenders` (shared/public, "not
  // tenant-scoped" per 0001) joined has-many to EVERY company's own
  // tender_packs at once, the exact shape that silently hits PostgREST's
  // 1000-row db-max-rows cap (lib/supabasePaging.ts) before any single
  // company's data would. Past that cap this script would silently stop
  // sending the returnables-missing nudge for whichever tender/company pairs
  // sort past row 1000.
  const { rows: tenderRows, error: tenderError } = await fetchAllRows<ReturnablesWindowTenderRow>(
    (from, to) =>
      supabase
        .from("tenders")
        .select("id, contract_no, description, title, closing_date, family, document_requirements, tender_packs!inner(company_id, pipeline_stage)")
        .not("closing_date", "is", null)
        .range(from, to),
    20_000,
  );
  if (tenderError) {
    console.error("Could not read tenders", tenderError);
    process.exit(1);
  }

  const windowCandidates = returnablesWindowCandidates(tenderRows, todayStr, businessDaysBetween);

  // Drops any candidate whose tender has already been cancelled outright -
  // see filterCancelledTenders()'s own header above for the full reasoning
  // (Finding 451, the returnablesDigestCandidates.ts analogue of Findings
  // 448/449/450).
  const candidates = await filterCancelledTenders(supabase, windowCandidates);

  if (candidates.length === 0) {
    console.log("No tenders at the 3-5 business day returnables-digest window today.");
    return;
  }

  let sent = 0;
  let skippedNotMapped = 0;
  let skippedNothingMissing = 0;
  let skippedAlreadyClaimed = 0;
  let skippedNoMembers = 0;

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

    const recipients = await criticalBidRecipients(supabase, companyId);
    if (recipients.length === 0) {
      skippedNoMembers++;
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

    // Claimed only now, right before the real send - not earlier. Found
    // 2026-10-30: this used to claim BEFORE the recipients lookup and the
    // render above, both of which can genuinely fail (a network blip, bad
    // input to the template) - and this key fires "at most ONCE EVER per
    // tender/company pair" (this file's own header), with nothing that ever
    // retries it. A failure between the old claim point and the send would
    // have permanently burned this tender/company's one and only returnables
    // nudge with nothing ever sent - the same bug class a 2026-10-30 pass
    // fixed for engine/notify/send_pack_ready_email.py's identical shape.
    // Unlike scripts/send-discovered-tenders.ts / send-scout-alerts.ts /
    // send-compliance-digest.ts's own documented "claim-many before a
    // BATCHED send" tradeoff (one claim per item, one email per company/
    // batch - claiming early there is deliberate, to avoid a duplicate
    // across runs), this script sends one email per tender/company pair
    // with no batching reason to claim early at all.
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
      `${skippedAlreadyClaimed} already sent for this tender/company, ${skippedNoMembers} with no registered company member, out of ${candidates.length} candidate tender/company pair(s) ` +
      `(${windowCandidates.length - candidates.length} suppressed for a cancelled tender).`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("send-returnables-digest failed", e);
    process.exit(1);
  });
}
