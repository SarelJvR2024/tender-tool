-- Admin Command Center, Phase 4: Impersonation + audit log (2026-10-27).
-- Sarel's own explicit authorization, with 5 named guardrails - this
-- migration covers guardrail 3 ("Immutable Audit Logging") and the
-- company_id -> target-user resolution guardrail 5 needs ("View Tenant
-- Workspace" has to pick a real person to view as).
--
-- "Immutable" here means: a row, once started, can never be deleted and can
-- never have anything OTHER than ended_at changed, and ended_at itself can
-- only move from null to a real timestamp once, by the SAME admin who
-- started it. No client insert/update/delete policy exists at all - every
-- write goes through the two narrow SECURITY DEFINER functions below, same
-- escape-hatch convention as every other platform-admin table.
--
-- Deliberately does NOT mint a real auth session in SQL - that is an Auth
-- API operation (supabase.auth.admin.generateLink + a separate verifyOtp
-- exchange), not something plpgsql can do. This migration only records the
-- audit trail and resolves WHICH user to impersonate; the actual session
-- minting happens server-side in the Next.js Server Action
-- (app/lib/impersonation.ts), using the service-role key - which this
-- migration's own functions never touch or need.
create table impersonation_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete set null,
  target_company_id uuid not null references companies(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete set null,
  -- Denormalised on purpose, captured once at start: an audit log should
  -- read as "what this looked like at the time", not drift if the company
  -- is later renamed or the member's email changes - and it lets the
  -- impersonation banner (app/_components/ImpersonationBanner.tsx) render
  -- straight off this one row with no extra join/RPC, using only the
  -- REAL admin's own session (which has no route to the target company's
  -- own name otherwise - companies is member-scoped RLS, not platform-admin-
  -- readable directly).
  target_company_name text not null check (length(target_company_name) between 1 and 200),
  target_user_email text not null check (length(target_user_email) between 1 and 320),
  reason text not null default 'Admin Diagnostics' check (length(reason) between 1 and 500),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
comment on table impersonation_audit_logs is
  'One row per "View Tenant Workspace" session a platform admin starts (Phase 4 Admin Command Center brief). Immutable except for ended_at, which only the SAME admin who started the row can set, once, via platform_admin_end_impersonation() - never a client insert/update/delete policy, same convention as notification_logs/system_alerts.';
comment on column impersonation_audit_logs.reason is
  'Free text, defaults to "Admin Diagnostics" when the admin does not type one - never blank, so every row has a stated purpose.';
comment on column impersonation_audit_logs.ended_at is
  'Null while the impersonation session is still open (the cookie has not been exited yet, or expired without an explicit exit - both are real, honest states, not fabricated). Set exactly once, by platform_admin_end_impersonation().';

create index impersonation_audit_logs_admin_idx on impersonation_audit_logs (admin_user_id, started_at desc);
create index impersonation_audit_logs_open_idx on impersonation_audit_logs (admin_user_id) where ended_at is null;
create index impersonation_audit_logs_company_idx on impersonation_audit_logs (target_company_id, started_at desc);

alter table impersonation_audit_logs enable row level security;
create policy "impersonation_audit_logs: platform admins can select" on impersonation_audit_logs
  for select to authenticated using (is_platform_admin());

-- Resolves WHICH user to impersonate for a company (the owner, else the
-- earliest-joined member - a company always has at least one member, per
-- 0001's own "every company gets an owner on creation" rule) and opens the
-- audit row. Returns the target's email too, purely so the Server Action
-- can hand it straight to the Auth API's generateLink() without a second
-- round trip.
create or replace function platform_admin_start_impersonation(p_company_id uuid, p_reason text default 'Admin Diagnostics')
returns table (audit_log_id uuid, target_user_id uuid, target_email text, company_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target_user_id uuid;
  v_target_email text;
  v_company_name text;
  v_audit_log_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'Only a Tender Tool platform admin can do this' using errcode = '42501';
  end if;

  select coalesce(csd_trading_name, legal_name) into v_company_name from companies where id = p_company_id;
  if v_company_name is null then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;

  select cm.user_id, u.email::text into v_target_user_id, v_target_email
  from company_members cm
  join auth.users u on u.id = cm.user_id
  where cm.company_id = p_company_id
  order by (cm.role = 'owner') desc, cm.created_at asc
  limit 1;
  if v_target_user_id is null then
    raise exception 'This company has no members to view as' using errcode = 'P0002';
  end if;

  insert into impersonation_audit_logs (admin_user_id, target_company_id, target_user_id, target_company_name, target_user_email, reason)
  values (auth.uid(), p_company_id, v_target_user_id, v_company_name, v_target_email, coalesce(trim(p_reason), ''))
    returning id into v_audit_log_id;
  -- Empty-string reason falls back to the column default - trim() above
  -- turns whitespace-only input into '', which the check constraint (length
  -- between 1 and 500) would otherwise reject outright instead of defaulting.
  if (select reason from impersonation_audit_logs where id = v_audit_log_id) = '' then
    update impersonation_audit_logs set reason = 'Admin Diagnostics' where id = v_audit_log_id;
  end if;

  return query select v_audit_log_id, v_target_user_id, v_target_email, v_company_name;
end;
$$;
comment on function platform_admin_start_impersonation(uuid, text) is
  'Opens one impersonation_audit_logs row for the given company (target = its owner, else earliest member) and returns the target user''s id/email for the caller''s own Auth API session-mint step. Platform-admin only.';
revoke all on function platform_admin_start_impersonation(uuid, text) from public;
grant execute on function platform_admin_start_impersonation(uuid, text) to authenticated;

create or replace function platform_admin_end_impersonation(p_audit_log_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_platform_admin() then
    raise exception 'Only a Tender Tool platform admin can do this' using errcode = '42501';
  end if;
  update impersonation_audit_logs
    set ended_at = now()
    where id = p_audit_log_id and admin_user_id = auth.uid() and ended_at is null;
end;
$$;
comment on function platform_admin_end_impersonation(uuid) is
  'Closes one impersonation_audit_logs row - pinned to admin_user_id = auth.uid() so an admin can only ever end their OWN session, and to ended_at is null so this is a no-op (not an error) if called twice. Platform-admin only.';
revoke all on function platform_admin_end_impersonation(uuid) from public;
grant execute on function platform_admin_end_impersonation(uuid) to authenticated;

-- The impersonation banner (rendered from the REAL admin's own untouched
-- session, never the swapped-in target-user session - see
-- app/lib/impersonation.ts's own header) needs to read back one open row by
-- id, scoped to itself. Plain select through the RLS policy above already
-- covers this (is_platform_admin() = true for the real admin reading their
-- own row) - no separate function needed.
