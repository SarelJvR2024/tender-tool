#!/usr/bin/env node
// Tier 3 - Daily Founder Morning Digest (notification engine brief, section
// 3, Tier 3). Sarel's own ask, 2026-10-24: "Founder daily digest (07:00 SAST
// cron)". One email, once a day, to ADMIN_NOTIFICATION_EMAIL - never a
// per-company fan-out.
//
// Same architecture as scripts/send-operational-alerts.ts: a standalone
// script (needs the Supabase SERVICE ROLE key), run by
// .github/workflows/founder-digest.yml. Every number is read directly from
// its own real table with the service-role client - NOT through
// platform_admin_companies()/is_platform_admin() (migration 0064/0043),
// which are both gated on auth.uid() and so return nothing for a
// service-role caller (same reasoning migration 0094's own header comment
// gives for why company_member_labels() can't be reused either).
//
// workerJobSuccessRate is honestly left null (-> the template's own "No jobs
// ran" fallback): despite lib/emailTemplatesTier3.ts's own header comment
// claiming "no new RPC is required to populate every field below", this
// schema has no real worker-job success/failure ledger anywhere (confirmed
// by reading every migration) - admin_harness_runs (0022) is a manual test
// harness, not production job telemetry, and system_alerts (0042) only
// records failures, never successes, so a success RATE can't be derived
// from it. Rather than fabricate a number, this field stays null until a
// real job-outcome table exists - flagged here rather than silently guessed.
//
// Run: node --experimental-strip-types scripts/send-founder-digest.ts
// Needs: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
// ADMIN_NOTIFICATION_EMAIL (no recipient without it - see
// lib/resendEmail.ts's own adminNotificationEmail() comment).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { founderDailyDigestEmail } from "../lib/emailTemplatesTier3.ts";
import { sendNotification } from "../lib/notificationEngine.ts";
import { adminNotificationEmail } from "../lib/resendEmail.ts";

type SupabaseService = SupabaseClient;

// "Active bid" = the same pipeline_stage set migration 0048 already treats
// as "still being worked" (found/bidding/submitted) - never won/lost.
const ACTIVE_PIPELINE_STAGES = ["found", "bidding", "submitted"];
const CLOSING_WINDOW_HOURS = 48;

async function countNewSignups24h(supabase: SupabaseService, now: Date): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase.from("companies").select("id", { count: "exact", head: true }).eq("is_test_company", false).gte("created_at", since);
  if (error) {
    console.error("founder-digest: could not count new signups", error);
    return 0;
  }
  return count ?? 0;
}

async function countActiveSubscriptions(supabase: SupabaseService): Promise<number> {
  // Filtered in JS, not a PostgREST dot-path filter on the embedded
  // companies resource - same "fetch broad, filter in TypeScript" style
  // scripts/send-operational-alerts.ts already uses throughout, rather than
  // relying on untested-in-this-codebase embedded-column filter syntax.
  const { data, error } = await supabase.from("company_subscriptions").select("company_id, status, companies(is_test_company)").eq("status", "active");
  if (error) {
    console.error("founder-digest: could not count active subscriptions", error);
    return 0;
  }
  const rows = (data ?? []) as unknown as { company_id: string; status: string; companies: { is_test_company: boolean } | null }[];
  return rows.filter((r) => !r.companies?.is_test_company).length;
}

async function countClosingWithin48h(supabase: SupabaseService, now: Date): Promise<number> {
  const windowEnd = now.getTime() + CLOSING_WINDOW_HOURS * 60 * 60 * 1000;
  const { data, error } = await supabase
    .from("tender_packs")
    .select("tender_id, pipeline_stage, companies(is_test_company), tenders(closing_date)")
    .in("pipeline_stage", ACTIVE_PIPELINE_STAGES);
  if (error) {
    console.error("founder-digest: could not count tenders closing within 48h", error);
    return 0;
  }
  const rows = (data ?? []) as unknown as { tender_id: string; companies: { is_test_company: boolean } | null; tenders: { closing_date: string | null } | null }[];
  const tenderIds = new Set<string>();
  for (const r of rows) {
    if (r.companies?.is_test_company) continue;
    const closingDate = r.tenders?.closing_date;
    if (!closingDate) continue;
    const closingMs = new Date(closingDate).getTime();
    if (Number.isNaN(closingMs)) continue;
    if (closingMs >= now.getTime() && closingMs <= windowEnd) tenderIds.add(r.tender_id);
  }
  // Distinct tenders, not distinct packs - 2 companies pursuing the same
  // public tender is one real closing date, not two (same reasoning
  // lib/briefingReminders.ts's own header comment gives for tender_packs'
  // unique(company_id, tender_id) shape).
  return tenderIds.size;
}

async function countScoutBacklog(supabase: SupabaseService): Promise<number> {
  const { count, error } = await supabase.from("system_alerts").select("id", { count: "exact", head: true }).is("resolved_at", null);
  if (error) {
    console.error("founder-digest: could not count the system_alerts backlog", error);
    return 0;
  }
  return count ?? 0;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.");
    process.exit(1);
  }
  const appUrl = process.env.APP_URL || "https://tender-ready.vercel.app";

  const to = adminNotificationEmail();
  if (!to) {
    console.log("ADMIN_NOTIFICATION_EMAIL not set - nowhere to send the founder digest to this run.");
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.log("RESEND_API_KEY not set - not sending or claiming today's founder digest (will retry once a key is added).");
    return;
  }

  const supabase = createClient(url, serviceKey);
  const now = new Date();

  const [newSignupsLast24h, activeSubscriptions, closingWithin48h, scoutBacklogCount] = await Promise.all([
    countNewSignups24h(supabase, now),
    countActiveSubscriptions(supabase),
    countClosingWithin48h(supabase, now),
    countScoutBacklog(supabase),
  ]);

  // One calendar day in SAST, not UTC - this cron runs at 07:00 SAST, so a
  // naive UTC date could label the same SAST morning's digest with
  // yesterday's date for 2 hours after UTC midnight.
  const sastDateKey = now.toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
  const sastDateLabel = now.toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg", day: "2-digit", month: "short", year: "numeric" });

  const email = founderDailyDigestEmail({
    date: sastDateLabel,
    workerJobSuccessRate: null,
    newSignupsLast24h,
    activeSubscriptions,
    closingWithin48h,
    scoutBacklogCount,
    appUrl,
  });

  const result = await sendNotification(supabase, {
    idempotencyKey: `founder-digest-${sastDateKey}`,
    notificationType: "founder_daily_digest",
    senderProfile: "scout",
    to,
    email,
  });

  console.log(`Founder daily digest (${sastDateLabel}): ${result.outcome}.`);
}

main().catch((e) => {
  console.error("send-founder-digest failed", e);
  process.exit(1);
});
