-- Opt-in flag for the role-based daily digest email (Sarel, 2026-10-20,
-- asked directly whether this should be auto-emailed to real customers:
-- "yes let's make this an optional email that the customer can decide if
-- they want to receive it.")
--
-- engine/notify/daily_digest.py already builds real, well-constructed
-- per-person/role/company digest content (see that script's own docstring)
-- but today has no concept of consent at all - it builds one for every
-- company_members row it reads, unconditionally, and (today) never sends
-- anything (confirmed by an earlier audit: no smtplib/sendgrid/resend/
-- nodemailer anywhere in this repo). Before wiring in real sending, this
-- adds the actual consent record, OFF by default (opt-in, never opt-out,
-- per Sarel's own wording above) - the digest script is changed in the same
-- piece of work to only build/consider a person whose flag is true
-- (engine/notify/daily_digest.py's filter_opted_in()).
--
-- Why company_members, not people: daily_digest.py's own docstring + roster
-- loader (load_roster_live(), this file's sibling 0010's own column) says
-- plainly that "one digest per person" means one per company_members row
-- (company_id, user_id, tender_role) - the signed-in account that would
-- actually receive an email. `people` (0001) is a completely different
-- thing: a company's CV/staffing roster (ECSA numbers, project history,
-- id_number) used to BUILD submission documents, most of whom have no
-- auth.users row and no email a digest could ever reach. Putting the flag
-- there would silently do nothing for the very people this digest is for.
--
-- Not a new table: this is one boolean, same shape as 0010's tender_role -
-- a single nullable-turned-default-false column on the existing per-user
-- row, not a new notification-preferences table. Revisit only if a second,
-- genuinely different notification type needs its own cadence/toggle later
-- (see this project's own scope-discipline rule, cited in 0010).

alter table company_members
  add column daily_digest_opt_in boolean not null default false;

comment on column company_members.daily_digest_opt_in is
  'Whether this person has opted IN to receiving the role-based daily digest email (engine/notify/daily_digest.py). Defaults to false - Sarel''s own instruction was an opt-in, not an opt-out, feature. Set only via set_my_daily_digest_opt_in() below (the /company page''s "Email notifications" toggle) or directly in Supabase; never set by the digest script itself.';

-- Self-service toggle, SECURITY DEFINER RPC rather than a blanket RLS update
-- policy on company_members: company_members has no existing "members can
-- update their own row" policy (only the 0001 select-your-own-roster one),
-- and a bare row-level update policy scoped to `user_id = auth.uid()` would
-- also let a member rewrite their OWN role/tender_role column - a privilege
-- escalation this repo's existing patterns (is_company_member(), the 0022/
-- 0042 owner-gated functions) deliberately avoid by writing a narrow
-- function instead of a wide policy. This function touches exactly one
-- column, on exactly the caller's own row, and nothing else.
create or replace function set_my_daily_digest_opt_in(p_opt_in boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_opt_in is null then
    raise exception 'daily_digest_opt_in must be true or false, not null' using errcode = '22023';
  end if;
  update company_members
     set daily_digest_opt_in = p_opt_in
   where user_id = auth.uid();
  if not found then
    raise exception 'No company_members row for the signed-in user' using errcode = 'P0002';
  end if;
end;
$$;
comment on function set_my_daily_digest_opt_in(boolean) is
  'Lets the signed-in user set THEIR OWN daily_digest_opt_in (and only that column, and only on their own company_members row(s) - auth.uid() scoped, never a company_id/user_id argument a caller could point at someone else). Used by the "Email notifications" toggle on /company. A user who belongs to more than one company (company_members has no such UI today, but the schema allows it - 0001''s own comment) opts every one of their memberships in/out together; see that same column''s own scoping if a later per-company choice is ever needed.';
revoke all on function set_my_daily_digest_opt_in(boolean) from public;
grant execute on function set_my_daily_digest_opt_in(boolean) to authenticated;
