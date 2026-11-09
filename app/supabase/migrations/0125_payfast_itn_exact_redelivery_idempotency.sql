-- Standing solution-architect review, 2026-11-09: fresh-angle check per the
-- task brief's own suggestion (c) - webhook/callback idempotency under a
-- genuine EXACT redelivery (not a race, a full replay of an already-
-- committed event, well after the fact - a PayFast merchant-dashboard
-- "Resend" of a past ITN, or a retried delivery after a lost acknowledgement
-- on PayFast's own side even though this app already committed and returned
-- 200 the first time).
--
-- apply_payfast_itn() (0112's own copy, the latest before this one) has no
-- defence against this at all. The app's own checkout (app/app/api/billing/
-- checkout/route.ts) sets subscription_type: "1" - a real PayFast RECURRING
-- subscription, cycles=0 ("until cancelled") - by design, m_payment_id is
-- set ONCE at initial checkout and reused for EVERY future charge under that
-- subscription's lifetime, so apply_payfast_itn() being called repeatedly
-- over time for the SAME m_payment_id, extending current_period_end further
-- each time, is the intended, correct shape for a legitimate monthly/yearly
-- renewal charge. That is exactly why this bug survived: a brand-new
-- legitimate renewal charge and an exact redelivery of an ALREADY-APPLIED
-- past charge are indistinguishable by m_payment_id alone - both reuse it.
--
-- The field that actually IS unique per real transaction is PayFast's own
-- pf_payment_id (the route handler's p_payfast_token, "pf_payment_id" falling
-- back to "token" - app/app/api/billing/payfast/itn/route.ts line 72) - a
-- genuine new charge always gets a new one; an exact redelivery of a past
-- charge's ITN carries the SAME one again. apply_payfast_itn() never checked
-- it against the row's own already-stored payfast_token before this
-- migration - it only ever wrote into that column (coalesce(p_payfast_token,
-- payfast_token)), never read it back to detect a repeat.
--
-- Reproduced live (scratch Postgres, 114 migrations + this one on top,
-- company_subscriptions seeded via a real checkout-shaped row): a first
-- COMPLETE ITN (m_payment_id=mpid, pf_payment_id=pf-token-1, amount 1490)
-- correctly activated the row, current_period_end = now+31d. Redelivering
-- the IDENTICAL ITN (same m_payment_id AND same pf_payment_id, amount
-- unchanged, "arriving" 10 days later - the route always recomputes
-- p_period_end as nextPeriodEnd() = addMonths(now(), ...) at CALL time, per
-- lib/payfast.ts, never from anything in the ITN payload or the stored row)
-- against the pre-fix function pushed current_period_end from now+31d to
-- now+41d AND reset current_period_start to "now" - a free 10-day extension
-- of a paid subscription with zero new payment, that compounds with every
-- redelivery, purely from PayFast (or a merchant-triggered dashboard resend)
-- repeating a notification this app had already fully processed. A
-- genuinely NEW renewal charge for the same subscription (same m_payment_id,
-- a DIFFERENT pf_payment_id, as PayFast really issues for each real charge)
-- still correctly extends the period after this fix - confirmed, not
-- assumed, by testing both shapes against this migration's own fixed body.
--
-- Fix: before either 'active'-path branch does anything else, if
-- p_payfast_token is non-null, equals the row's OWN currently-stored
-- payfast_token, AND the row's current status already equals what this ITN
-- would set it to - this is a repeat of an event already fully applied, not
-- a new charge or a new status transition - return as a no-op. A payment
-- that failed-then-later-succeeded, or a brand-new charge, always carries a
-- new pf_payment_id (or wouldn't yet match an active-with-this-token row),
-- so the legitimate renewal path is untouched. (The "rescue" branch for an
-- m_payment_id a later checkout attempt has since superseded - 0081/0082 -
-- is a one-time, first-successful-activation path by construction, not a
-- repeatable renewal target, so it is left as-is; a truly duplicate rescue
-- delivery lands on the now-"current" row and is caught by the SAME new
-- guard on its next delivery, since the rescue branch itself already sets
-- payfast_m_payment_id = p_m_payment_id, making that row "current" from then on.)
begin;

create or replace function apply_payfast_itn(
  p_m_payment_id text,
  p_payfast_token text,
  p_payment_status text,
  p_period_end timestamptz,
  p_amount_gross numeric
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
  v_expected_amount numeric;
  v_current_status text;
  v_current_token text;
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

  select plan_tier, billing_interval, status, payfast_token
    into v_plan_tier, v_billing_interval, v_current_status, v_current_token
    from company_subscriptions where payfast_m_payment_id = p_m_payment_id;

  if v_plan_tier is not null then
    if p_payfast_token is not null and p_payfast_token = v_current_token and v_current_status = v_new_status then
      -- Exact redelivery of an event already fully applied (same real
      -- transaction, not a new charge) - a no-op, not a second activation.
      return;
    end if;

    if v_new_status = 'active' then
      v_expected_amount := tt_plan_price_zar(v_plan_tier, v_billing_interval);
      if v_expected_amount is null or p_amount_gross is null or p_amount_gross <> v_expected_amount then
        raise exception 'PayFast ITN amount_gross % does not match % %''s expected price % for m_payment_id %',
          p_amount_gross, v_plan_tier, v_billing_interval, v_expected_amount, p_m_payment_id using errcode = 'P0003';
      end if;
    end if;
    update company_subscriptions
       set status = v_new_status,
           payfast_token = coalesce(p_payfast_token, payfast_token),
           current_period_end = case when v_new_status = 'active' then coalesce(p_period_end, current_period_end) else current_period_end end,
           current_period_start = case when v_new_status = 'active' then now() else current_period_start end
     where payfast_m_payment_id = p_m_payment_id;
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
      v_expected_amount := tt_plan_price_zar(v_plan_tier, v_billing_interval);
      if v_expected_amount is null or p_amount_gross is null or p_amount_gross <> v_expected_amount then
        raise exception 'PayFast ITN amount_gross % does not match % %''s expected price % for m_payment_id % (rescue path)',
          p_amount_gross, v_plan_tier, v_billing_interval, v_expected_amount, p_m_payment_id using errcode = 'P0003';
      end if;
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
revoke all on function apply_payfast_itn(text, text, text, timestamptz, numeric) from public;
grant execute on function apply_payfast_itn(text, text, text, timestamptz, numeric) to anon, authenticated;
comment on function apply_payfast_itn(text, text, text, timestamptz, numeric) is
  'Called only by app/api/billing/payfast/itn''s route handler, after it has independently verified the ITN''s signature AND confirmed the payload with PayFast''s own server (see lib/payfast.ts). Granted to anon because PayFast''s server calls us with no Supabase session - see 0078''s header comment for why that is safe. Falls back to payfast_payment_attempts (0081) for a successful payment whose m_payment_id a later checkout attempt has since superseded, restoring that attempt''s own plan, limits (0083) and reclaiming payfast_m_payment_id for it (0082) rather than silently dropping a real charge or leaving the wrong plan/limits showing. current_period_end only ever advances on a genuinely active result (0110) - a FAILED ITN must never show a future "paid through" date next to a "Past due" status. Verifies amount_gross against tt_plan_price_zar() for that m_payment_id''s own recorded plan before ever activating anything (0112). Now also a no-op on an exact redelivery of an event already fully applied - same pf_payment_id/token AND the row is already in the status this ITN would set - so a PayFast-side retry or a merchant-dashboard "Resend" of a PAST charge can never extend current_period_end/reset current_period_start a second time for free; a genuinely new renewal charge under the same recurring m_payment_id (a different pf_payment_id, as PayFast always issues per real charge) is unaffected and still correctly extends the period (0125).';

commit;
