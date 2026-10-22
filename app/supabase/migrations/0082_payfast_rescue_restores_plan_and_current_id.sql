-- Closes the residual edge case a sibling standing-review pass flagged
-- after independently verifying 0081's own fix (Finding 51): "the rescue
-- path updates status/payfast_token/current_period_end but never touches
-- payfast_m_payment_id itself. If a company starts checkout A (plan X),
-- then checkout B (plan Y) before A's ITN arrives, and A's COMPLETE ITN is
-- rescued, the subscription activates - but still under whatever plan
-- company_subscriptions currently holds (B's selection). If B then fails,
-- apply_payfast_itn() would set past_due even though A's payment genuinely
-- succeeded." Confirmed both halves of that live against a real local
-- Postgres replay before writing this fix (QA pass, 2026-10-22):
--   1. Rescuing A's COMPLETE left plan_tier/billing_interval as B's choice,
--      not A's - a customer who paid for "Tender Pro" could see "SANRAL
--      Pro" (unpaid for) on their own account.
--   2. B's own later FAILED ITN, arriving after A was rescued, downgraded
--      the subscription to past_due even though A's payment - the one that
--      actually went through - was still sitting there un-undone.
--
-- Fix: payfast_payment_attempts now also records the plan_tier/
-- billing_interval that specific attempt was for (set once, at checkout,
-- never changed), and a rescue restores BOTH that recorded plan AND
-- payfast_m_payment_id itself - reclaiming "current" status for the
-- attempt that actually won. That single reclaim is what closes half 2 for
-- free: B's subsequent FAILED ITN no longer matches company_subscriptions.
-- payfast_m_payment_id at all (it's back to A's id), so it falls through to
-- the same fallback path - which (unchanged from 0081) only ever rescues a
-- COMPLETE, never a FAILED - and is correctly ignored rather than applied.
alter table payfast_payment_attempts add column plan_tier text;
alter table payfast_payment_attempts add column billing_interval text;
-- No real row can hold a null here once backfilled - start_payfast_checkout()
-- always validates p_plan_tier/p_billing_interval before inserting (and
-- 0081's own insert happens in the SAME function, same validated values) -
-- backfill any pre-0082 row (if one somehow exists) from its own tender's
-- CURRENT plan rather than guessing further back than that; a row for a
-- company with no subscription row at all is impossible (company_subscriptions
-- is created for every company by a trigger - 0078) but delete defensively
-- rather than leave an unconstrained row if that ever changes.
update payfast_payment_attempts a
   set plan_tier = s.plan_tier, billing_interval = s.billing_interval
  from company_subscriptions s
 where s.company_id = a.company_id and a.plan_tier is null;
delete from payfast_payment_attempts where plan_tier is null or billing_interval is null;
alter table payfast_payment_attempts alter column plan_tier set not null;
alter table payfast_payment_attempts alter column billing_interval set not null;
alter table payfast_payment_attempts add constraint payfast_payment_attempts_plan_tier_check
  check (plan_tier in ('pro', 'sanral_pro'));
alter table payfast_payment_attempts add constraint payfast_payment_attempts_billing_interval_check
  check (billing_interval in ('monthly', 'yearly'));
comment on table payfast_payment_attempts is
  'Append-only record of every payfast_m_payment_id ever issued by start_payfast_checkout(), per company, with the plan it was FOR at that moment - never overwritten, unlike company_subscriptions'' own columns (0078/0081). Lets apply_payfast_itn() trace a successful payment back to its company AND its correct plan even after a later checkout attempt has changed what "current" means on company_subscriptions (0081/0082).';

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

  -- 0082: also record the plan THIS attempt was for, so a rescue (below)
  -- can restore it even after a later attempt changes company_subscriptions'
  -- own plan_tier/billing_interval.
  insert into payfast_payment_attempts (company_id, m_payment_id, plan_tier, billing_interval)
  values (v_company_id, v_m_payment_id, p_plan_tier, p_billing_interval);

  return v_m_payment_id;
end;
$$;
comment on function start_payfast_checkout(text, text) is
  'Called by the signed-in user from /billing before redirecting to PayFast. Sets the plan/interval the user picked and issues a fresh unguessable payfast_m_payment_id, which the route handler embeds in the signed PayFast redirect and apply_payfast_itn() below later matches the ITN against. Also logs the id and plan to payfast_payment_attempts (0081/0082) so a successful payment under an id a LATER checkout attempt has since superseded can still be traced back to this company AND its correct plan.';

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

  if found then
    return;
  end if;

  -- 0081/0082: this m_payment_id is no longer "current" for any company - a
  -- later checkout attempt (from the same company) must have superseded it
  -- on company_subscriptions before this ITN arrived. Only rescue a
  -- genuinely successful payment this way, via the append-only attempts
  -- log; a stale FAILED notification for an abandoned, superseded attempt
  -- is left alone (see 0081's own header comment for why).
  if v_new_status = 'active' then
    select company_id, plan_tier, billing_interval into v_company_id, v_plan_tier, v_billing_interval
      from payfast_payment_attempts where m_payment_id = p_m_payment_id;
    if v_company_id is not null then
      update company_subscriptions
         set status = v_new_status,
             payfast_token = coalesce(p_payfast_token, payfast_token),
             current_period_end = coalesce(p_period_end, current_period_end),
             -- 0082: restore THIS attempt's own plan (not whatever a later,
             -- still-unresolved attempt has since set), and reclaim
             -- payfast_m_payment_id for it - so a later FAILED notification
             -- for the attempt it superseded no longer matches the UPDATE
             -- above at all, and correctly falls through to be ignored
             -- rather than wrongly downgrading this just-rescued payment.
             plan_tier = v_plan_tier,
             billing_interval = v_billing_interval,
             payfast_m_payment_id = p_m_payment_id
       where company_id = v_company_id;
      return;
    end if;
  end if;

  raise exception 'no subscription pending for this m_payment_id' using errcode = 'P0002';
end;
$$;
comment on function apply_payfast_itn(text, text, text, timestamptz) is
  'Called only by app/api/billing/payfast/itn''s route handler, after it has independently verified the ITN''s signature AND confirmed the payload with PayFast''s own server (see lib/payfast.ts). Granted to anon because PayFast''s server calls us with no Supabase session - see 0078''s header comment for why that is safe. Falls back to payfast_payment_attempts (0081) for a successful payment whose m_payment_id a later checkout attempt has since superseded, restoring that attempt''s own plan and reclaiming payfast_m_payment_id for it (0082) rather than silently dropping a real charge or leaving the wrong plan showing.';
