-- Standing review finding, 2026-11-06: the 'employee' role (0077) is
-- explicitly documented ("not see the company's tenders, pricing, bank
-- details or other people's records") and 0077's own Part C/D swept 16+
-- company-scoped tables to add a RESTRICTIVE "employee has no access"
-- policy for exactly that reason - but company_subscriptions (0078) and
-- start_payfast_checkout() (0078, replaced several times since, most
-- recently 0083) were both added AFTER that sweep and were never covered
-- by it. nav-items.ts's own EMPLOYEE_NAV_ITEMS comment states outright that
-- "RLS already blocks the data" for every page not in an employee's own
-- nav - a claim this migration makes true for Billing, not just repeats.
--
-- Reproduced directly in a disposable scratch database (never the live
-- DB): one company (plan 'professional'/'monthly', the real trial
-- default), one 'owner' member, one 'employee' member. Acting as the
-- employee (set role authenticated; set test.uid = '<employee uuid>',
-- engine/security's own stub convention):
--   * `select ... from company_subscriptions where company_id = ...` -
--     returned the real plan_tier/billing_interval/status/limits row (no
--     RESTRICTIVE policy at all on this table - only 0078's own PERMISSIVE
--     "members can view" select policy, true for every role including
--     employee).
--   * `select count(*) from company_members where company_id = ...` -
--     returned every roster row (2, not 1) - 0001's own "members can
--     select their own company's roster" policy was also never narrowed by
--     0077's sweep, so an employee sees every teammate's user_id/role, not
--     just their own.
--   * `select start_payfast_checkout('business', 'yearly')` - SUCCEEDED.
--     The function only checks "is there a company_subscriptions row for
--     ANY company_members row this auth.uid() holds" - no role check at
--     all. The call immediately updated the LIVE row: plan_tier
--     professional -> business, billing_interval monthly -> yearly,
--     max_users 5 -> 10, max_packs_per_month 15 -> 30 - all BEFORE any
--     PayFast payment, exactly the write path an 'employee' is supposed to
--     have zero reach into. This is a different bug from the open
--     start_payfast_checkout()-grants-before-ITN backlog item (that one is
--     about WHEN a legitimate owner/admin/member's checkout takes effect;
--     this is about WHO can trigger it at all).
--
-- Fixed the same additive-only, narrow-only way 0077 established: two new
-- RESTRICTIVE policies (for owner/admin/member, is_employee_in_company()
-- is false, so "not ... or ..." is unconditionally true and their access
-- is completely unchanged), plus a role check inside the function itself
-- (defense in depth - a RESTRICTIVE select policy on company_subscriptions
-- does not, by itself, stop a SECURITY DEFINER function with no row read
-- of its own from writing to a DIFFERENT table's row by company_id, which
-- is exactly what start_payfast_checkout() does to company_subscriptions).
--
-- Checked every real caller before narrowing company_members' own select
-- policy: every employee-reachable read in the app (AppShell, /my-cv's
-- page.tsx and actions.ts) already filters `.eq("user_id", user.id)` - the
-- caller's own row only - so this narrows nothing any employee-facing page
-- actually depended on. /billing's own unfiltered member-count query
-- degrades to counting just the employee's own row rather than erroring,
-- harmless since an employee is not meant to reach a working /billing page
-- at all once the two changes below are in place.

alter table company_subscriptions enable row level security;
create policy "company_subscriptions: employee has no access" on company_subscriptions
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));

create policy "company_members: employee restricted to own row" on company_members
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id) or user_id = auth.uid())
  with check (not is_employee_in_company(company_id) or user_id = auth.uid());

create or replace function start_payfast_checkout(p_plan_tier text, p_billing_interval text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_role text;
  v_m_payment_id text;
  v_max_users integer;
  v_max_packs integer;
begin
  if p_plan_tier not in ('starter', 'professional', 'business') then
    raise exception 'checkout is only for a self-serve plan (starter, professional or business) - enterprise is priced on request, not %', p_plan_tier using errcode = '22023';
  end if;
  if p_billing_interval not in ('monthly', 'yearly') then
    raise exception 'billing_interval must be monthly or yearly' using errcode = '22023';
  end if;

  select company_id, role into v_company_id, v_role from company_members where user_id = auth.uid() limit 1;
  if v_company_id is null then
    raise exception 'no company for the signed-in user' using errcode = 'P0002';
  end if;
  -- 2026-11-06: an 'employee' (0077) has no billing access at all - see this
  -- migration's own header. Checked here, not left to RLS alone, because
  -- this function writes company_subscriptions by company_id, never reading
  -- back a row RLS could have hidden first.
  if v_role = 'employee' then
    raise exception 'Billing is managed by your company''s owner or admin.' using errcode = '42501';
  end if;

  select max_users, max_packs_per_month into v_max_users, v_max_packs from tt_plan_limits(p_plan_tier);

  v_m_payment_id := encode(gen_random_bytes(24), 'hex');

  update company_subscriptions
     set payfast_m_payment_id = v_m_payment_id,
         plan_tier = p_plan_tier,
         billing_interval = p_billing_interval,
         max_users = v_max_users,
         max_packs_per_month = v_max_packs
   where company_id = v_company_id;
  if not found then
    raise exception 'no subscription row for this company' using errcode = 'P0002';
  end if;

  insert into payfast_payment_attempts (company_id, m_payment_id, plan_tier, billing_interval)
  values (v_company_id, v_m_payment_id, p_plan_tier, p_billing_interval);

  return v_m_payment_id;
end;
$$;
comment on function start_payfast_checkout(text, text) is
  'Called by the signed-in user from /billing before redirecting to PayFast. Rejects an employee-role caller (0117 - this role has no billing access at all). Sets the plan/interval the user picked (and, from tt_plan_limits(), that plan''s seat/volume limits) and issues a fresh unguessable payfast_m_payment_id, which the route handler embeds in the signed PayFast redirect and apply_payfast_itn() below later matches the ITN against. Also logs the id and plan to payfast_payment_attempts (0081/0082) so a successful payment under an id a LATER checkout attempt has since superseded can still be traced back to this company AND its correct plan.';
