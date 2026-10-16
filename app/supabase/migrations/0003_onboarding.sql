-- Onboarding: lets a newly signed-in user with no company create one and become its
-- owner, in one atomic step.
--
-- 0001's own comment on `companies` is explicit: "No public insert policy: creating a
-- new company is a privileged, backend-mediated action (it must also create the first
-- company_members row atomically), not a bare client-side insert." This function is
-- that one privileged path - SECURITY DEFINER so it can insert into both tables
-- despite neither carrying a client-facing insert policy, but it only ever acts as
-- the calling user (auth.uid()), and only once per user (a user who already belongs
-- to a company can't create a second one through this function - company_members'
-- (company_id, user_id) unique constraint doesn't stop a user joining a *different*
-- company this way, so the explicit check below is what actually prevents it).
create or replace function create_company_and_join(p_legal_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
begin
  if auth.uid() is null then
    raise exception 'must be signed in';
  end if;
  if trim(coalesce(p_legal_name, '')) = '' then
    raise exception 'company name is required';
  end if;
  if exists (select 1 from company_members where user_id = auth.uid()) then
    raise exception 'this user already belongs to a company';
  end if;

  insert into companies (legal_name) values (trim(p_legal_name)) returning id into v_company_id;
  insert into company_members (company_id, user_id, role) values (v_company_id, auth.uid(), 'owner');

  return v_company_id;
end;
$$;

comment on function create_company_and_join(text) is
  'Onboarding: creates a company and makes the calling user its owner, atomically. The one deliberate exception to "no direct insert on companies/company_members" - see 0001.';

revoke all on function create_company_and_join(text) from public;
grant execute on function create_company_and_join(text) to authenticated;
