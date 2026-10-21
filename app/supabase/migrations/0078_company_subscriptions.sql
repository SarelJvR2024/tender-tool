-- PayFast billing: company_subscriptions + the trial/checkout/ITN plumbing.
--
-- Sarel's own brief for this piece: sandbox PayFast for now (universal test
-- merchant credentials - merchant_id 10000100 / merchant_key 46f0cd694581a -
-- are PayFast's own published values, not a secret, so they're hardcoded in
-- lib/payfast.ts rather than an env var; live credentials are a later,
-- separate env-var swap). Real pricing, read straight off app/page.tsx's own
-- PRICING_TIERS (the only thing this migration is allowed to agree with -
-- see that page's own comment and app/AGENTS.md's PR note on why this
-- migration's plan tiers/prices are NOT the 4-tier Starter/Professional/
-- Roads & Civils/Enterprise names an earlier research pass named): Tender
-- Watch (free, no billing needed), Tender Pro (R1,490/month), SANRAL Pro
-- (R3,950/month). Yearly = 10x monthly ("2 months free"), computed in
-- lib/billing.ts, never hardcoded a second time anywhere including here.
--
-- One deliberate architecture choice, consistent with this app's own
-- existing rule (see 0077's header: "this Next.js app never holds the
-- Supabase service-role key... only engine/*, the bridge workers, do"):
-- PayFast's ITN (Instant Transaction Notification) webhook arrives at our
-- Next.js route handler with NO Supabase session at all (PayFast's own
-- server calls ours directly) - not a service-role client, but a narrow
-- SECURITY DEFINER RPC (apply_payfast_itn below), on the exact same
-- "possession of an unguessable bearer token is the authorization" model
-- 0077's company_invites already uses. The route handler itself still does
-- the real work - verifying PayFast's signature and, per PayFast's own
-- documented strongest check, re-confirming the payload with PayFast's own
-- server (lib/payfast.ts's confirmWithPayfast()) - before ever calling this
-- RPC; the RPC's own token-matched WHERE clause is defense in depth, not
-- the only gate.

create table company_subscriptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade unique,
  plan_tier text not null check (plan_tier in ('watch', 'pro', 'sanral_pro')),
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'yearly')),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'cancelled')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  -- PayFast's own reference for this subscription - the `token` field PayFast
  -- includes on a subscription ITN, usable later for an adhoc/cancel API call
  -- (not built yet - see app/AGENTS.md's own flagged-future-work note).
  payfast_token text,
  -- Our own bearer id for one checkout attempt (start_payfast_checkout()
  -- generates it, the ITN handler's apply_payfast_itn() is the only thing
  -- that reads it back) - stays set across a subscription's recurring
  -- billing cycles, since PayFast resends the SAME m_payment_id on every
  -- recurring ITN for a given subscription (not a one-time-use token the
  -- way an invite link is - see the header comment above).
  payfast_m_payment_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table company_subscriptions is
  'One row per company: plan tier, billing interval, PayFast subscription status. Created automatically (trialing) the moment a company exists - see the trigger below - so there is never a company with no subscription row to read.';

create trigger company_subscriptions_set_updated_at before update on company_subscriptions
  for each row execute function set_updated_at();

alter table company_subscriptions enable row level security;

-- Read-only for the company's own members - every write goes through one of
-- the two narrow SECURITY DEFINER functions below (or the trigger), never a
-- client-side insert/update/delete, same reasoning as 0001's own companies/
-- company_members "no public insert policy" rule.
create policy "members can view their company's subscription"
  on company_subscriptions for select to authenticated
  using (is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- Every new company starts a 14-day trial automatically, full access
-- (Sarel: "a new signup gets trialing, full access, until trial_ends_at").
-- A trigger, not a change to create_company_and_join() itself (0003) - lower
-- risk (that function's own body is untouched) and it also covers any other
-- path that ever inserts a company row (e.g. engine/seed_supabase_company.py),
-- so there is never a company silently missing a subscription row.
-- Trials default to sanral_pro (the full product) - Sarel's own "full
-- access" wording, not the free Watch tier, so a trial genuinely shows what
-- the paid product can do before asking for a card.
-- ---------------------------------------------------------------------------

create or replace function start_company_trial()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into company_subscriptions (company_id, plan_tier, billing_interval, status, trial_ends_at)
  values (new.id, 'sanral_pro', 'monthly', 'trialing', now() + interval '14 days');
  return new;
end;
$$;

create trigger companies_start_trial after insert on companies
  for each row execute function start_company_trial();

-- ---------------------------------------------------------------------------
-- Checkout initiation: generates and stores this company's one PayFast
-- bearer id, auth.uid()-scoped exactly like set_my_daily_digest_opt_in()
-- (0073) - the caller can only ever touch THEIR OWN company's row, never
-- one passed in as an argument.
-- ---------------------------------------------------------------------------

create or replace function start_payfast_checkout(p_plan_tier text, p_billing_interval text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_m_payment_id text;
begin
  if p_plan_tier not in ('pro', 'sanral_pro') then
    raise exception 'checkout is only for a paid plan (pro or sanral_pro), not %', p_plan_tier using errcode = '22023';
  end if;
  if p_billing_interval not in ('monthly', 'yearly') then
    raise exception 'billing_interval must be monthly or yearly' using errcode = '22023';
  end if;

  select company_id into v_company_id from company_members where user_id = auth.uid() limit 1;
  if v_company_id is null then
    raise exception 'no company for the signed-in user' using errcode = 'P0002';
  end if;

  v_m_payment_id := encode(gen_random_bytes(24), 'hex');

  update company_subscriptions
     set payfast_m_payment_id = v_m_payment_id,
         plan_tier = p_plan_tier,
         billing_interval = p_billing_interval
   where company_id = v_company_id;
  if not found then
    raise exception 'no subscription row for this company' using errcode = 'P0002';
  end if;

  return v_m_payment_id;
end;
$$;
revoke all on function start_payfast_checkout(text, text) from public;
grant execute on function start_payfast_checkout(text, text) to authenticated;
comment on function start_payfast_checkout(text, text) is
  'Called by the signed-in user from /billing before redirecting to PayFast. Sets the plan/interval the user picked and issues a fresh unguessable payfast_m_payment_id, which the route handler embeds in the signed PayFast redirect and apply_payfast_itn() below later matches the ITN against.';

-- ---------------------------------------------------------------------------
-- ITN apply: the ONLY path that can set a subscription active/past_due from
-- a real PayFast payment. No auth.uid() at all (PayFast's server calls our
-- route with no Supabase session) - granted to anon, same precedent as
-- signups_enabled() (0064). Scoped by payfast_m_payment_id alone (never a
-- company_id argument), so even a direct call to this RPC - bypassing the
-- route handler's own signature/confirmWithPayfast() checks entirely - can
-- only affect the one subscription whose unguessable bearer id it supplies,
-- never pick a target company by id. See this file's header comment for the
-- full reasoning.
-- ---------------------------------------------------------------------------

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
         current_period_end = coalesce(p_period_end, current_period_end)
   where payfast_m_payment_id = p_m_payment_id;

  if not found then
    raise exception 'no subscription pending for this m_payment_id' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function apply_payfast_itn(text, text, text, timestamptz) from public;
grant execute on function apply_payfast_itn(text, text, text, timestamptz) to anon, authenticated;
comment on function apply_payfast_itn(text, text, text, timestamptz) is
  'Called only by app/api/billing/payfast/itn''s route handler, after it has independently verified the ITN''s signature AND confirmed the payload with PayFast''s own server (see lib/payfast.ts). Granted to anon because PayFast''s server calls us with no Supabase session - see this file''s header comment for why that is safe.';
