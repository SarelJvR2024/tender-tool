-- Standing review finding, 2026-11-10: platform_admin_engine_telemetry()'s
-- (0101) 'narrative' row counted failed_24h_count against generated_at
-- instead of completed_at - the ONE queue in this function's five-branch
-- UNION ALL that has two separate completion timestamps (the other four -
-- pack_sanral, pack_general, cv, onboarding - each have exactly one
-- "the job finished" column, correctly reused for both their ready and
-- failed filters).
--
-- narrative_documents (0087) sets generated_at ONLY on the success path
-- (engine/narrative/process_narrative_jobs.py process_one(), the "ready"
-- PATCH at line ~313) - it is never written on any failure path. completed_at
-- is written on EVERY terminal transition, success or failure (process_one()'s
-- GenerationFailed/generic-Exception branches, and fail_stale_jobs()'s own
-- stale-reclaim-to-failed branch). 0101's own narrative branch filtered BOTH
-- completed_24h_count ("status = 'ready' and generated_at >= ...") and
-- failed_24h_count ("status = 'failed' and generated_at >= ...") on
-- generated_at - the first is harmless (generated_at IS set for every ready
-- row), but the second is dead on arrival: a failed row's generated_at is
-- always null, so the filter can never match, and the Telemetry page's
-- "Failed (24h)" column for the narrative queue reads 0 no matter how many
-- cover-letter/methodology generations actually failed in the last 24 hours.
--
-- Reproduced directly in a disposable scratch database (never the live DB,
-- never touched again after this check), via engine/security/replay_schema.sh
-- against a fresh Postgres 16: one narrative_documents row inserted with
-- status='failed', completed_at = now() - 1 hour, generated_at left null
-- (exactly process_one()'s own real failure-path row shape) - calling
-- platform_admin_engine_telemetry() as a seeded platform_admins caller
-- returned failed_24h_count = 0 for 'narrative' before this fix (confirmed
-- red), matching the live bug exactly; this migration applied, and only
-- failed_24h_count's and the identical condition inside the dropped ready
-- clause being left untouched, changes - re-running the same query afterwards
-- returns failed_24h_count = 1 (confirmed green).
--
-- Fix: failed_24h_count for the narrative branch now filters on completed_at,
-- the column every narrative completion (success or failure) actually
-- writes - the same column the other four branches already use for their
-- own failed_24h_count. completed_24h_count and avg_latency_seconds are left
-- on generated_at, unchanged - both are already correct (success-only, and
-- generated_at is always set together with completed_at on the ready path).
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
    -- 0126: completed_at, not generated_at - generated_at is never set on a
    -- failed row (only the success path sets it), so the old condition
    -- could never match a real failure.
    count(*) filter (where status = 'failed' and completed_at >= now() - interval '24 hours'),
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
  'Worker queue depth + latency across the 4 real job-queue tables (pack_generation_jobs split by engine, generated_cvs, narrative_documents, onboarding_uploads) - no new instrumentation, every column already existed. Returns nothing unless the caller is a platform admin. 0126: the narrative branch''s failed_24h_count now filters on completed_at (set on every terminal transition) rather than generated_at (set only on success) - the old condition could never match a real failure.';
revoke all on function platform_admin_engine_telemetry() from public;
grant execute on function platform_admin_engine_telemetry() to authenticated;
