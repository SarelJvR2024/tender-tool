#!/usr/bin/env node
// Deadline-reminder email: "closing in 3 days / 24 hours", triggered off
// the exact same facts lib/notifications.ts's getNotifications() already
// surfaces to the topbar bell (same tenders+tender_packs join,
// DEADLINE_WINDOW_DAYS=14, daysUntil() math) - see lib/deadlineReminders.ts.
//
// A STANDALONE SCRIPT, not a Next.js route, run on a schedule by
// .github/workflows/deadline-reminders.yml - the same architecture this
// repo already uses for any genuinely cross-tenant backend job (see
// engine/notify/daily_digest.py + daily-digest.yml), because this task
// needs to read every company's closing tenders and members' emails in one
// run, which needs the Supabase SERVICE ROLE key - and this Next.js app
// itself never holds that key (see supabase/migrations/0077's own header
// comment: "this Next.js app never holds the Supabase service-role key...
// only engine/*, the bridge workers, do"). This script is the Node/
// TypeScript equivalent of that same rule for this one job, run outside
// the deployed app, same as the Python digest sender.
//
// Consent: reuses company_members.daily_digest_opt_in (migration 0073) -
// Sarel's own existing "opt-in, never opt-out" email preference - rather
// than inventing a second opt-in flag for a second notification type (the
// task's own instruction: "reuse this existing infrastructure... rather
// than building a second, parallel email-sending mechanism").
//
// Run: node --experimental-strip-types scripts/send-deadline-reminders.ts
// Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
// (missing RESEND_API_KEY: this run exits early and claims NOTHING via
// record_deadline_reminder_sent - that claim is one-time-only, so claiming
// it without actually sending would permanently waste it; see main()).
import { createClient } from "@supabase/supabase-js";
import { daysUntil } from "../lib/dates.ts";
import { deadlineReminderCandidates, type DeadlineReminderTenderRow } from "../lib/deadlineReminders.ts";
import { deadlineReminderEmail } from "../lib/emailTemplates.ts";
import { sendTransactionalEmail } from "../lib/resendEmail.ts";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
    process.exit(1);
  }
  const appUrl = process.env.APP_URL || "https://tender-ready.vercel.app";

  // Checked up front, not per-candidate: if RESEND_API_KEY isn't set yet,
  // this run must NOT claim any reminder via record_deadline_reminder_sent -
  // that claim is a one-time-only token (the table's own unique constraint),
  // so claiming it now would permanently waste it even though nothing was
  // actually emailed, and a later run (once a real key is added) could never
  // send that specific 3-day/24-hour reminder at all. Logged once, like
  // engine/notify/send_digest_emails.py's own identical rule for the daily
  // digest - never a crash, never a false "sent".
  if (!process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set - not sending or claiming any reminder this run (will retry once a key is added).");
    return;
  }

  const supabase = createClient(url, serviceKey);

  const { data: tenderRows, error: tenderError } = await supabase
    .from("tenders")
    .select("id, contract_no, description, closing_date, tender_packs!inner(company_id)")
    .not("closing_date", "is", null);
  if (tenderError) {
    console.error("Could not read tenders", tenderError);
    process.exit(1);
  }

  // One entry per (tender, COMPANY, threshold) - tender_packs!inner above is
  // a has-many embed, so a tender tracked by several companies yields
  // several entries here, each handled (and dedupe-claimed) independently.
  // See deadlineReminderCandidates()'s own doc comment for why this can't
  // just be tender.tender_packs[0] (QA Finding, 2026-10-22).
  const candidates = deadlineReminderCandidates((tenderRows ?? []) as unknown as DeadlineReminderTenderRow[], daysUntil);

  if (candidates.length === 0) {
    console.log("No tenders at a 3-day or 24-hour reminder threshold today.");
    return;
  }

  let sent = 0;
  let skippedAlreadySent = 0;
  let skippedNoOptedInMembers = 0;

  for (const { tender, companyId, daysLeft, threshold } of candidates) {
    const { data: claimed, error: claimError } = await supabase.rpc("record_deadline_reminder_sent", {
      p_tender_id: tender.id,
      p_company_id: companyId,
      p_threshold_days: threshold,
    });
    if (claimError) {
      console.error(`record_deadline_reminder_sent failed for tender ${tender.id}, company ${companyId}`, claimError);
      continue;
    }
    if (!claimed) {
      skippedAlreadySent++;
      continue;
    }

    const { data: members, error: membersError } = await supabase
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("daily_digest_opt_in", true);
    if (membersError) {
      console.error(`Could not read company_members for company ${companyId}`, membersError);
      continue;
    }
    if (!members || members.length === 0) {
      skippedNoOptedInMembers++;
      continue;
    }

    const { data: labelRows, error: labelError } = await supabase.rpc("company_member_labels");
    if (labelError) {
      console.error("company_member_labels rpc failed", labelError);
      continue;
    }
    const emailByUserId = new Map(((labelRows ?? []) as { user_id: string; label: string }[]).map((r) => [r.user_id, r.label]));

    const contractLabel = tender.contract_no || tender.description || "Tender";
    const { subject, html, text } = deadlineReminderEmail({
      contractLabel,
      closingDate: tender.closing_date!,
      daysLeft,
      appUrl,
      tenderId: tender.id,
    });

    for (const m of members as { user_id: string }[]) {
      const email = emailByUserId.get(m.user_id);
      if (!email || !email.includes("@")) continue;
      const result = await sendTransactionalEmail({ to: email, subject, html, text });
      if (result.status === "sent") sent++;
      else console.log(`  ${result.status} -> ${email} (${contractLabel})`);
    }
  }

  console.log(
    `Deadline reminders: ${sent} sent, ${skippedAlreadySent} already sent today, ${skippedNoOptedInMembers} with no opted-in member, out of ${candidates.length} candidate tender/company/threshold pair(s).`
  );
}

main().catch((e) => {
  console.error("send-deadline-reminders failed", e);
  process.exit(1);
});
