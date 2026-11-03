-- Standing QA pass, 2026-11-03: app/api/billing/payfast/itn/route.ts's own
-- header comment claims "every one of PayFast's own documented ITN security
-- checks is done" and lists three - signature, source IP, server
-- confirmation (eng/query/validate). PayFast's own support docs
-- (payfast.kayako.com/article/321) document a FOURTH: that the ITN's
-- amount_gross actually matches what your own records say this
-- m_payment_id was for. Until this migration, apply_payfast_itn() never
-- checked it at all - a COMPLETE ITN that passes signature + IP + server
-- confirmation was applied at face value regardless of amount_gross, so
-- the route's own claim of full compliance wasn't true.
--
-- tt_plan_price_zar() mirrors lib/billing.ts's PLAN_MONTHLY_ZAR/
-- priceForPlanZar() exactly - same "two copies, never imported across the
-- app/database boundary, each one's own test/replay catches drift" pattern
-- already used for tt_plan_limits()/PLAN_LIMITS (0083). Pricing itself
-- still lives in exactly one real place (lib/billing.ts); this is only the
-- read-only SQL-side mirror apply_payfast_itn() needs to verify an amount
-- without computing a price itself.
--
-- apply_payfast_itn() gains a new p_amount_gross parameter (the route
-- handler's own amount_gross param, passed straight through) and, for any
-- ITN that would activate a subscription, now looks up the plan/interval
-- that specific m_payment_id was actually checked out for - company_
-- subscriptions' own current row for the ordinary (not-yet-superseded)
-- path, payfast_payment_attempts' append-only record (0081/0082) for the
-- rescue path - and raises (failing closed, same as every other ITN check)
-- if amount_gross doesn't match that plan's price. A FAILED ITN never
-- carries a real amount to defend against (nothing is being activated), so
-- only the two 'active' branches are gated.
--
-- Signature changed (added a parameter) - the old 4-arg overload is
-- dropped outright rather than left granted alongside the new one, so
-- there is only ever one apply_payfast_itn() callable. Applying this
-- migration needs the same SQL-Editor path as 0096/0107-0111 - no DDL
-- execution exists from this session.
begin;

create or replace function tt_plan_price_zar(p_plan_tier text, p_billing_interval text)
returns numeric
language sql
immutable
as $$
  select case p_plan_tier
    when 'starter' then case p_billing_interval when 'yearly' then 14900 when 'monthly' then 1490 end
    when 'professional' then case p_billing_interval when 'yearly' then 29900 when 'monthly' then 2990 end
    when 'business' then case p_billing_interval when 'yearly' then 49900 when 'monthly' then 4990 end
  end::numeric;
$$;
comment on function tt_plan_price_zar(text, text) is
  'Rand, excl. VAT - mirrors lib/billing.ts''s PLAN_MONTHLY_ZAR/priceForPlanZar()/yearlyPriceZar() exactly (same cross-boundary-mirror convention as tt_plan_limits(), 0083). Read by apply_payfast_itn() (0112) alone, to verify an ITN''s amount_gross against the plan/interval it should be paying for; never the other direction - a price is never computed in SQL and handed to the app.';

drop function if exists apply_payfast_itn(text, text, text, timestamptz);

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

  select plan_tier, billing_interval into v_plan_tier, v_billing_interval
    from company_subscriptions where payfast_m_payment_id = p_m_payment_id;

  if v_plan_tier is not null then
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
  'Called only by app/api/billing/payfast/itn''s route handler, after it has independently verified the ITN''s signature AND confirmed the payload with PayFast''s own server (see lib/payfast.ts). Granted to anon because PayFast''s server calls us with no Supabase session - see 0078''s header comment for why that is safe. Falls back to payfast_payment_attempts (0081) for a successful payment whose m_payment_id a later checkout attempt has since superseded, restoring that attempt''s own plan, limits (0083) and reclaiming payfast_m_payment_id for it (0082) rather than silently dropping a real charge or leaving the wrong plan/limits showing. current_period_end only ever advances on a genuinely active result (0110) - a FAILED ITN must never show a future "paid through" date next to a "Past due" status. Now also verifies amount_gross against tt_plan_price_zar() for that m_payment_id''s own recorded plan before ever activating anything (0112) - PayFast''s own documented 4th ITN check, previously missing.';

commit;
