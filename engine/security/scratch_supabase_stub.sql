-- Minimal Supabase stand-in for replaying app/supabase/migrations/*.sql
-- against a plain (non-Supabase) scratch Postgres 16 — e.g. a GitHub Actions
-- `services: postgres` container, or any ad-hoc local Postgres.
--
-- Real Supabase projects already have all of this (auth schema, roles,
-- Storage schema, default grants) in place before a single migration ever
-- runs. A vanilla Postgres image has none of it, so the migrations — which
-- reference auth.uid()/auth.users and storage.objects/storage.foldername(),
-- and assume RLS is already enabled on both storage tables — fail outright
-- without this file applied FIRST, on a FRESH database.
--
-- This is the recipe docs/specs/POPIA-Security-Audit.md's "How to re-run"
-- section has described in prose since the first manual run of
-- engine/security/test_tenant_isolation.py's Part 2 (and reused by hand for
-- test_manual_intake.py / test_discovery_fanout.py / test_taxonomy.py /
-- test_principals_registrations.py / test_system_alerts.py / others) —
-- including two lessons earlier manual passes only found by trial and error
-- (docs/specs/System-Status.md, 2026-10-17/18 check-ins):
--   1. default privilege grants on schema public MUST be applied BEFORE the
--      migrations run, not after - a blanket GRANT ALL applied afterwards
--      clobbers a migration's own deliberate narrower REVOKE (0043).
--   2. anon/authenticated need USAGE on schema auth, not just EXECUTE on
--      auth.uid() - Supabase grants that by default so auth.uid() can be
--      called from a SECURITY INVOKER policy expression.
-- This file is the first time that recipe is captured as something runnable
-- instead of re-derived by hand each time.
--
-- Usage: run this on a brand-new, empty database, THEN replay every file in
-- app/supabase/migrations/ in filename order. See replay_schema.sh.

-- ---------------------------------------------------------------------------
-- Roles (Supabase's standard four; CI connects as the ordinary superuser
-- role of the postgres:16 service image, which can SET ROLE to any of these
-- with no prior membership grant needed).
--
-- Roles are CLUSTER-global, not per-database - a fresh CI container only
-- ever sees this run once, but any local/CI reuse of a persistent Postgres
-- instance across more than one scratch database hits this: the second
-- database's own replay would find service_role already exists (created
-- against the FIRST database) and skip `create role ... bypassrls`
-- entirely, since that only runs inside `if not exists`. Found during this
-- session's enterprise-readiness audit - not exploitable in the real CI job
-- (fresh container every run) or the real Supabase project (the platform
-- sets these natively), but worth hardening so a false-safe test result
-- can't happen from stale cluster-level role state. The ALTER ROLE lines
-- below run unconditionally, every time this stub is applied, so the
-- properties these tests actually rely on are correct regardless of
-- whether the role was just created here or already existed.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;
alter role anon nologin noinherit;
alter role authenticated nologin noinherit;
alter role service_role nologin noinherit bypassrls;

-- ---------------------------------------------------------------------------
-- auth schema: just enough for the migrations' own FKs/trigger functions
-- (auth.users(id), auth.uid()). Real Supabase's auth.users has dozens of
-- columns; nothing here reads any of them beyond id/email.
-- ---------------------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- Tests drive this with set_config('test.uid', '<uuid>', ...) under
-- `set [local] role authenticated` - see engine/security/test_tenant_isolation.py's
-- Db.run(). A real Supabase auth.uid() reads the JWT claim; this reads the
-- session GUC the tests set instead, which is the whole point of the stub.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role, public;

-- ---------------------------------------------------------------------------
-- storage schema: buckets/objects + foldername(), the slice the migrations'
-- own Storage RLS policies and record_tender_document()/0043 checks use.
-- Real Supabase enables RLS on both tables platform-side (no migration
-- here ever does it) and ships storage.foldername() built in.
-- ---------------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb
);

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1 : greatest(array_length(_parts, 1) - 1, 0)];
end
$$;

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
grant execute on function storage.foldername(text) to anon, authenticated, service_role, public;

-- service_role (BYPASSRLS above) and the connecting superuser can always see
-- every row/object; anon/authenticated are governed entirely by the
-- policies each migration creates on top of this (none exist yet at this
-- point in the replay).

-- ---------------------------------------------------------------------------
-- Baseline default privileges on schema public - applied BEFORE any
-- migration creates a single table, so every table/sequence/function a
-- migration creates lands already granted to anon/authenticated/
-- service_role, exactly like a real Supabase project (whose platform sets
-- these defaults once, before any user migration ever runs). A migration's
-- own narrower REVOKE/GRANT (0043) then applies on top and sticks, instead
-- of being clobbered by a blanket grant applied afterwards.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on routines to anon, authenticated, service_role;
