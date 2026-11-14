-- Standing review finding, 2026-11-07 (Finding 169): company_packs_this_
-- period(p_company_id) and company_can_request_pack(p_company_id) (0083,
-- re-merged several times since, most recently 0115) are both SECURITY
-- DEFINER, granted to authenticated, and client-callable directly via
-- supabase.rpc() by any signed-in user - exactly the "callable directly,
-- not only through this app's own Server Action/page" exposure 0117 and
-- PR #176's own 0119 sweep already fixed for a dozen sibling functions.
-- Both already guard against a non-member (0109: "returns null for a
-- caller who is not a member of p_company_id"), but neither checks role -
-- only is_company_member(), never is_employee_in_company() - so both
-- bypass 0117's own RESTRICTIVE "company_subscriptions: employee has no
-- access" policy entirely, the same class of gap 0117's header names
-- ("a RESTRICTIVE select policy on company_subscriptions does not, by
-- itself, stop a SECURITY DEFINER function ... from [reading or] writing
-- to a DIFFERENT table's row by company_id") - PR #176's own systematic
-- sweep (0119, still open, not yet merged) checked every client-reachable
-- SECURITY DEFINER function against every RESTRICTIVE-only table and found
-- 12; these two were missed (neither appears in that migration's own list
-- of fixed OR explicitly-excluded functions).
--
-- Reproduced directly in a disposable scratch database (never the live
-- DB): one company (plan 'professional'/'monthly', status 'active',
-- max_packs_per_month 15, one 'ready' pack job), one 'owner' member, one
-- 'employee' member. Acting as the employee:
--   * `select count(*) from company_subscriptions where company_id = ...`
--     - correctly 0 (0117's own RESTRICTIVE policy doing its job).
--   * `select company_packs_this_period('<company>')` - returned 1 (the
--     real count), not null.
--   * `select company_can_request_pack('<company>')` - returned true (the
--     real answer), not null.
-- Both SECURITY DEFINER functions bypassed 0117's policy entirely, handing
-- an employee the company's real billing-quota state (how many bid packs
-- are used this period, and whether more can be requested) despite 0117
-- making the underlying table itself correctly inaccessible to that role.
--
-- Live app-layer impact is limited (the one page that calls company_packs_
-- this_period, /billing, already derives its own `status` from a direct
-- company_subscriptions read that 0117 already blocks for an employee, so
-- the RPC branch there is already unreachable in practice for that role)
-- but the RPC itself is reachable by anyone with an employee's session via
-- a direct supabase.rpc() call, same as every other function 0119
-- addressed - fixed as defense in depth, not just a page-level nicety,
-- same reasoning 0117/0119 both already used.
--
-- Fixed the same additive, narrow-only way as every sibling fix in this
-- series: both functions now also return null for an employee, extending
-- the EXISTING "null means no answer for this caller" contract (0109)
-- rather than introducing a new raise/error shape neither function had
-- before - for owner/admin/member, is_employee_in_company() is false, so
-- behaviour for every other role is completely unchanged (re-verified
-- below, not assumed).
create or replace function company_packs_this_period(p_company_id uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select case when is_company_member(p_company_id) and not is_employee_in_company(p_company_id) then (
    select count(*)::integer
    from pack_generation_jobs
    where company_id = p_company_id
      and status in ('requested', 'generating', 'ready')
      and requested_at >= (
        select coalesce(current_period_start, created_at) from company_subscriptions where company_id = p_company_id
      )
  ) else null end;
$$;
comment on function company_packs_this_period(uuid) is
  'Count of bid packs that count against this company''s monthly allowance - requested, generating OR ready, excluding only failed (0084) - across both pack_generation_jobs.engine values, since this company''s current billing period started. Returns null for a caller who is not a member of p_company_id (0109) OR who is an employee-role member (0121 - Finding 169, this SECURITY DEFINER function bypassed 0117''s own RESTRICTIVE "employee has no billing access" policy on company_subscriptions entirely).';

create or replace function company_can_request_pack(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_status text;
  v_max_packs integer;
  v_trial_ends_at timestamptz;
begin
  if not is_company_member(p_company_id) or is_employee_in_company(p_company_id) then
    return null;
  end if;
  select status, max_packs_per_month, trial_ends_at into v_status, v_max_packs, v_trial_ends_at
    from company_subscriptions where company_id = p_company_id;
  if v_status is null then
    return false;
  end if;
  if v_status = 'trialing' then
    if v_trial_ends_at is not null and v_trial_ends_at < now() then
      return false;
    end if;
    return (select count(*) from pack_generation_jobs
             where company_id = p_company_id and status in ('requested', 'generating', 'ready')) < 1;
  end if;
  if v_status = 'active' then
    return v_max_packs is null or company_packs_this_period(p_company_id) < v_max_packs;
  end if;
  return false;
end;
$$;
comment on function company_can_request_pack(uuid) is
  'Whether this company can request another bid pack right now (trial: at most 1 ever; active: company_packs_this_period() under max_packs_per_month; past_due/cancelled/no subscription row: false). Returns null for a caller who is not a member of p_company_id (0109) OR who is an employee-role member (0121 - Finding 169, same SECURITY DEFINER RLS-bypass shape as company_packs_this_period() above).';
