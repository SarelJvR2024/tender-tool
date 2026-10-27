-- Workflow heartbeats: "did the Nth GitHub Actions cron job that sends
-- notifications actually run, and did it succeed" (Notification Command
-- Center brief, Phase 1, 2026-10-27). Deliberately NOT a GitHub Actions API
-- read at request time - the deployed app has no GitHub credential, and the
-- /admin "System Vitals" pass (2026-10-25, see app/app/admin/page.tsx's own
-- header) already chose not to add a job-queue heartbeat table for the
-- OCR/parser/dispatcher queues because nothing writes to one yet. This is
-- a narrower, justified exception to that same call: these 9 workflows
-- genuinely have nothing else recording "did this run" anywhere today (no
-- queue, no log table), and Sarel explicitly asked for exactly this -
-- "New Supabase heartbeat table... the standard architectural pattern for
-- background worker telemetry" - after being shown the OCR-queue precedent
-- and choosing to override it for this one surface.
--
-- workflow_name / cadence_cron are deliberately NOT columns here. The
-- single source of truth for "what the 9 workflows are called and when
-- they run" is the .github/workflows/*.yml files themselves - duplicating
-- that into a DB seed row would be a second copy that drifts the moment
-- someone edits a cron schedule without also editing a migration seed.
-- app/lib/workflowRegistry.ts holds that static, PR-reviewable list;
-- this table holds only what genuinely changes at runtime (the dynamic
-- last-run state), keyed by the same workflow_key values that registry
-- uses, with an upsert in the start RPC below so a workflow added to the
-- registry just starts appearing here the first time it runs - no
-- migration needed to register a new one.
create table workflow_heartbeats (
  workflow_key text primary key check (workflow_key ~ '^[a-z0-9_]{1,64}$'),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_status text not null default 'running' check (last_status in ('running', 'success', 'failed')),
  last_error text check (last_error is null or length(last_error) <= 2000),
  items_processed integer,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  updated_at timestamptz not null default now()
);
comment on table workflow_heartbeats is
  'One row per GitHub Actions workflow that this product relies on to send notifications (see app/lib/workflowRegistry.ts for the static name/cadence each workflow_key maps to) - the only record anywhere of whether a run actually happened and whether it succeeded. Written by engine/notify/record_heartbeat.py, called as the first and last step of each workflow job (see .github/workflows/*.yml) - never by the business-logic scripts themselves, so instrumenting this never risks touching tested send logic.';
comment on column workflow_heartbeats.last_status is
  '''running'' from the moment the job''s first step fires until its last step overwrites it - a row stuck on ''running'' well past its own cadence (computed server-side in app/lib/workflowRegistry.ts''s heartbeatStatusFor(), from that file''s own cadence, not stored here) means the job died mid-run without reaching its own finish step (e.g. a runner timeout), which is itself worth flagging as stale/failed.';
comment on column workflow_heartbeats.items_processed is
  'Best-effort count the finishing step was given (e.g. rows claimed, emails sent) - null when the workflow''s own finish step did not pass one. Never a correctness signal by itself, display only.';

-- Platform-admin read, same convention as every other operational-only
-- table (system_alerts 0086, notification_logs 0093) - never tenant data,
-- never shown to a customer.
alter table workflow_heartbeats enable row level security;
create policy "workflow_heartbeats: platform admins can select" on workflow_heartbeats
  for select to authenticated using (is_platform_admin());

-- Upsert, not update-only: the FIRST time a given workflow_key's start step
-- runs (including a brand new workflow added after this migration), there
-- is no existing row to update - same reasoning app/lib/workflowRegistry.ts's
-- own header gives for why workflow_key is the only shared key between code
-- and this table.
create or replace function record_workflow_heartbeat_start(p_workflow_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into workflow_heartbeats (workflow_key, last_started_at, last_status, last_error, updated_at)
  values (p_workflow_key, now(), 'running', null, now())
  on conflict (workflow_key) do update set
    last_started_at = now(),
    last_status = 'running',
    last_error = null,
    updated_at = now();
end;
$$;
comment on function record_workflow_heartbeat_start(text) is
  'Called as the very first step of a workflow job, before anything else can fail - marks this run as in progress. If the job dies before its own finish step runs, this row is left on ''running'' past its cadence window, which the admin UI surfaces as stale rather than silently showing yesterday''s last success.';

create or replace function record_workflow_heartbeat_finish(
  p_workflow_key text, p_status text, p_error text, p_items_processed integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('success', 'failed') then
    raise exception 'status must be success or failed' using errcode = '22023';
  end if;
  update workflow_heartbeats set
    last_completed_at = now(),
    last_status = p_status,
    last_error = left(p_error, 2000),
    items_processed = coalesce(p_items_processed, items_processed),
    duration_ms = case when last_started_at is not null
      then greatest(0, (extract(epoch from (now() - last_started_at)) * 1000)::integer)
      else duration_ms end,
    updated_at = now()
  where workflow_key = p_workflow_key;
end;
$$;
comment on function record_workflow_heartbeat_finish(text, text, text, integer) is
  'Called as the LAST step of a workflow job, gated on success()/failure() in the YAML (two separate steps, not one - GitHub Actions has no single "did this job pass" value available to a step that runs via if: always()). Deliberately an update, not an upsert: a finish with no matching start row (the start step itself was skipped or never ran) is silently dropped rather than fabricating a row with no last_started_at - record_workflow_heartbeat_start always runs first in every wired workflow.';

-- Service role only (GitHub Actions' own SUPABASE_SERVICE_ROLE_KEY, same
-- secret every other engine/ writer already uses) - no legitimate
-- authenticated/anon caller ever needs to write a fake "this workflow ran"
-- row, unlike claim_notification's own anon/authenticated grant (which
-- serves a real browser-side Server Action). Same revoke/grant idiom as
-- record_system_alert (0042).
do $$
begin
  revoke all on function record_workflow_heartbeat_start(text) from public;
  revoke all on function record_workflow_heartbeat_finish(text, text, text, integer) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function record_workflow_heartbeat_start(text) from anon;
    revoke all on function record_workflow_heartbeat_finish(text, text, text, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function record_workflow_heartbeat_start(text) from authenticated;
    revoke all on function record_workflow_heartbeat_finish(text, text, text, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function record_workflow_heartbeat_start(text) to service_role;
    grant execute on function record_workflow_heartbeat_finish(text, text, text, integer) to service_role;
  end if;
end;
$$;
