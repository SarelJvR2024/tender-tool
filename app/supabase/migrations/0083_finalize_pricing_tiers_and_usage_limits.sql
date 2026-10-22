-- Sarel confirmed the final pricing (2026-10-22, in chat): Starter R1,490/mo,
-- Professional R2,990/mo, Business R4,990/mo, Enterprise (custom, priced on
-- request, not self-serve) - full feature parity across every tier, plans
-- differing only by seat count and monthly bid-pack volume. This replaces
-- 0078's watch/pro/sanral_pro naming, which was itself only ever a stand-in:
-- lib/billing.ts's own header comment says outright those names were copied
-- from app/page.tsx's PRICING_TIERS because an earlier research pass's
-- 4-tier brief couldn't be confirmed against anything live at the time.
-- That brief is now confirmed - this migration makes the schema match it,
-- and closes the usage-limit gap app/AGENTS.md's "PayFast billing" entry
-- flagged as deliberately deferred future work (no per-plan max_users/
-- max_packs_per_month existed anywhere until now).
--
-- No live Supabase project has ever run this schema (confirmed repeatedly
-- across sessions in app/AGENTS.md and docs/specs/System-Status.md) - there
-- are no real customer rows to protect, so the rename/remap below is a
-- plain, documented judgment call for a migration with nothing live to
-- break, not a live-customer-safe backfill:
--   watch (free, most limited)      -> starter (cheapest paid tier)
--   pro (R1,490, the old first paid tier) -> professional (Sarel's own
--     "the plan most companies start on" - a closer semantic match than
--     a literal price match would give)
--   sanral_pro (full-access, no pack limit) -> business (the next real
--     step up in seats/volume)

alter table company_subscriptions
  add column max_users integer,
  add column max_packs_per_month integer,
  -- 0078 never added this (only current_period_end) - without it there's
  -- no way to know where "this billing period" actually started for
  -- company_packs_this_period() below to count against. Set once per
  -- activation/renewal, alongside current_period_end, in
  -- apply_payfast_itn() (both the primary update and the 0081/0082 rescue
  -- path) - never computed by subtracting a month from current_period_end,
  -- since that silently assumes monthly billing even for a yearly plan.
  add column current_period_start timestamptz;

update company_subscriptions set plan_tier = 'starter' where plan_tier = 'watch';
update company_subscriptions set plan_tier = 'professional' where plan_tier = 'pro';
update company_subscriptions set plan_tier = 'business' where plan_tier = 'sanral_pro';

alter table company_subscriptions drop constraint company_subscriptions_plan_tier_check;
alter table company_subscriptions add constraint company_subscriptions_plan_tier_check
  check (plan_tier in ('starter', 'professional', 'business', 'enterprise'));

alter table payfast_payment_attempts drop constraint payfast_payment_attempts_plan_tier_check;
alter table payfast_payment_attempts add constraint payfast_payment_attempts_plan_tier_check
  check (plan_tier in ('starter', 'professional', 'business'));

-- The one place these numbers are allowed to live in SQL - mirrored in (and
-- checked against) lib/billing.ts's own PLAN_LIMITS, never imported across
-- the app/database boundary, same "two copies, cross-checked by a test"
-- convention 0078's own pricing already used for app/page.tsx vs
-- lib/billing.ts. Enterprise returns null/null (unlimited placeholder) -
-- it's priced and scoped on request, never self-serve.
create or replace function tt_plan_limits(p_plan_tier text)
returns table(max_users integer, max_packs_per_month integer)
language sql
immutable
as $$
  select
    case p_plan_tier when 'starter' then 2 when 'professional' then 5 when 'business' then 10 else null end,
    case p_plan_tier when 'starter' then 5 when 'professional' then 15 when 'business' then 30 else null end
$$;
comment on function tt_plan_limits(text) is
  'The one place a plan tier''s seat/volume limits are decided in SQL - mirrored in (and cross-checked by a test against) lib/billing.ts''s PLAN_LIMITS. Enterprise is null/null (unlimited placeholder - it''s priced on request, never self-serve).';

-- Backfill the two new columns for every row just remapped above, from
-- that same single source of truth.
update company_subscriptions
   set max_users = (select max_users from tt_plan_limits(plan_tier)),
       max_packs_per_month = (select max_packs_per_month from tt_plan_limits(plan_tier));

-- Trials now default to Professional ("the plan most companies start on") -
-- every tier has full feature parity under the real pricing, so there's no
-- more "default to the premium tier so they see everything" reasoning
-- 0078's own trigger comment gave for sanral_pro; a trial already shows
-- every engine regardless of which tier label it's under. The one real
-- trial limit remains company_can_request_pack() below (one pack total,
-- not a monthly allowance) - max_packs_per_month here only takes effect
-- once/if the trial converts to active.
create or replace function start_company_trial()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into company_subscriptions (company_id, plan_tier, billing_interval, status, trial_ends_at, max_users, max_packs_per_month)
  values (new.id, 'professional', 'monthly', 'trialing', now() + interval '14 days', 5, 15);
  return new;
end;
$$;

-- start_payfast_checkout(): enterprise is priced on request, never a
-- self-serve PayFast checkout (unchanged policy, just re-asserted under the
-- new tier names). Also now sets max_users/max_packs_per_month for the plan
-- being purchased, from tt_plan_limits() - so the limits actually change
-- the moment a checkout completes, not just the displayed price.
create or replace function start_payfast_checkout(p_plan_tier text, p_billing_interval text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
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

  select company_id into v_company_id from company_members where user_id = auth.uid() limit 1;
  if v_company_id is null then
    raise exception 'no company for the signed-in user' using errcode = 'P0002';
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
  'Called by the signed-in user from /billing before redirecting to PayFast. Sets the plan/interval the user picked (and, from tt_plan_limits(), that plan''s seat/volume limits) and issues a fresh unguessable payfast_m_payment_id, which the route handler embeds in the signed PayFast redirect and apply_payfast_itn() below later matches the ITN against. Also logs the id and plan to payfast_payment_attempts (0081/0082) so a successful payment under an id a LATER checkout attempt has since superseded can still be traced back to this company AND its correct plan.';

-- apply_payfast_itn()'s rescue path (0081/0082) also needs to restore
-- max_users/max_packs_per_month for the rescued attempt's own plan - it
-- was already restoring plan_tier/billing_interval, but not yet the limits
-- those two numbers are supposed to carry, since this column pair didn't
-- exist before this migration.
create or replace function apply_payfast_itn(
  p_m_payment_id text,
  p_payfast_token text,
  p_payment_status text,
  p_period_end timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new_status text;
  v_company_id uuid;
  v_plan_tier text;
  v_billing_interval text;
  v_max_users integer;
  v_max_packs integer;
begin
  v_new_status := case p_payment_status
    when 'COMPLETE' then 'active'
    when 'FAILED' then 'past_due'
    else null
  end;
  if v_new_status is null then
    -- An ITN status we don't act on (e.g. PENDING) - acknowledged, no row change.
    return;
  end if;

  update company_subscriptions
     set status = v_new_status,
         payfast_token = coalesce(p_payfast_token, payfast_token),
         current_period_end = coalesce(p_period_end, current_period_end),
         current_period_start = case when v_new_status = 'active' then now() else current_period_start end
   where payfast_m_payment_id = p_m_payment_id;

  if found then
    return;
  end if;

  -- 0081/0082/0083: this m_payment_id is no longer "current" for any
  -- company - a later checkout attempt (from the same company) must have
  -- superseded it on company_subscriptions before this ITN arrived. Only
  -- rescue a genuinely successful payment this way, via the append-only
  -- attempts log; a stale FAILED notification for an abandoned, superseded
  -- attempt is left alone (see 0081's own header comment for why).
  if v_new_status = 'active' then
    select company_id, plan_tier, billing_interval into v_company_id, v_plan_tier, v_billing_interval
      from payfast_payment_attempts where m_payment_id = p_m_payment_id;
    if v_company_id is not null then
      select max_users, max_packs_per_month into v_max_users, v_max_packs from tt_plan_limits(v_plan_tier);
      update company_subscriptions
         set status = v_new_status,
             payfast_token = coalesce(p_payfast_token, payfast_token),
             current_period_end = coalesce(p_period_end, current_period_end),
             current_period_start = now(),
             plan_tier = v_plan_tier,
             billing_interval = v_billing_interval,
             payfast_m_payment_id = p_m_payment_id,
             max_users = v_max_users,
             max_packs_per_month = v_max_packs
       where company_id = v_company_id;
      return;
    end if;
  end if;

  raise exception 'no subscription pending for this m_payment_id' using errcode = 'P0002';
end;
$$;
comment on function apply_payfast_itn(text, text, text, timestamptz) is
  'Called only by app/api/billing/payfast/itn''s route handler, after it has independently verified the ITN''s signature AND confirmed the payload with PayFast''s own server (see lib/payfast.ts). Granted to anon because PayFast''s server calls us with no Supabase session - see 0078''s header comment for why that is safe. Falls back to payfast_payment_attempts (0081) for a successful payment whose m_payment_id a later checkout attempt has since superseded, restoring that attempt''s own plan, limits (0083) and reclaiming payfast_m_payment_id for it (0082) rather than silently dropping a real charge or leaving the wrong plan/limits showing.';

-- ---------------------------------------------------------------------------
-- Usage gating - the one piece every prior pass of this work deliberately
-- deferred (app/AGENTS.md: "a genuine hard lock-out once lapsed... per-
-- feature/per-tier gating... not built"). Two real functions, same
-- "stable SQL, SECURITY DEFINER, no I/O beyond this one read" shape as
-- is_company_member() and friends.
-- ---------------------------------------------------------------------------

-- Bid packs requested this billing period, across BOTH engines (sanral and
-- general) - Sarel's own pricing copy never gates by engine, only by
-- volume ("five complete bid packs a month"), so a pack is a pack
-- regardless of which engine produced it.
create or replace function company_packs_this_period(p_company_id uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select count(*)::integer
  from pack_generation_jobs
  where company_id = p_company_id
    and status = 'ready'
    and requested_at >= (
      select coalesce(current_period_start, created_at) from company_subscriptions where company_id = p_company_id
    )
$$;
comment on function company_packs_this_period(uuid) is
  'Count of ready bid packs (both pack_generation_jobs.engine values - sanral and general, Sarel''s pricing never gates by engine) requested since this company''s current billing period started. Used by company_can_request_pack() - never called to block anything by itself.';

-- The one gate requestSubmissionPack()/requestJob() (generate_pack) call
-- before inserting a new pack_generation_jobs row. Trialing gets exactly
-- ONE pack total, ever (Sarel's own "14-day trial... with one full standard
-- bid pack" wording - a trial proof point, not a monthly allowance);
-- active respects the plan's own max_packs_per_month (null = unlimited,
-- the enterprise placeholder); anything else (past_due/cancelled) can't
-- request at all.
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
begin
  select status, max_packs_per_month into v_status, v_max_packs
    from company_subscriptions where company_id = p_company_id;
  if v_status is null then
    return false;
  end if;
  if v_status = 'trialing' then
    return (select count(*) from pack_generation_jobs where company_id = p_company_id and status = 'ready') < 1;
  end if;
  if v_status = 'active' then
    return v_max_packs is null or company_packs_this_period(p_company_id) < v_max_packs;
  end if;
  return false;
end;
$$;
comment on function company_can_request_pack(uuid) is
  'The one source of truth for both the trial''s one-pack-total cap and an active plan''s monthly allowance (null max_packs_per_month = unlimited, the enterprise placeholder). Called by requestSubmissionPack() (app/tenders/[id]/actions.ts) and requestJob()''s generate_pack path (app/tenders/[id]/general-actions.ts) before inserting a new pack_generation_jobs row - never re-derived in TypeScript.';

revoke all on function company_packs_this_period(uuid) from public;
grant execute on function company_packs_this_period(uuid) to authenticated;
revoke all on function company_can_request_pack(uuid) from public;
grant execute on function company_can_request_pack(uuid) to authenticated;
