-- Service-role-safe recipient lookup for the Tier 0 nudge/trial-lifecycle
-- script and Tier 3 founder-digest/Quality-Scout scripts (migration 0093's
-- own notification_claims/notification_logs engine, now getting its
-- candidate-selection + schedule layer wired - see docs/specs/System-Status.md's
-- "still open, not done in this pass" note on 0093).
--
-- Real bug found while wiring this, NOT fixed here (out of scope - a
-- different, already-merged script's own behaviour, flagged honestly rather
-- than silently reached into): company_member_labels() (migration 0033)
-- gates its own WHERE clause on is_company_member(cm.company_id), which
-- checks company_members.user_id = auth.uid() - and is_platform_admin()
-- (0043) does the same shape of auth.uid() check. auth.uid() reads the JWT's
-- "sub" claim, which a service-role-authenticated PostgREST request's JWT
-- never carries (well-established Supabase behaviour - service_role bypasses
-- RLS, it does not forge a user identity) - so BOTH company_member_labels()
-- and platform_admin_companies() (0064) silently return ZERO rows for any
-- service-role caller, always. scripts/send-operational-alerts.ts (PR #144,
-- live) already calls company_member_labels() this exact way, so it is very
-- likely sending to zero recipients for every alert today - a real
-- reliability bug, not touched in this migration (a different session's
-- already-merged, already-scheduled script; Sarel's own call whether to fix
-- it there too). This migration's own new function below deliberately does
-- NOT depend on auth.uid() at all, so the new Tier 0/3 scripts this migration
-- supports do not inherit the same bug.
--
-- company_notification_recipients(p_company_id) takes company_id as an
-- explicit argument rather than deriving it from auth.uid() - safe because
-- every caller (a service-role script) already knows which company_id it is
-- about to email, from its own candidate-selection query; this function only
-- answers "who are THIS already-known company's members", it never lets a
-- caller discover a company_id it didn't already have. Returns real email
-- addresses, so (same reasoning as record_system_alert, 0042) it is granted
-- to service_role only, explicitly - not to anon or authenticated, which
-- would let any signed-in user enumerate another company's member emails by
-- guessing/passing an arbitrary company_id.
create or replace function company_notification_recipients(p_company_id uuid)
returns table (user_id uuid, email text, role text, lifecycle_email_opt_out boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select cm.user_id, u.email::text, cm.role, cm.lifecycle_email_opt_out
  from company_members cm
  join auth.users u on u.id = cm.user_id
  where cm.company_id = p_company_id
$$;
comment on function company_notification_recipients(uuid) is
  'Every member (user_id, email, role, lifecycle_email_opt_out) of ONE already-known company, for a service-role Tier 0/3 sender script resolving who to email. Deliberately NOT gated on auth.uid() - see this migration''s own header comment on why company_member_labels() (0033) cannot be reused here for a service-role caller. Service-role only (see grants below) - this returns real email addresses by company_id alone, with no session check, so it must never be reachable by anon/authenticated.';
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
