-- Standing review finding, 2026-11-09 (Finding 303). platform_admin_billing_
-- overview() (0101) computes its own "packs used this period" column by
-- calling company_packs_this_period(c.id) once per company row. 0109 (2026-
-- 11-03, "membership check hardening") added an is_company_member(p_company_id)
-- guard to company_packs_this_period() itself, so a company member can't read
-- a DIFFERENT company's own quota by just passing a different company_id to
-- the RPC directly - correct for that function's own two real callers (a
-- company's own /billing page; request_submission_pack_checked()/request_
-- general_job_checked()'s quota gate), both of which always act on behalf of
-- an actual member of the company being checked.
--
-- platform_admin_billing_overview() is a third, different caller, added
-- before that guard existed (0101 predates 0109) and never revisited once it
-- did: it calls company_packs_this_period() once per row while iterating
-- EVERY company on the platform, as the platform admin's own auth.uid() -
-- and a platform admin is explicitly never a company member by construction
-- ("Tender Tool's own staff... not a customer role - a company owner is NOT
-- a platform admin", 0043's own comment on the platform_admins table). So
-- is_company_member(p_company_id) returns false for the admin against every
-- company they don't personally happen to belong to - in practice, virtually
-- every row - and company_packs_this_period() silently returns NULL for each
-- one, with no error anywhere. /admin/billing's own "Packs this period"
-- column (app/app/admin/billing/page.tsx: `{r.packs_used_this_period} /
-- {max}`) renders blank before the slash for almost every company on the
-- platform's own billing overview - the admin console's one revenue/quota
-- oversight screen.
--
-- Reproduced directly in a disposable scratch database (engine/security/
-- replay_schema.sh against a fresh db): a platform_admins row with no
-- matching company_members row anywhere, a company with an active
-- subscription and one real 'requested' pack_generation_jobs row (confirmed
-- counting toward its quota via company_can_request_pack()). As that admin
-- (`set role authenticated; select set_config('test.uid', ..., false)`):
-- is_platform_admin() -> true, is_company_member(that company) -> false,
-- company_packs_this_period(that company) -> NULL (not 1), and
-- platform_admin_billing_overview()'s own packs_used_this_period column for
-- that row -> NULL, confirming the exact same gap end to end through the
-- real RPC the admin page calls.
--
-- Fixed by inlining the same counting rule 0084/0115 already established
-- (status in requested/generating/ready, counted from the start of the
-- current billing period: current_period_start, or created_at for a company
-- that has never had a period boundary written) directly inside platform_
-- admin_billing_overview(), under its own pre-existing is_platform_admin()
-- gate, instead of delegating to the member-gated helper. company_packs_
-- this_period() itself is untouched - its own two real callers still need
-- and keep the membership guard exactly as 0109/0115 left it; only this one
-- caller, which by construction never is a member of the company it's
-- reading, stops routing through it.
create or replace function platform_admin_billing_overview()
returns table (
  company_id uuid,
  legal_name text,
  csd_trading_name text,
  is_test_company boolean,
  plan_tier text,
  billing_interval text,
  status text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  max_packs_per_month integer,
  packs_used_this_period integer,
  has_payfast_token boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id, c.legal_name, c.csd_trading_name, c.is_test_company,
    cs.plan_tier, cs.billing_interval, cs.status, cs.trial_ends_at, cs.current_period_end,
    cs.max_packs_per_month,
    (
      select count(*)::integer
      from pack_generation_jobs j
      where j.company_id = c.id
        and j.status in ('requested', 'generating', 'ready')
        and j.requested_at >= coalesce(cs.current_period_start, c.created_at)
    ),
    cs.payfast_token is not null
  from companies c
  join company_subscriptions cs on cs.company_id = c.id
  where is_platform_admin()
  order by c.created_at desc;
$$;
comment on function platform_admin_billing_overview() is
  'Billing tab''s own data: plan, status, quota usage and whether a PayFast token is on file, per company. packs_used_this_period is computed INLINE here (same rule as company_packs_this_period(), 0084/0115 - requested/generating/ready, counted since current_period_start or created_at) rather than by calling that function: 0109 gave company_packs_this_period() an is_company_member() guard for its own two real callers (a company''s own /billing page; the pack-quota request gate), but a platform admin viewing THIS page is never a member of the company being viewed (platform_admins is explicitly not a customer role, 0043) - delegating to the guarded function made this column silently NULL for virtually every company (Finding 303, 2026-11-09). Pricing itself is never computed here - the caller applies lib/billing.ts''s already-tested PLAN_MONTHLY_ZAR/priceForPlanZar/effectiveSubscriptionStatus to these raw columns, so there is exactly one place a price or a lapsed-trial rule lives.';
revoke all on function platform_admin_billing_overview() from public;
grant execute on function platform_admin_billing_overview() to authenticated;
