#!/usr/bin/env node
// Tier 0 onboarding & trial lifecycle nudges (notification engine brief
// addendum). Sarel's own ask, 2026-10-24: "event-driven / conditional
// triggers based on CSD and first tender progress" (nudge_vault_kickstart,
// nudge_first_tender) plus the 3 trial-lifecycle milestones
// (trial_day_7_milestone, trial_expiring_48h, trial_expired) - the
// genuinely recurring/promotional half of Tier 0, which is why these 5 (and
// only these 5) honour company_members.lifecycle_email_opt_out (migration
// 0093). welcome_user/team_invite/admin_new_signup/admin_paid_conversion
// are event-triggered from their own real action (signup, invite, payment)
// elsewhere in the app, not a daily candidate scan - out of scope here.
//
// Same architecture as scripts/send-operational-alerts.ts, on purpose: one
// standalone script (needs the Supabase SERVICE ROLE key, which the
// deployed Next.js app never holds), run by
// .github/workflows/onboarding-nudges.yml, 5 independent stages under one
// schedule. Each stage claims via lib/notificationEngine.ts's
// sendNotification() (migration 0093's notification_claims/notification_logs),
// never scripts/send-operational-alerts.ts's own, separate
// sent_operational_alerts table - these are two deliberately different
// notification types, not touched here.
//
// Run: node --experimental-strip-types scripts/send-onboarding-nudges.ts
// Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
// (missing RESEND_API_KEY: sendNotification() exits early per notification
// and claims nothing - see its own header comment on why claiming without a
// real send would permanently waste a one-time idempotency key).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { firstTenderCandidates, vaultKickstartCandidates, type FirstTenderCompanyRow, type VaultKickstartCompanyRow } from "../lib/onboardingNudges.ts";
import { trialDay7Candidates, trialExpiredCandidates, trialExpiringCandidates, type TrialSubscriptionRow } from "../lib/trialLifecycle.ts";
import { nudgeFirstTenderEmail, nudgeVaultKickstartEmail, trialDay7MilestoneEmail, trialExpiredEmail, trialExpiring48hEmail } from "../lib/emailTemplatesTier0.ts";
import { sendNotification, type NotificationType } from "../lib/notificationEngine.ts";
import { daysUntil } from "../lib/dates.ts";
import { VAULT_DOCUMENTS } from "../lib/vaultDocuments.ts";
import { fetchAllRows } from "../lib/supabasePaging.ts";

type SupabaseService = SupabaseClient;

// `tender_packs` is the shared/cross-tenant shape `scripts/send-deadline-reminders.ts`'s
// own header comment documents (one row per company x tender, summed across
// EVERY company at once under this service-role client - not one company's
// own slice) - the same shape that silently hits PostgREST's 1000-row
// db-max-rows cap on a plain, unranged `.select()` (lib/supabasePaging.ts).
// Both runFirstTender() and companySubscriptions() below need the SAME full
// company_id list from this table, so it's paginated once here and reused,
// rather than two separate unranged `.select("company_id")` calls each
// silently truncating past row 1000 as this table grows with total platform
// usage (every company's own tender-pursuit history, not one company's).
const MAX_TENDER_PACK_ROWS = 20_000;

async function allTenderPackCompanyIds(supabase: SupabaseService): Promise<{ companyIds: string[]; error: string | null }> {
  const { rows, error } = await fetchAllRows<{ company_id: string }>(
    (from, to) => supabase.from("tender_packs").select("company_id").range(from, to),
    MAX_TENDER_PACK_ROWS,
  );
  return { companyIds: rows.map((r) => r.company_id), error };
}

type Recipient = { userId: string; email: string };

/**
 * Every member of one company who has NOT opted out of Tier 0 lifecycle mail (company_members.lifecycle_email_opt_out, migration 0093) - via company_notification_recipients() (migration 0094), deliberately not company_member_labels() (0033), which returns zero rows for a service-role caller - see 0094's own header comment.
 *
 * Found 2026-11-07 (standing solution-architect review): this used to discard a real RPC error with no `console.error` at all, silently returning `[]` - a transient read failure for one company was then indistinguishable from "every member opted out", with nothing in the logs to tell the two apart. Every sibling recipient resolver (`operationalRecipients()`/`criticalBidRecipients()`, `lib/notificationRecipients.ts`) already logs this exact RPC's own error; this one didn't. The consequence is worse here than in most senders: `trial_day_7_milestone` (see `trialDay7Candidates()`, `lib/trialLifecycle.ts`) is an exact-day match on `daysUntil(trial_ends_at) === 7`, not a retried window - a company that hits this failure on its one qualifying day never gets a retry, since the very next run no longer matches.
 */
export async function lifecycleRecipients(supabase: SupabaseService, companyId: string): Promise<Recipient[]> {
  const { data, error } = await supabase.rpc("company_notification_recipients", { p_company_id: companyId });
  if (error || !data) {
    if (error) console.error(`company_notification_recipients rpc failed for company ${companyId}`, error);
    return [];
  }
  return (data as { user_id: string; email: string; lifecycle_email_opt_out: boolean }[])
    .filter((m) => !m.lifecycle_email_opt_out && m.email?.includes("@"))
    .map((m) => ({ userId: m.user_id, email: m.email }));
}

/**
 * This recipient's one-click unsubscribe URL (RFC 8058) - lazily creates their token via lifecycle_unsubscribe_token_for() (0093), same as every other Tier 0 sender must.
 *
 * Same 2026-11-07 fix as `lifecycleRecipients()` above: a real RPC failure now logs instead of silently falling through to "no unsubscribe link on this email" (a POPIA/CAN-SPAM one-click-unsubscribe gap, not just a missing header) with no trace of why.
 */
export async function unsubscribeUrlFor(supabase: SupabaseService, userId: string, appUrl: string): Promise<string | undefined> {
  const { data: token, error } = await supabase.rpc("lifecycle_unsubscribe_token_for", { p_user_id: userId });
  if (error || !token) {
    if (error) console.error(`lifecycle_unsubscribe_token_for rpc failed for user ${userId}`, error);
    return undefined;
  }
  return `${appUrl}/api/unsubscribe?token=${encodeURIComponent(token as string)}`;
}

async function sendToRecipients(
  supabase: SupabaseService,
  recipients: Recipient[],
  companyId: string,
  notificationType: NotificationType,
  idempotencyKeyFor: (userId: string) => string,
  appUrl: string,
  buildEmail: (unsubscribeUrl: string | undefined) => { subject: string; html: string; text: string; headers?: Record<string, string> }
): Promise<number> {
  let sent = 0;
  for (const r of recipients) {
    const unsubscribeUrl = await unsubscribeUrlFor(supabase, r.userId, appUrl);
    const email = buildEmail(unsubscribeUrl);
    const result = await sendNotification(supabase, {
      idempotencyKey: idempotencyKeyFor(r.userId),
      notificationType,
      senderProfile: "system",
      to: r.email,
      email,
      companyId,
    });
    if (result.outcome === "sent") sent++;
  }
  return sent;
}

async function runVaultKickstart(supabase: SupabaseService, appUrl: string): Promise<{ sent: number; candidates: number }> {
  const columns = ["id", "legal_name", "created_at", ...Object.values(VAULT_DOCUMENTS).map((d) => d.column)].join(", ");
  const { data, error } = await supabase.from("companies").select(columns).eq("is_test_company", false);
  if (error) {
    console.error("nudge-vault-kickstart: could not read companies", error);
    return { sent: 0, candidates: 0 };
  }
  const candidates = vaultKickstartCandidates((data ?? []) as unknown as VaultKickstartCompanyRow[]);
  let sent = 0;
  for (const { company, vaultDocsOnFile } of candidates) {
    const recipients = await lifecycleRecipients(supabase, company.id);
    sent += await sendToRecipients(
      supabase,
      recipients,
      company.id,
      "nudge_vault_kickstart",
      (userId) => `nudge-vault-kickstart-${company.id}-${userId}`,
      appUrl,
      (unsubscribeUrl) => nudgeVaultKickstartEmail({ companyName: company.legal_name || "Your company", vaultDocsOnFile, appUrl, unsubscribeUrl })
    );
  }
  return { sent, candidates: candidates.length };
}

async function runFirstTender(supabase: SupabaseService, appUrl: string): Promise<{ sent: number; candidates: number }> {
  const [{ data: companyRows, error: companyError }, { companyIds: packCompanyIds, error: packError }] = await Promise.all([
    supabase.from("companies").select("id, legal_name, created_at").eq("is_test_company", false),
    allTenderPackCompanyIds(supabase),
  ]);
  if (companyError || packError) {
    console.error("nudge-first-tender: could not read companies/tender_packs", companyError ?? packError);
    return { sent: 0, candidates: 0 };
  }
  const companyIdsWithAPack = new Set(packCompanyIds);
  const candidates = firstTenderCandidates((companyRows ?? []) as FirstTenderCompanyRow[], companyIdsWithAPack);
  let sent = 0;
  for (const company of candidates) {
    const recipients = await lifecycleRecipients(supabase, company.id);
    sent += await sendToRecipients(
      supabase,
      recipients,
      company.id,
      "nudge_first_tender",
      (userId) => `nudge-first-tender-${company.id}-${userId}`,
      appUrl,
      (unsubscribeUrl) => nudgeFirstTenderEmail({ companyName: company.legal_name || "Your company", appUrl, unsubscribeUrl })
    );
  }
  return { sent, candidates: candidates.length };
}

async function companySubscriptions(supabase: SupabaseService): Promise<{ rows: (TrialSubscriptionRow & { legal_name: string | null })[]; packCountByCompany: Map<string, number> }> {
  const [{ data: subRows, error: subError }, { companyIds: packCompanyIds, error: packError }] = await Promise.all([
    supabase.from("company_subscriptions").select("company_id, status, trial_ends_at, companies(legal_name)"),
    allTenderPackCompanyIds(supabase),
  ]);
  if (subError || packError) {
    console.error("trial-lifecycle: could not read company_subscriptions/tender_packs", subError ?? packError);
    return { rows: [], packCountByCompany: new Map() };
  }
  const packCountByCompany = new Map<string, number>();
  for (const companyId of packCompanyIds) {
    packCountByCompany.set(companyId, (packCountByCompany.get(companyId) ?? 0) + 1);
  }
  const rows = ((subRows ?? []) as unknown as { company_id: string; status: string; trial_ends_at: string | null; companies: { legal_name: string | null } | null }[]).map((r) => ({
    company_id: r.company_id,
    status: r.status,
    trial_ends_at: r.trial_ends_at,
    legal_name: r.companies?.legal_name ?? null,
  }));
  return { rows, packCountByCompany };
}

async function runTrialDay7(supabase: SupabaseService, appUrl: string, rows: (TrialSubscriptionRow & { legal_name: string | null })[], packCountByCompany: Map<string, number>): Promise<{ sent: number; candidates: number }> {
  const candidates = trialDay7Candidates(rows, daysUntil);
  let sent = 0;
  for (const sub of candidates) {
    const recipients = await lifecycleRecipients(supabase, sub.company_id);
    const companyName = sub.legal_name || "Your company";
    const packsBuiltSoFar = packCountByCompany.get(sub.company_id) ?? 0;
    sent += await sendToRecipients(
      supabase,
      recipients,
      sub.company_id,
      "trial_day_7_milestone",
      (userId) => `trial-day-7-${sub.company_id}-${userId}`,
      appUrl,
      (unsubscribeUrl) => trialDay7MilestoneEmail({ companyName, trialEndsAt: sub.trial_ends_at!, packsBuiltSoFar, appUrl, unsubscribeUrl })
    );
  }
  return { sent, candidates: candidates.length };
}

async function runTrialExpiring48h(supabase: SupabaseService, appUrl: string, rows: (TrialSubscriptionRow & { legal_name: string | null })[]): Promise<{ sent: number; candidates: number }> {
  const candidates = trialExpiringCandidates(rows);
  let sent = 0;
  for (const sub of candidates) {
    const recipients = await lifecycleRecipients(supabase, sub.company_id);
    const companyName = sub.legal_name || "Your company";
    sent += await sendToRecipients(
      supabase,
      recipients,
      sub.company_id,
      "trial_expiring_48h",
      (userId) => `trial-expiring-48h-${sub.company_id}-${userId}`,
      appUrl,
      (unsubscribeUrl) => trialExpiring48hEmail({ companyName, trialEndsAt: sub.trial_ends_at!, appUrl, unsubscribeUrl })
    );
  }
  return { sent, candidates: candidates.length };
}

async function runTrialExpired(supabase: SupabaseService, appUrl: string, rows: (TrialSubscriptionRow & { legal_name: string | null })[]): Promise<{ sent: number; candidates: number }> {
  const candidates = trialExpiredCandidates(rows);
  let sent = 0;
  for (const sub of candidates) {
    const recipients = await lifecycleRecipients(supabase, sub.company_id);
    const companyName = sub.legal_name || "Your company";
    sent += await sendToRecipients(
      supabase,
      recipients,
      sub.company_id,
      "trial_expired",
      (userId) => `trial-expired-${sub.company_id}-${userId}`,
      appUrl,
      (unsubscribeUrl) => trialExpiredEmail({ companyName, appUrl, unsubscribeUrl })
    );
  }
  return { sent, candidates: candidates.length };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
    process.exit(1);
  }
  const appUrl = process.env.APP_URL || "https://tender-ready.vercel.app";

  if (!process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set - not sending or claiming any onboarding nudge this run (will retry once a key is added).");
    return;
  }

  const supabase = createClient(url, serviceKey);

  const vaultKickstart = await runVaultKickstart(supabase, appUrl);
  console.log(`Vault kickstart nudge: ${vaultKickstart.sent} sent, out of ${vaultKickstart.candidates} candidate company(ies).`);

  const firstTender = await runFirstTender(supabase, appUrl);
  console.log(`First tender nudge: ${firstTender.sent} sent, out of ${firstTender.candidates} candidate company(ies).`);

  const { rows: subRows, packCountByCompany } = await companySubscriptions(supabase);

  const day7 = await runTrialDay7(supabase, appUrl, subRows, packCountByCompany);
  console.log(`Trial day-7 milestone: ${day7.sent} sent, out of ${day7.candidates} candidate company(ies).`);

  const expiring = await runTrialExpiring48h(supabase, appUrl, subRows);
  console.log(`Trial expiring (48h): ${expiring.sent} sent, out of ${expiring.candidates} candidate company(ies).`);

  const expired = await runTrialExpired(supabase, appUrl, subRows);
  console.log(`Trial expired: ${expired.sent} sent, out of ${expired.candidates} candidate company(ies).`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("send-onboarding-nudges failed", e);
    process.exit(1);
  });
}
