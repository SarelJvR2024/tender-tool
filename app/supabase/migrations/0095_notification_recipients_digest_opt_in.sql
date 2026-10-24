-- Extends company_notification_recipients() (migration 0094) with
-- company_members.daily_digest_opt_in (migration 0073) - Tier 1/2's own
-- opt-in flag, distinct from Tier 0's lifecycle_email_opt_out. Needed so
-- scripts/send-operational-alerts.ts (PR #144) can be moved off
-- company_member_labels(), which migration 0094's own header comment
-- documents as returning ZERO rows for a service-role caller (auth.uid() is
-- NULL in that context) - a real, now-confirmed-live bug Sarel asked to be
-- fixed immediately (2026-10-24).
--
-- CREATE OR REPLACE can't change a function's OUT columns, so this drops and
-- recreates rather than replacing in place - same grants, same body shape,
-- one more column.
drop function if exists company_notification_recipients(uuid);

create or replace function company_notification_recipients(p_company_id uuid)
returns table (user_id uuid, email text, role text, lifecycle_email_opt_out boolean, daily_digest_opt_in boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cm.user_id, u.email::text, cm.role, cm.lifecycle_email_opt_out, cm.daily_digest_opt_in
  from company_members cm
  join auth.users u on u.id = cm.user_id
  where cm.company_id = p_company_id
$$;
comment on function company_notification_recipients(uuid) is
  'Every member (user_id, email, role, lifecycle_email_opt_out, daily_digest_opt_in) of ONE already-known company, for a service-role Tier 0/1/2/3 sender script resolving who to email. Deliberately NOT gated on auth.uid() - see migration 0094''s own header comment on why company_member_labels() (0033) cannot be reused here for a service-role caller. Service-role only (see grants below) - this returns real email addresses by company_id alone, with no session check, so it must never be reachable by anon/authenticated.';
revoke all on function company_notification_recipients(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function company_notification_recipients(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function company_notification_recipients(uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function company_notification_recipients(uuid) to service_role;
  end if;
end;
$$;
