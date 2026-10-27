-- Admin Command Center, Phase 3: Telemetry & Billing (2026-10-27).
--
-- Telemetry: worker queue depth + engine latency, from the 4 real job-queue
-- tables that already exist (confirmed by reading each one directly) -
-- pack_generation_jobs (engine 'sanral'|'general', 0017/0026), generated_cvs
-- (0008), narrative_documents (0087), onboarding_uploads (0063). No new
-- heartbeat/instrumentation added anywhere - every number here is a plain
-- aggregate over columns that were already being written. Error rate reuses
-- system_alerts (0042), windowed to the last 24h rather than "currently
-- open" (app/app/admin/page.tsx's own Quick Health Status) - a different,
-- complementary question ("how much broke recently" vs "what's still
-- broken").
--
-- Billing: MRR/subscription/quota overview, built entirely on lib/billing.ts's
-- already-tested pricing (PLAN_MONTHLY_ZAR, priceForPlanZar,
-- effectiveSubscriptionStatus) computed in TypeScript from this RPC's raw
-- columns - never re-derived in SQL, so there is exactly one place a price
-- or a lapsed-trial rule can be wrong. company_packs_this_period() (0084) is
-- reused as-is, not reimplemented.
create or replace function platform_admin_engine_telemetry()
returns table (
  queue_key text,
  queue_label text,
  queued_count bigint,
  active_count bigint,
  completed_24h_count bigint,
  failed_24h_count bigint,
  avg_latency_seconds numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select 'pack_sanral', 'Submission pack build (SANRAL engine)',
    count(*) filter (where status = 'requested'),
    count(*) filter (where status = 'generating'),
    count(*) filter (where status = 'ready' and completed_at >= now() - interval '24 hours'),
    count(*) filter (where status = 'failed' and completed_at >= now() - interval '24 hours'),
    (select avg(extract(epoch from (completed_at - requested_at)))
       from pack_generation_jobs p2 where p2.engine = 'sanral' and p2.status = 'ready'
         and p2.completed_at >= now() - interval '7 days')
  from pack_generation_jobs where engine = 'sanral' and is_platform_admin()
  union all
  select 'pack_general', 'Requirement extraction & general pack build',
    count(*) filter (where status = 'requested'),
    count(*) filter (where status = 'generating'),
    count(*) filter (where status = 'ready' and completed_at >= now() - interval '24 hours'),
    count(*) filter (where status = 'failed' and completed_at >= now() - interval '24 hours'),
    (select avg(extract(epoch from (completed_at - requested_at)))
       from pack_generation_jobs p2 where p2.engine = 'general' and p2.status = 'ready'
         and p2.completed_at >= now() - interval '7 days')
  from pack_generation_jobs where engine = 'general' and is_platform_admin()
  union all
  select 'cv', 'CV generation',
    count(*) filter (where status = 'requested'),
    count(*) filter (where status = 'generating'),
    count(*) filter (where status = 'ready' and completed_at >= now() - interval '24 hours'),
    count(*) filter (where status = 'failed' and completed_at >= now() - interval '24 hours'),
    (select avg(extract(epoch from (completed_at - requested_at)))
       from generated_cvs g2 where g2.status = 'ready' and g2.completed_at >= now() - interval '7 days')
  from generated_cvs where is_platform_admin()
  union all
  select 'narrative', 'Narrative document drafting (cover letter / methodology)',
    count(*) filter (where status = 'requested'),
    count(*) filter (where status = 'generating'),
    count(*) filter (where status = 'ready' and generated_at >= now() - interval '24 hours'),
    count(*) filter (where status = 'failed' and generated_at >= now() - interval '24 hours'),
    (select avg(extract(epoch from (generated_at - requested_at)))
       from narrative_documents n2 where n2.status = 'ready' and n2.generated_at >= now() - interval '7 days')
  from narrative_documents where is_platform_admin()
  union all
  select 'onboarding', 'Onboarding document classification',
    count(*) filter (where status = 'classification_requested'),
    count(*) filter (where status = 'classifying'),
    count(*) filter (where status = 'classified' and classification_completed_at >= now() - interval '24 hours'),
    count(*) filter (where status = 'classification_failed' and classification_completed_at >= now() - interval '24 hours'),
    (select avg(extract(epoch from (classification_completed_at - created_at)))
       from onboarding_uploads o2 where o2.status = 'classified' and o2.classification_completed_at >= now() - interval '7 days')
  from onboarding_uploads where is_platform_admin();
$$;
comment on function platform_admin_engine_telemetry() is
  'Worker queue depth + latency across the 4 real job-queue tables (pack_generation_jobs split by engine, generated_cvs, narrative_documents, onboarding_uploads) - no new instrumentation, every column already existed. Returns nothing unless the caller is a platform admin.';
revoke all on function platform_admin_engine_telemetry() from public;
grant execute on function platform_admin_engine_telemetry() to authenticated;

create or replace function platform_admin_alert_counts_24h()
returns table (source text, alert_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select source, count(*)
  from system_alerts
  where last_seen_at >= now() - interval '24 hours' and is_platform_admin()
  group by source;
$$;
comment on function platform_admin_alert_counts_24h() is
  'Per-source system_alerts occurrence count in the last 24h (last_seen_at, so a recurring open alert counts every day it keeps happening, not just once) - the Telemetry tab''s "error rate" signal, a different question from app/app/admin/page.tsx''s own "what is still open right now".';
revoke all on function platform_admin_alert_counts_24h() from public;
grant execute on function platform_admin_alert_counts_24h() to authenticated;

create or replace function platform_admin_billing_overview()
returns table (
  company_id uuid,
  legal_name text,
  csd_trading_name text,
  is_test_company boolean,
  plan_tier text,
  billing_interval text,
  status text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  max_packs_per_month integer,
  packs_used_this_period integer,
  has_payfast_token boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id, c.legal_name, c.csd_trading_name, c.is_test_company,
    cs.plan_tier, cs.billing_interval, cs.status, cs.trial_ends_at, cs.current_period_end,
    cs.max_packs_per_month,
    company_packs_this_period(c.id),
    cs.payfast_token is not null
  from companies c
  join company_subscriptions cs on cs.company_id = c.id
  where is_platform_admin()
  order by c.created_at desc;
$$;
comment on function platform_admin_billing_overview() is
  'Billing tab''s own data: plan, status, quota usage (company_packs_this_period(), 0084) and whether a PayFast token is on file, per company. Pricing itself is never computed here - the caller applies lib/billing.ts''s already-tested PLAN_MONTHLY_ZAR/priceForPlanZar/effectiveSubscriptionStatus to these raw columns, so there is exactly one place a price or a lapsed-trial rule lives.';
revoke all on function platform_admin_billing_overview() from public;
grant execute on function platform_admin_billing_overview() to authenticated;
