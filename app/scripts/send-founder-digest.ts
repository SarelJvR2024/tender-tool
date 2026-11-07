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
import { fetchAllRows } from "../lib/supabasePaging.ts";

type SupabaseService = SupabaseClient;

// `tender_packs` here is read under the SERVICE ROLE key with no company
// filter at all - the same shared/cross-tenant shape `scripts/send-deadline-reminders.ts`'s
// own header comment documents (summed across EVERY company's own pursuit of
// every tender, not one company's slice), which is exactly the shape that
// silently hits PostgREST's 1000-row db-max-rows cap on a plain, unranged
// `.select()` (lib/supabasePaging.ts). Past that cap this digest would
// silently undercount "tenders closing within 48h" for whichever
// pack/tender/company rows sort past row 1000 - a wrong founder-facing
// business number, not a cosmetic gap.
const MAX_TENDER_PACK_ROWS = 20_000;

// "Active bid" = the same pipeline_stage set migration 0048/0106 already
// treats as "still being worked" (found/assessing/building/submitted) -
// never won/lost. 'bidding' is the pre-0105 legacy value (lib/pipeline.ts's
// LEGACY_BIDDING_STAGE) - kept so a not-yet-backfilled row doesn't drop out
// of this count; harmless, unreachable once 0105 has run.
const ACTIVE_PIPELINE_STAGES = ["found", "assessing", "building", "bidding", "submitted"];
const CLOSING_WINDOW_HOURS = 48;

// All 4 count*() functions below return `number | null` - `null` means the
// read itself failed (a real Supabase/RPC error), never silently folded
// into a plain `0`. Fixed 2026-11-07x (standing review): these used to
// `console.error` the failure and then `return 0` anyway, so a transient
// read failure rendered in Sarel's own inbox as "0 new signups"/"0 active
// subscriptions"/"0 flagged" - indistinguishable from a genuine zero, the
// exact dominant bug class this review tracks, one hop further downstream
// than usual (the rendered business number itself, not a page's empty
// state). `founderDailyDigestEmail()` (lib/emailTemplatesTier3.ts) now
// renders `null` as its own distinct "Couldn't load" value.
export async function countNewSignups24h(supabase: SupabaseService, now: Date): Promise<number | null> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase.from("companies").select("id", { count: "exact", head: true }).eq("is_test_company", false).gte("created_at", since);
  if (error) {
    console.error("founder-digest: could not count new signups", error);
    return null;
  }
  return count ?? 0;
}

export async function countActiveSubscriptions(supabase: SupabaseService): Promise<number | null> {
  // Filtered in JS, not a PostgREST dot-path filter on the embedded
  // companies resource - same "fetch broad, filter in TypeScript" style
  // scripts/send-operational-alerts.ts already uses throughout, rather than
  // relying on untested-in-this-codebase embedded-column filter syntax.
  const { data, error } = await supabase.from("company_subscriptions").select("company_id, status, companies(is_test_company)").eq("status", "active");
  if (error) {
    console.error("founder-digest: could not count active subscriptions", error);
    return null;
  }
  const rows = (data ?? []) as unknown as { company_id: string; status: string; companies: { is_test_company: boolean } | null }[];
  return rows.filter((r) => !r.companies?.is_test_company).length;
}

export async function countClosingWithin48h(supabase: SupabaseService, now: Date): Promise<number | null> {
  const windowEnd = now.getTime() + CLOSING_WINDOW_HOURS * 60 * 60 * 1000;
  const { rows: data, error } = await fetchAllRows<Record<string, unknown>>(
    (from, to) =>
      supabase
        .from("tender_packs")
        .select("tender_id, pipeline_stage, companies(is_test_company), tenders(closing_date)")
        .in("pipeline_stage", ACTIVE_PIPELINE_STAGES)
        .range(from, to),
    MAX_TENDER_PACK_ROWS,
  );
  if (error) {
    console.error("founder-digest: could not count tenders closing within 48h", error);
    return null;
  }
  const rows = data as unknown as { tender_id: string; companies: { is_test_company: boolean } | null; tenders: { closing_date: string | null } | null }[];
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

export async function countScoutBacklog(supabase: SupabaseService): Promise<number | null> {
  const { count, error } = await supabase.from("system_alerts").select("id", { count: "exact", head: true }).is("resolved_at", null);
  if (error) {
    console.error("founder-digest: could not count the system_alerts backlog", error);
    return null;
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
