-- System alerts: one central record of every failure worth Sarel's attention
-- (Sarel, 2026-10-17: "A fail must be emailed to me and flagged for me to
-- review so that we can fix it. Any issues and breaks must be sent and
-- flagged to me to keep reviewing and improving the app.").
--
-- Before this, a failure lived only where it happened: a job row's
-- error_message ('failed'), a print() in a worker log nobody reads, or a
-- Discovery 'ERROR' verdict in the seen store. Every engine/bridge now writes
-- here through engine/alerts/system_alerts.py (record_system_alert() below);
-- engine/alerts/check_system_alerts.py reports what is new since its last
-- check (an external scheduled session e-mails it - nothing here sends mail),
-- and /admin lists them with "Mark resolved".
--
-- Same NON-tenant-scoped, owner-only convention as admin_harness_runs
-- (0005/0022): this is Sarel's own operational visibility, not a tenant
-- feature, so there is no company_id column (a failing job's company is in
-- `context`, for diagnosis only). Readable by a company owner (0005's admin
-- proxy); an owner can write ONLY the three resolution columns; everything
-- else is written by the service role.
--
-- One row per open problem, not per occurrence: `fingerprint` is sha256 of
-- the source + the message with ids and numbers blanked out
-- (system_alerts.fingerprint() in Python), unique among UNRESOLVED rows, so a
-- bridge failing every 30 s raises `occurrences` on one row instead of
-- writing 2 880 rows a day. Once resolved, the same failure happening again
-- is a new row - and is reported again.
--
-- Reporting (the checker's seen store, in the table itself): reported_at /
-- reported_occurrences. New = never reported; "still happening" = reported,
-- unresolved, and occurrences grew since the last report.

create table system_alerts (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source ~ '^[a-z0-9_.:-]{1,80}$'),
  severity text not null default 'error' check (severity in ('critical', 'error', 'warning')),
  message text not null check (length(message) between 1 and 2000),
  detail text check (detail is null or length(detail) <= 50000),
  context jsonb not null default '{}'::jsonb,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  occurrences integer not null default 1 check (occurrences >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  reported_at timestamptz,
  reported_occurrences integer not null default 0 check (reported_occurrences >= 0),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text check (resolution_note is null or length(resolution_note) <= 4000)
);

comment on table system_alerts is
  'Central failure log for Sarel (not tenant-scoped, owner-only like admin_harness_runs). One row per open problem (fingerprint unique among unresolved rows; repeats raise occurrences). Written by engine/alerts/system_alerts.py via record_system_alert(); reported by engine/alerts/check_system_alerts.py; resolved in /admin.';
comment on column system_alerts.source is
  'Which engine/script/bridge raised it: pack, general, cv, cv_extract, ocr, discovery, deadlines, worker, ...';
comment on column system_alerts.context is
  'Diagnosis only: job id, company id, tender id, ocid, ... Never shown to a tenant.';
comment on column system_alerts.reported_at is
  'When check_system_alerts.py last reported this alert (null = never: new). Its database seen store.';

create unique index system_alerts_open_fingerprint_key on system_alerts (fingerprint) where resolved_at is null;
create index system_alerts_last_seen_idx on system_alerts (last_seen_at desc);

-- The one write path for the engines (service role): insert, or count one
-- more occurrence on the open alert with the same fingerprint. The most
-- severe severity seen wins; detail/context are the latest occurrence's.
create or replace function record_system_alert(
  p_source text, p_severity text, p_message text, p_detail text, p_context jsonb, p_fingerprint text
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into system_alerts (source, severity, message, detail, context, fingerprint)
  values (p_source, coalesce(p_severity, 'error'), left(p_message, 2000), left(p_detail, 50000),
          coalesce(p_context, '{}'::jsonb), p_fingerprint)
  on conflict (fingerprint) where resolved_at is null do update set
    occurrences = system_alerts.occurrences + 1,
    last_seen_at = now(),
    detail = coalesce(excluded.detail, system_alerts.detail),
    context = excluded.context,
    severity = case
      when array_position(array['warning', 'error', 'critical'], excluded.severity)
           > array_position(array['warning', 'error', 'critical'], system_alerts.severity)
      then excluded.severity else system_alerts.severity end
  returning id into v_id;
  return v_id;
end;
$$;

-- Service role only. Supabase's default privileges grant EXECUTE on new
-- public functions to anon/authenticated as well, so revoke those
-- explicitly (revoking from public alone would leave them).
revoke all on function record_system_alert(text, text, text, text, jsonb, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function record_system_alert(text, text, text, text, jsonb, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function record_system_alert(text, text, text, text, jsonb, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function record_system_alert(text, text, text, text, jsonb, text) to service_role;
  end if;
end;
$$;

alter table system_alerts enable row level security;

-- Readable by a company owner (0005's "trusted admin" proxy, same rule as
-- admin_harness_runs).
create policy "system_alerts: owners can select" on system_alerts
  for select to authenticated using (
    exists (select 1 from company_members where user_id = auth.uid() and role = 'owner')
  );

-- Owners may write ONLY the resolution columns (column privileges - RLS
-- can't restrict columns), with resolved_by pinned to themselves. Same
-- pattern as 0022's review columns.
revoke insert, update, delete on system_alerts from authenticated, anon;
grant update (resolved_at, resolved_by, resolution_note) on system_alerts to authenticated;

create policy "system_alerts: owners can resolve" on system_alerts
  for update to authenticated
  using (
    exists (select 1 from company_members where user_id = auth.uid() and role = 'owner')
  )
  with check (
    exists (select 1 from company_members where user_id = auth.uid() and role = 'owner')
    and (resolved_by is null or resolved_by = auth.uid())
  );
