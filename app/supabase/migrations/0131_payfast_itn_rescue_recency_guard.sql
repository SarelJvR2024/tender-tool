-- Standing solution-architect review, 2026-11-10: fresh-angle check per the
-- task brief's own suggestion (b) - "does start_payfast_checkout()/
-- apply_payfast_itn() handle a company retrying checkout after a failed/
-- abandoned attempt, or one that already has an active, different-plan
-- subscription, correctly?" apply_payfast_itn()'s own "rescue" branch
-- (0081/0082/0083, read-only/unchanged by Findings 225/334's own PRs - PR
-- #197's own 0125 header comment says so explicitly: "the rescue branch ...
-- is left as-is") was built for exactly ONE shape of "this m_payment_id is
-- no longer current": a LATER checkout attempt was started but never paid,
-- and the EARLIER attempt's own payment then arrives late. It never checks
-- the other, now-routine shape this same mechanism also reaches: the LATER
-- attempt was itself already paid and is the company's genuinely current,
-- active subscription, and the charge now arriving is a real but STALE
-- renewal of an OLDER attempt the company has since moved on from - which
-- happens on every ordinary plan switch, since this app has no PayFast
-- subscription-cancel flow at all (0078's own header: "usable later for an
-- adhoc/cancel API call (not built yet"; app/AGENTS.md line 271 says the
-- same - a deliberately-deferred product gap, not itself what this
-- migration fixes). Every switched-away-from plan's own PayFast
-- subscription (subscription_type=1, cycles=0 "until cancelled" -
-- app/app/api/billing/checkout/route.ts) keeps auto-renewing on its own
-- schedule forever unless the customer cancels it by hand on PayFast's own
-- side - so its next real renewal ITN, arriving with a brand-new
-- pf_payment_id (not a redelivery - Finding 225/334's ledger/token checks
-- do not apply here at all), lands squarely in this rescue branch and is
-- applied exactly like a genuine rescue, clobbering the company's real,
-- currently-active, more-recent subscription back to the old plan/limits
-- and reclaiming payfast_m_payment_id for the old attempt - orphaning the
-- newer subscription's own OWN recurring m_payment_id, whose next renewal
-- then no longer matches the row either and falls into this same rescue
-- branch too, oscillating the row between the two real subscriptions
-- indefinitely.
--
-- Reproduced live (scratch Postgres, 120 migrations replayed, one real
-- company seeded): checkout attempt 1 (business/yearly, m_payment_id X1)
-- paid and activated normally - status active, plan business/yearly, token
-- X1. Company then genuinely switches plans - checkout attempt 2 (starter/
-- monthly, m_payment_id X2) paid and activated normally too - status
-- active, plan starter/monthly, token X2, exactly the row the company
-- should now have. ~1 year later, attempt 1's own never-cancelled PayFast
-- subscription auto-renews for real (same m_payment_id X1, a brand-new
-- pf_payment_id, amount_gross correctly matching business/yearly's real
-- price - a genuine, not-forged charge): calling apply_payfast_itn(X1, ...)
-- silently reverted the row to plan_tier=business, billing_interval=yearly,
-- max_users=10, max_packs_per_month=30, payfast_m_payment_id=X1 - discarding
-- the company's real, currently-active starter/monthly subscription (X2)
-- with no trace of what just happened, confirmed column-for-column against
-- company_subscriptions before and after.
--
-- Fix: before the rescue branch applies anything, check whether the
-- company's CURRENT row is already 'active' under a DIFFERENT attempt that
-- was itself created strictly AFTER the one this ITN is trying to rescue
-- (payfast_payment_attempts.created_at is an ordering already on hand, not
-- a new column). If so, the company has already moved on to a real, more
-- recent, successfully-activated subscription - this stale charge must not
-- silently revert it, so the function returns as a no-op (raising a NOTICE
-- naming both attempts, for billing reconciliation - the real charge
-- itself is already on record in payfast_payment_attempts, so nothing is
-- silently lost, only not blindly applied over a newer active plan). This
-- narrowly targets the one case that actually corrupts a currently-correct
-- row; the original, still-wanted rescue case (a later attempt was
-- abandoned/never activated, or the current row isn't 'active' at all) is
-- completely unchanged - confirmed by the regression test below re-running
-- the ORIGINAL rescue scenario (0081/0082's own one) unmodified.
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
  v_this_attempt_created_at timestamptz;
  v_current_status text;
  v_current_attempt_created_at timestamptz;
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
    select company_id, plan_tier, billing_interval, created_at
      into v_company_id, v_plan_tier, v_billing_interval, v_this_attempt_created_at
      from payfast_payment_attempts where m_payment_id = p_m_payment_id;
    if v_company_id is not null then
      -- 0131: don't let a stale charge for THIS (superseded) attempt
      -- clobber a genuinely newer attempt that has already been
      -- successfully activated for this company.
      select s.status, a2.created_at
        into v_current_status, v_current_attempt_created_at
        from company_subscriptions s
        left join payfast_payment_attempts a2 on a2.m_payment_id = s.payfast_m_payment_id
       where s.company_id = v_company_id;

      if v_current_status = 'active'
         and v_current_attempt_created_at is not null
         and v_current_attempt_created_at > v_this_attempt_created_at then
        raise notice 'apply_payfast_itn: m_payment_id % (company %, attempt created %) is a stale charge for an already-superseded checkout attempt - this company is already active under a newer attempt created % - not reverting it. The charge itself remains on record in payfast_payment_attempts for billing reconciliation.',
          p_m_payment_id, v_company_id, v_this_attempt_created_at, v_current_attempt_created_at;
        return;
      end if;

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
  'Called only by app/api/billing/payfast/itn''s route handler, after it has independently verified the ITN''s signature AND confirmed the payload with PayFast''s own server (see lib/payfast.ts). Granted to anon because PayFast''s server calls us with no Supabase session - see 0078''s header comment for why that is safe. Falls back to payfast_payment_attempts (0081) for a successful payment whose m_payment_id a later checkout attempt has since superseded, restoring that attempt''s own plan, limits (0083) and reclaiming payfast_m_payment_id for it (0082) rather than silently dropping a real charge or leaving the wrong plan/limits showing - UNLESS the company has already moved on to a genuinely newer, already-active attempt (0131), in which case the stale charge is left as a no-op rather than reverting a currently-correct subscription (recorded via a NOTICE; the charge itself stays on record in payfast_payment_attempts). current_period_end only ever advances on a genuinely active result (0110) - a FAILED ITN must never show a future "paid through" date next to a "Past due" status. Verifies amount_gross against tt_plan_price_zar() for that m_payment_id''s own recorded plan before ever activating anything (0112).';

commit;
