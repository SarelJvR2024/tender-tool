-- Super admin portal, part 1: customer management + system settings
-- (Sarel, 2026-10-19: "build my super admin portal to manage customers,
-- system settings, review of issues, and where we can fix issues picked
-- up"). Issue review already exists (/admin's System alerts + harness
-- results, 0042/0022) - this migration adds the other two.
--
-- Every function here is gated by is_platform_admin() (0043) and is
-- SECURITY DEFINER so it can read across every tenant - the same escape
-- hatch admin_harness_runs and system_alerts already use, deliberately not
-- extended to the companies/company_members RLS policies themselves
-- (0001's "members can select/update" stays exactly as-is, so this adds
-- nothing a company member couldn't already reach for their own company).

-- ---------------------------------------------------------------------------
-- 1. Customer overview, for /admin/customers
-- ---------------------------------------------------------------------------
create or replace function platform_admin_companies()
returns table (
  id uuid,
  legal_name text,
  csd_trading_name text,
  is_test_company boolean,
  created_at timestamptz,
  member_count bigint,
  people_count bigint,
  tenders_pursued_count bigint,
  last_activity_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id, c.legal_name, c.csd_trading_name, c.is_test_company, c.created_at,
    (select count(*) from company_members cm where cm.company_id = c.id),
    (select count(*) from people p where p.company_id = c.id),
    (select count(*) from tender_packs tp where tp.company_id = c.id),
    greatest(
      c.updated_at,
      (select max(tp.created_at) from tender_packs tp where tp.company_id = c.id)
    )
  from companies c
  where is_platform_admin()
  order by c.created_at desc;
$$;
comment on function platform_admin_companies() is
  'Every company with member/people/pack counts and last activity, for the super admin customer list (/admin/customers). Returns nothing unless the caller is a platform admin (0043).';
revoke all on function platform_admin_companies() from public;
grant execute on function platform_admin_companies() to authenticated;

create or replace function platform_admin_company_members(p_company_id uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cm.user_id, coalesce(u.email::text, '(no email on file)'), cm.role, cm.created_at
  from company_members cm
  join auth.users u on u.id = cm.user_id
  where is_platform_admin() and cm.company_id = p_company_id
  order by cm.created_at asc;
$$;
comment on function platform_admin_company_members(uuid) is
  'A company''s members by e-mail, for the super admin customer detail view. Returns nothing unless the caller is a platform admin.';
revoke all on function platform_admin_company_members(uuid) from public;
grant execute on function platform_admin_company_members(uuid) to authenticated;

-- Toggle is_test_company from the admin console instead of leaving it, per
-- 0007's own comment, with "no UI sets this yet". A SECURITY DEFINER
-- function rather than a new companies RLS policy: company members already
-- have a blanket UPDATE policy on their own row (0001), so widening that
-- policy would risk more than this needs - this only ever touches the one
-- column, and only for a platform admin.
create or replace function platform_admin_set_test_company(p_company_id uuid, p_is_test boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_platform_admin() then
    raise exception 'Only a Tender Tool platform admin can do this' using errcode = '42501';
  end if;
  update companies set is_test_company = p_is_test, updated_at = now() where id = p_company_id;
end;
$$;
revoke all on function platform_admin_set_test_company(uuid, boolean) from public;
grant execute on function platform_admin_set_test_company(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Platform settings, for /admin/settings
-- ---------------------------------------------------------------------------
create table platform_settings (
  key text primary key,
  value jsonb not null,
  description text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
comment on table platform_settings is
  'Small set of platform-wide switches a Tender Tool admin can flip without a deploy. Read/written only through the platform_admin_* functions below, which gate on is_platform_admin() - no client policy grants direct table access.';
alter table platform_settings enable row level security;

insert into platform_settings (key, value, description) values
  ('signups_enabled', 'true'::jsonb,
   'When off, the public sign-up page tells visitors sign-ups are paused instead of creating an account. Existing customers can still sign in.');

create or replace function platform_admin_settings()
returns table (key text, value jsonb, description text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.key, s.value, s.description, s.updated_at
  from platform_settings s
  where is_platform_admin()
  order by s.key;
$$;
revoke all on function platform_admin_settings() from public;
grant execute on function platform_admin_settings() to authenticated;

create or replace function platform_admin_set_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_platform_admin() then
    raise exception 'Only a Tender Tool platform admin can do this' using errcode = '42501';
  end if;
  update platform_settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = p_key;
  if not found then
    raise exception 'Unknown platform setting: %', p_key using errcode = '22023';
  end if;
end;
$$;
revoke all on function platform_admin_set_setting(text, jsonb) from public;
grant execute on function platform_admin_set_setting(text, jsonb) to authenticated;

-- Read by the public sign-up page (anon + authenticated, nobody is signed in
-- yet) - the one setting above that actually needs to be, so it is the only
-- one not gated behind is_platform_admin().
create or replace function signups_enabled()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select (value #>> '{}')::boolean from platform_settings where key = 'signups_enabled'), true);
$$;
revoke all on function signups_enabled() from public;
grant execute on function signups_enabled() to anon, authenticated;
