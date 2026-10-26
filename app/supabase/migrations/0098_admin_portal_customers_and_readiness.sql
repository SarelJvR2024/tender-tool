-- System Admin Command Center brief (Sarel, 2026-10-25): extends the
-- existing super-admin customer console (0064) with the fields that brief
-- asked for on /admin/customers - plan tier + trial days remaining, vault
-- readiness score, CSD supplier number, active tenders count - rather than
-- inventing a parallel "Tenants & Companies Overview" page from scratch.
-- Issue review (/admin's system alerts) and notification logs (0093,
-- app/admin/notifications) cover the brief's other two tabs; this migration
-- is scoped to the customer-overview piece only.

-- ---------------------------------------------------------------------------
-- 1. platform_admin_companies(): add csd_supplier_number, subscription
--    status/plan/trial_ends_at, and active_tenders_count. CREATE OR REPLACE
--    can't change a function's OUT columns (same constraint 0095's own
--    header comment documents for company_notification_recipients) - drop
--    and recreate, same grants.
-- ---------------------------------------------------------------------------
drop function if exists platform_admin_companies();

create or replace function platform_admin_companies()
returns table (
  id uuid,
  legal_name text,
  csd_trading_name text,
  csd_supplier_number text,
  is_test_company boolean,
  created_at timestamptz,
  member_count bigint,
  people_count bigint,
  tenders_pursued_count bigint,
  active_tenders_count bigint,
  last_activity_at timestamptz,
  plan_tier text,
  subscription_status text,
  trial_ends_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id, c.legal_name, c.csd_trading_name, c.csd_supplier_number, c.is_test_company, c.created_at,
    (select count(*) from company_members cm where cm.company_id = c.id),
    (select count(*) from people p where p.company_id = c.id),
    (select count(*) from tender_packs tp where tp.company_id = c.id),
    -- "Active" = this company's own pack tracks a tender that hasn't closed
    -- yet (or carries no closing date at all - not yet known, so not yet
    -- excludable) - distinct from tenders_pursued_count above, which is
    -- every pack ever started, closed or not.
    (
      select count(*) from tender_packs tp
      join tenders t on t.id = tp.tender_id
      where tp.company_id = c.id and (t.closing_date is null or t.closing_date >= now())
    ),
    greatest(
      c.updated_at,
      (select max(tp.created_at) from tender_packs tp where tp.company_id = c.id)
    ),
    cs.plan_tier, cs.status, cs.trial_ends_at
  from companies c
  left join company_subscriptions cs on cs.company_id = c.id
  where is_platform_admin()
  order by c.created_at desc;
$$;
comment on function platform_admin_companies() is
  'Every company with member/people/pack counts, last activity, plan tier/trial/subscription status and CSD supplier number, for the super admin customer list (/admin/customers). Returns nothing unless the caller is a platform admin (0043).';
revoke all on function platform_admin_companies() from public;
grant execute on function platform_admin_companies() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. platform_admin_company_readiness_data(): the raw fields
--    lib/readiness.ts's computeBidReadiness() (a pure function, deliberately
--    never given its own Supabase call - see that file's own header
--    comment) needs, for an ARBITRARY company_id - the same shape
--    lib/companyReadinessData.ts's fetchCompanyReadiness() already reads via
--    RLS for the signed-in user's own company, but that relies entirely on
--    RLS scoping to "my own company" and cannot cross tenants. This mirrors
--    its exact query shape under is_platform_admin() instead, so
--    /admin/customers can show the same score computeBidReadiness() already
--    powers everywhere else (dashboard, Company vault, onboarding) - never a
--    second, differently-weighted "admin version" of bid readiness.
-- ---------------------------------------------------------------------------
create or replace function platform_admin_company_readiness_data(p_company_id uuid)
returns table (
  legal_name text,
  csd_supplier_number text,
  sars_tcs_pin text,
  sars_tcs_pin_expiry date,
  bee_level int,
  bee_proof_expiry date,
  cidb_grading text,
  cidb_expiry date,
  bank_confirmation_letter_valid_until date,
  principal_count bigint,
  people_with_cv_count bigint,
  experience_project_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.legal_name, c.csd_supplier_number, c.sars_tcs_pin, c.sars_tcs_pin_expiry,
    c.bee_level, c.bee_proof_expiry, c.cidb_grading, c.cidb_expiry,
    c.bank_confirmation_letter_valid_until,
    (select count(*) from company_principals cp where cp.company_id = c.id),
    (select count(distinct cu.person_id) from cv_uploads cu where cu.company_id = c.id),
    (select count(*) from experience_items ei where ei.company_id = c.id)
  from companies c
  where is_platform_admin() and c.id = p_company_id;
$$;
comment on function platform_admin_company_readiness_data(uuid) is
  'The raw fields lib/readiness.ts computeBidReadiness() needs for one company, for /admin/customers - the cross-tenant counterpart to lib/companyReadinessData.ts fetchCompanyReadiness(), which only works for the signed-in user''s own company via RLS. Returns nothing unless the caller is a platform admin.';
revoke all on function platform_admin_company_readiness_data(uuid) from public;
grant execute on function platform_admin_company_readiness_data(uuid) to authenticated;
