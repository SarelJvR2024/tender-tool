-- Team invites + a restricted "employee" role (Sarel, 2026-10-19).
--
-- Two asks: (1) an easy way for an owner/admin to add a teammate to their
-- company with a role, (2) a new "employee" role for someone who should
-- only review/update THEIR OWN CV, qualifications and documents - not see
-- the company's tenders, pricing, bank details or other people's records.
--
-- Architectural note: this Next.js app never holds the Supabase service-role
-- key (only engine/*, the bridge workers, do - see docs/specs/System-Status.md
-- and every "service role" comment in supabase/migrations). It therefore
-- CANNOT call Supabase's admin inviteUserByEmail API. This migration backs a
-- share-a-link invite instead: an owner/admin creates a company_invites row
-- (a bearer token), copies the link, and sends it however they like; the
-- invitee opens /invite/<token> signed in (or signs up first) and redeems it
-- themselves. No email is ever sent by this app.
--
-- Part A: company_invites + redeem_company_invite() - the invite flow.
-- Part B: the 'employee' role itself (company_members check constraint,
--   people.linked_user_id to tie a roster entry to a real login).
-- Part C: RLS hardening. The existing tenant-isolation policies
--   (is_company_member(company_id), PERMISSIVE) give every member - now
--   including 'employee' - full read/write on the whole company's data.
--   That is the actual gap behind "review his own CV ... not" everyone
--   else's. Fixed with ADDITIONAL RESTRICTIVE policies (AS RESTRICTIVE: a
--   Postgres policy set is permissive-OR'd then AND'd with every restrictive
--   one), which can only narrow access, never widen it - for owner/admin/
--   member the restrictive check below is simply always true, so their
--   access is completely unchanged. Nothing here drops, replaces or alters
--   any existing policy; every statement is additive.
--
-- See docs/specs/POPIA-Security-Audit.md for the audit this project already
-- did and the SECURITY DEFINER conventions (search_path pinned, revoke all /
-- grant execute to authenticated) this migration follows exactly.

-- ---------------------------------------------------------------------------
-- Part A: company_invites
-- ---------------------------------------------------------------------------

create table company_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  -- For the inviter's own reference only ("who did I send this to") - never
  -- validated, never used to send mail. The link itself is what's shared.
  email text,
  role text not null check (role in ('owner', 'admin', 'member', 'employee')),
  -- Optional: "this invite is for Jane Smith" (an existing people row).
  -- Accepting it links that roster entry to the accepting auth account
  -- (people.linked_user_id). Null = "join as a new team member, no existing
  -- person record yet".
  linked_person_id uuid references people(id) on delete set null,
  -- Bearer credential for /invite/<token> - looked up only through the
  -- SECURITY DEFINER redeem_company_invite() below, never by a direct table
  -- read, since knowing the token is what grants the join.
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);
comment on table company_invites is
  'A share-a-link invite to join a company with a given role. This app has no service-role key, so it cannot call Supabase''s admin invite-by-email API - an owner/admin creates this row, copies the /invite/<token> link, and sends it by whatever channel they like. Redeemed only through redeem_company_invite(), never by a direct client read of the token.';

create index company_invites_company_idx on company_invites (company_id, created_at desc);

alter table company_invites enable row level security;

-- Owners/admins of the company manage its own invites. tt_is_company_admin()
-- (0050) already does exactly the "owner or admin of this company" check
-- this needs - reused rather than duplicated.
create policy "company_invites: admins manage their company's invites" on company_invites
  for all to authenticated
  using (tt_is_company_admin(company_id))
  with check (tt_is_company_admin(company_id));

create or replace function redeem_company_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite company_invites;
  v_uid uuid := auth.uid();
  v_person_owner uuid;
begin
  -- Caller must be signed in. The calling Server Action is responsible for
  -- sending a signed-out visitor to /login?next=/invite/<token> first - this
  -- function only ever runs as an authenticated role, so it raises rather
  -- than silently doing nothing if that ever isn't true.
  if v_uid is null then
    raise exception 'Sign in before accepting this invite.';
  end if;

  select * into v_invite from company_invites where token = p_token;
  if v_invite.id is null then
    raise exception 'This invite link is not valid.';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'This invite has already been used.';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'This invite has expired. Ask whoever sent it for a new one.';
  end if;

  -- Join the company. A user who somehow already belongs (re-opens an old
  -- link, or was separately added in the meantime) has their role updated
  -- to the one this invite offers rather than erroring - redeeming a valid
  -- invite should never dead-end on "you're already in", and the inviter
  -- clearly intends this role for them.
  insert into company_members (company_id, user_id, role)
  values (v_invite.company_id, v_uid, v_invite.role)
  on conflict (company_id, user_id) do update set role = excluded.role;

  if v_invite.linked_person_id is not null then
    select linked_user_id into v_person_owner from people where id = v_invite.linked_person_id;
    if v_person_owner is not null and v_person_owner <> v_uid then
      -- Don't silently steal someone else's roster link - this would only
      -- happen if the same person row were pointed at by two accepted
      -- invites, which createInvite's own form doesn't offer, but the
      -- function stays safe against it regardless.
      raise exception 'That roster entry is already linked to a different account.';
    end if;
    update people set linked_user_id = v_uid where id = v_invite.linked_person_id and company_id = v_invite.company_id;
  end if;

  update company_invites
  set accepted_at = now(), accepted_by = v_uid
  where id = v_invite.id;

  return v_invite.company_id;
end;
$$;
comment on function redeem_company_invite(text) is
  'Redeems a company_invites token for the signed-in user: joins company_members with the invite''s role, links people.linked_user_id if the invite named a person, marks the invite accepted. The only way the token is ever looked up - never a direct table read, since the token is a bearer credential.';
revoke all on function redeem_company_invite(text) from public;
grant execute on function redeem_company_invite(text) to authenticated;

-- A safe, read-only preview for the /invite/<token> page itself ("Join
-- Acme Pty Ltd as an employee") - still never a direct table read of
-- company_invites (whose only policy is "admins of that company", which a
-- brand-new invitee never is). Returns nothing about an expired or already-
-- accepted invite beyond that fact, and nothing at all for an unknown token.
create or replace function invite_preview(p_token text)
returns table (company_name text, role text, is_expired boolean, is_accepted boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.legal_name, ci.role, ci.expires_at < now(), ci.accepted_at is not null
  from company_invites ci
  join companies c on c.id = ci.company_id
  where ci.token = p_token;
$$;
comment on function invite_preview(text) is
  'Read-only preview of an invite link for the /invite/<token> page (company name, role, expired/accepted flags) - lets that page render before the visitor is signed in, without ever exposing company_invites to a direct client read.';
revoke all on function invite_preview(text) from public;
grant execute on function invite_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Part B: the 'employee' role
-- ---------------------------------------------------------------------------

alter table company_members drop constraint company_members_role_check;
alter table company_members add constraint company_members_role_check
  check (role in ('owner', 'admin', 'member', 'employee'));

alter table people add column linked_user_id uuid references auth.users(id) on delete set null;
comment on column people.linked_user_id is
  'The auth account of the actual person this roster row is about, if they have a login of their own - set when they accept a team invite tied to this person (redeem_company_invite), or when an owner/admin links an existing person to an existing account by hand. Most people rows have no login at all (a CV on file for someone who never signs in), so this is nullable and usually null. Used to scope an "employee" role member to their own record (own_linked_person_id below) and to resolve the My CV page.';

-- An owner/admin may want to link an EXISTING person to an EXISTING account
-- without going through an invite (e.g. the person already has a login from
-- some other company context, or was added by hand before this feature).
-- No new RLS is needed for that: it's a plain update of people.linked_user_id,
-- already covered by the existing "people: tenant isolation" policy - any
-- company member can write it today, same as every other people column, and
-- that is unchanged by this migration.

-- ---------------------------------------------------------------------------
-- Part C: RLS hardening for the employee role
-- ---------------------------------------------------------------------------

-- True when the signed-in user's role in this company is 'employee'.
create or replace function is_employee_in_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from company_members
    where company_id = p_company_id and user_id = auth.uid() and role = 'employee'
  );
$$;
comment on function is_employee_in_company(uuid) is
  'True when the signed-in user is an employee-role member of this company (0065 employee role). Used only to narrow access via RESTRICTIVE policies - never to grant it.';
revoke all on function is_employee_in_company(uuid) from public;
grant execute on function is_employee_in_company(uuid) to authenticated;

-- The people.id of the signed-in user's own linked roster row in this
-- company, or null if they have none (e.g. an owner/admin/member who was
-- never linked to a person - the restrictive checks below treat "no linked
-- person" as "no rows match", not as "unrestricted").
create or replace function own_linked_person_id(p_company_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from people where company_id = p_company_id and linked_user_id = auth.uid();
$$;
comment on function own_linked_person_id(uuid) is
  'The people.id linked to the signed-in user in this company (people.linked_user_id), or null. Used only to narrow an employee''s access to their own record via RESTRICTIVE policies (0065).';
revoke all on function own_linked_person_id(uuid) from public;
grant execute on function own_linked_person_id(uuid) to authenticated;

-- -- Person-scoped tables: an employee may use only their own linked
-- person's rows. For owner/admin/member, is_employee_in_company() is false,
-- so "not is_employee_in_company(...)" is true and the restrictive check
-- passes unconditionally - their access is exactly what it was before this
-- migration.

create policy "people: employee restricted to own record" on people
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id) or id = own_linked_person_id(company_id))
  with check (not is_employee_in_company(company_id) or id = own_linked_person_id(company_id));

create policy "projects: employee restricted to own person" on projects
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id) or person_id = own_linked_person_id(company_id))
  with check (not is_employee_in_company(company_id) or person_id = own_linked_person_id(company_id));

create policy "cv_uploads: employee restricted to own person" on cv_uploads
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id) or person_id = own_linked_person_id(company_id))
  with check (not is_employee_in_company(company_id) or person_id = own_linked_person_id(company_id));

create policy "generated_cvs: employee restricted to own person" on generated_cvs
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id) or person_id = own_linked_person_id(company_id))
  with check (not is_employee_in_company(company_id) or person_id = own_linked_person_id(company_id));

create policy "cv_extraction_results: employee restricted to own person" on cv_extraction_results
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id) or person_id = own_linked_person_id(company_id))
  with check (not is_employee_in_company(company_id) or person_id = own_linked_person_id(company_id));

create policy "person_role_eligibility: employee restricted to own person" on person_role_eligibility
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id) or person_id = own_linked_person_id(company_id))
  with check (not is_employee_in_company(company_id) or person_id = own_linked_person_id(company_id));

-- Every other tenant table: an employee sees none of it, no exception.
-- Company-wide business data (tenders, pricing, bank accounts, directors,
-- registrations, properties, generated documents, internal notes) is simply
-- not what an employee role is for.

-- tenders (0001/0024) isn't a per-company table at all - owner_company_id is
-- null for every shared SANRAL/eTenders row and set only for a company's own
-- manually-loaded one. Rather than guess at a column shape it doesn't have,
-- this just hides every tenders row - shared or private - from anyone whose
-- role is 'employee' in ANY company: the whole discovery/pipeline feature is
-- out of scope for that role, not just other companies' tenders.
create policy "tenders: employee has no access" on tenders
  as restrictive
  for all to authenticated
  using (not exists (select 1 from company_members cm where cm.user_id = auth.uid() and cm.role = 'employee'))
  with check (not exists (select 1 from company_members cm where cm.user_id = auth.uid() and cm.role = 'employee'));

create policy "tender_packs: employee has no access" on tender_packs
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));

create policy "tender_pack_assignments: employee has no access" on tender_pack_assignments
  as restrictive
  for all to authenticated
  using (not exists (
    select 1 from tender_packs tp where tp.id = tender_pack_assignments.tender_pack_id and is_employee_in_company(tp.company_id)
  ))
  with check (not exists (
    select 1 from tender_packs tp where tp.id = tender_pack_assignments.tender_pack_id and is_employee_in_company(tp.company_id)
  ));

create policy "tender_tasks: employee has no access" on tender_tasks
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));

create policy "financial_captures: employee has no access" on financial_captures
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));

create policy "generated_documents: employee has no access" on generated_documents
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));

create policy "pack_generation_jobs: employee has no access" on pack_generation_jobs
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));

create policy "tender_comments: employee has no access" on tender_comments
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));

create policy "tender_private_documents: employee has no access" on tender_private_documents
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));

create policy "experience_items: employee has no access" on experience_items
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));

create policy "companies: employee has no access" on companies
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(id))
  with check (not is_employee_in_company(id));

create policy "bank_accounts: employee has no access" on bank_accounts
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));

create policy "company_principals: employee has no access" on company_principals
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));

create policy "held_registrations: employee has no access" on held_registrations
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));

create policy "company_properties: employee has no access" on company_properties
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));

create policy "property_documents: employee has no access" on property_documents
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));
