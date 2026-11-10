-- Standing review, 2026-11-10: platform_admin_engine_telemetry() (0101,
-- 'returns nothing unless the caller is a platform admin' per its own
-- comment, re-confirmed as recently as 0126 one migration ago) leaks a
-- real, platform-wide statistic to EVERY signed-in user, not just admins -
-- a gap 0126's own fix (the narrative branch's failed_24h_count column,
-- read-only otherwise) never touched, since it's a structurally different
-- mistake in a different column.
--
-- Root cause. This function has no GROUP BY - every one of its 5 UNION ALL
-- branches is a plain aggregate query ("count(*) filter (...), ... from
-- pack_generation_jobs where engine = 'sanral' and is_platform_admin()"),
-- and an aggregate query with no GROUP BY always returns exactly one row,
-- even when its WHERE clause matches zero rows (confirmed directly:
-- `select count(*) from (values (1),(2)) t(x) where false` returns one row,
-- `0`, not zero rows). So `is_platform_admin()` in each branch's own WHERE
-- correctly zeroes out queued_count/active_count/completed_24h_count/
-- failed_24h_count for a non-admin (each is a `count(*) filter (...)` over
-- that same zero-row-matching WHERE) - but avg_latency_seconds in every one
-- of the 5 branches is computed by a SEPARATE scalar subquery
-- ("(select avg(...) from pack_generation_jobs p2 where p2.engine =
-- 'sanral' and p2.status = 'ready' and p2.completed_at >= ...)") that has
-- NO is_platform_admin() check anywhere inside it - it runs unconditionally,
-- against the real, unfiltered table, regardless of who is asking, and its
-- real result is substituted into the one row every non-admin still gets
-- back from the outer aggregate.
--
-- Reproduced live on a scratch Postgres (118 migrations, engine/security/
-- replay_schema.sh), with a REAL 'sanral' pack_generation_jobs row
-- (requested_at = now()-2h, completed_at = now()-1h, status='ready') and a
-- REAL generated_cvs row of the identical shape, both belonging to a company
-- the caller is NOT a member of and NOT a platform admin of (confirmed
-- `select is_platform_admin()` = false for this exact session first):
--   select queue_key, queued_count, avg_latency_seconds
--   from platform_admin_engine_telemetry() where queue_key in ('pack_sanral','cv');
-- returned queued_count = 0 for both (correctly zeroed, not a leak on that
-- column) but avg_latency_seconds = 3600.0 for both - the exact real
-- platform-wide average, byte-for-byte the same value a direct superuser
-- query against the same table returns. Every signed-in company user (the
-- function is `grant execute ... to authenticated`, callable directly via
-- supabase.rpc() same as every other *_checked()/platform_admin_*() RPC
-- this track has already found reachable that way) can read this platform-
-- wide operational metric - how fast Tender Ready's own engines are running
-- right now, across every customer, not just their own - with no admin
-- relationship to it at all. Not customer PII and not a cross-tenant row
-- read of any one company's own data, but a real, documented-as-admin-only
-- aggregate leaking to a non-admin all the same - the same authorization-
-- boundary class Findings 213/236/237/303 already fixed elsewhere in this
-- exact admin-console surface, here for the ONE column in this function
-- whose own WHERE clause never got the same is_platform_admin() gate every
-- sibling column already has.
--
-- Fix: wrap each of the 5 avg_latency_seconds subqueries in
-- `case when is_platform_admin() then (...) else null end` - a non-admin
-- now reads null for this column too, matching the zeroed-out shape every
-- other column in the same row already has, rather than a mix of "zeroed"
-- and "real". No other column, no other branch's WHERE/filter logic, and
-- 0126's own narrative completed_at/generated_at fix are touched.
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
    case when is_platform_admin() then
      (select avg(extract(epoch from (completed_at - requested_at)))
         from pack_generation_jobs p2 where p2.engine = 'sanral' and p2.status = 'ready'
           and p2.completed_at >= now() - interval '7 days')
    end
  from pack_generation_jobs where engine = 'sanral' and is_platform_admin()
  union all
  select 'pack_general', 'Requirement extraction & general pack build',
    count(*) filter (where status = 'requested'),
    count(*) filter (where status = 'generating'),
    count(*) filter (where status = 'ready' and completed_at >= now() - interval '24 hours'),
    count(*) filter (where status = 'failed' and completed_at >= now() - interval '24 hours'),
    case when is_platform_admin() then
      (select avg(extract(epoch from (completed_at - requested_at)))
         from pack_generation_jobs p2 where p2.engine = 'general' and p2.status = 'ready'
           and p2.completed_at >= now() - interval '7 days')
    end
  from pack_generation_jobs where engine = 'general' and is_platform_admin()
  union all
  select 'cv', 'CV generation',
    count(*) filter (where status = 'requested'),
    count(*) filter (where status = 'generating'),
    count(*) filter (where status = 'ready' and completed_at >= now() - interval '24 hours'),
    count(*) filter (where status = 'failed' and completed_at >= now() - interval '24 hours'),
    case when is_platform_admin() then
      (select avg(extract(epoch from (completed_at - requested_at)))
         from generated_cvs g2 where g2.status = 'ready' and g2.completed_at >= now() - interval '7 days')
    end
  from generated_cvs where is_platform_admin()
  union all
  select 'narrative', 'Narrative document drafting (cover letter / methodology)',
    count(*) filter (where status = 'requested'),
    count(*) filter (where status = 'generating'),
    count(*) filter (where status = 'ready' and generated_at >= now() - interval '24 hours'),
    -- 0126: completed_at, not generated_at - generated_at is never set on a
    -- failed row (only the success path sets it), so the old condition
    -- could never match a real failure. Unchanged by this migration.
    count(*) filter (where status = 'failed' and completed_at >= now() - interval '24 hours'),
    case when is_platform_admin() then
      (select avg(extract(epoch from (generated_at - requested_at)))
         from narrative_documents n2 where n2.status = 'ready' and n2.generated_at >= now() - interval '7 days')
    end
  from narrative_documents where is_platform_admin()
  union all
  select 'onboarding', 'Onboarding document classification',
    count(*) filter (where status = 'classification_requested'),
    count(*) filter (where status = 'classifying'),
    count(*) filter (where status = 'classified' and classification_completed_at >= now() - interval '24 hours'),
    count(*) filter (where status = 'classification_failed' and classification_completed_at >= now() - interval '24 hours'),
    case when is_platform_admin() then
      (select avg(extract(epoch from (classification_completed_at - created_at)))
         from onboarding_uploads o2 where o2.status = 'classified' and o2.classification_completed_at >= now() - interval '7 days')
    end
  from onboarding_uploads where is_platform_admin();
$$;
comment on function platform_admin_engine_telemetry() is
  'Worker queue depth + latency across the 4 real job-queue tables (pack_generation_jobs split by engine, generated_cvs, narrative_documents, onboarding_uploads) - no new instrumentation, every column already existed. Every count column is zeroed for a non-admin by this function''s own aggregate-with-no-GROUP-BY shape (count(*) filter over an always-false WHERE still returns one row of zeros, not zero rows); avg_latency_seconds now reads null for a non-admin too (2026-11-10 - its own subquery had no is_platform_admin() check at all, so it used to return the real platform-wide average to anyone signed in). 0126: the narrative branch''s failed_24h_count filters on completed_at (set on every terminal transition) rather than generated_at (set only on success).';
revoke all on function platform_admin_engine_telemetry() from public;
grant execute on function platform_admin_engine_telemetry() to authenticated;
