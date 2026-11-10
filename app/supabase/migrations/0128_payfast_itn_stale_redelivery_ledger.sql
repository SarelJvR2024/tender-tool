-- Standing solution-architect review, 2026-11-10: fresh-angle check per the
-- task brief's own suggestion (b) - PR #197 (Finding 225,
-- fix/payfast-itn-exact-redelivery-idempotency, still unmerged) closes a
-- real exact-redelivery gap in apply_payfast_itn(), but only ever compares
-- the redelivered ITN's own pf_payment_id/token against the row's CURRENT
-- payfast_token - "is this the same event as what's on the row right now?"
-- A DIFFERENT, still-open gap survives in the exact same function: a stale
-- redelivery of an OLDER, already-superseded real transaction (last
-- month's renewal ITN, resent from PayFast's own merchant dashboard - the
-- same real redelivery vector 0125's own header comment already names - or
-- simply delayed well past the next renewal) carries a DIFFERENT
-- pf_payment_id from whatever the row's CURRENT one now is, so 0125's own
-- guard never matches it, and it is applied as if it were a brand-new
-- charge.
--
-- Reproduced live (scratch Postgres, 117 migrations replayed, seeded one
-- company/subscription row shaped exactly like a real checkout): charge 1
-- (pf_payment_id "pf-1") activates the row - status active, token pf-1,
-- current_period_end = now+31d. Charge 2 (pf_payment_id "pf-2", a genuine
-- renewal under the same recurring m_payment_id, as PayFast's own design
-- requires - 0078's header comment) correctly advances it - token pf-2,
-- current_period_end advanced again, as it should. Redelivering charge 1's
-- EXACT ITN a third time (pf-1 again, nothing new) - confirmed against BOTH
-- the function as it stands on `main` today (no redelivery guard at all)
-- AND, separately, with PR #197's own 0125 migration applied on top (read-
-- only, not merged into this migration) - in EITHER case the row's
-- payfast_token was rolled BACKWARDS from pf-2 to the older pf-1, and
-- current_period_start/current_period_end were advanced a THIRD time, from
-- a stale notification carrying zero new payment. The route handler never
-- helps here either (app/api/billing/payfast/itn/route.ts): p_period_end is
-- always recomputed fresh from "now" at call time (lib/payfast.ts's
-- nextPeriodEnd()), never read from anything in the ITN payload itself, and
-- the ITN contains no sequence number or timestamp this app checks. Beyond
-- the free period extension, overwriting payfast_token backwards also
-- breaks 0125's OWN guard for the real current charge going forward - a
-- later genuine redelivery of charge 2's own ITN would no longer match
-- v_current_token either, since it has been clobbered back to pf-1.
--
-- Fix: an append-only ledger of every pf_payment_id apply_payfast_itn() has
-- ever actually applied - not just whichever one is currently reflected on
-- company_subscriptions - with a UNIQUE constraint doing the real dedup
-- work (PayFast's own pf_payment_id is globally unique per real
-- transaction - every existing comment on this function already relies on
-- that fact, this migration is the first to actually enforce it). Right
-- after the existing "an ITN status we don't act on" early return (so a
-- PENDING-type notification, which changes nothing, is never recorded as
-- "applied"), the function now tries to insert this ITN's own
-- pf_payment_id into the ledger; on conflict, it already exists - this
-- exact real transaction has been applied before, at ANY point, current or
-- stale - so return as a no-op immediately, before even looking at
-- company_subscriptions. This closes the stale/older-event gap this
-- migration documents AND fully subsumes 0125's own narrower "same current
-- token" check in one strictly-more-general mechanism. The insert lives
-- inside the SAME function call as everything else: if a later check
-- (amount_gross verification) raises, the whole call rolls back together,
-- so an ITN that is ultimately rejected was never actually "applied" and
-- stays retryable - not accidentally burned by its own ledger entry. A
-- FAILED ITN with no token (p_payfast_token null) is left undeduped, same
-- as before this migration - nothing on that path ever moves a date or a
-- rand, so a harmless repeat is the worst case.
--
-- Not merged with PR #197's own 0125: this repo's open-PR backlog already
-- has a documented migration-number collision class (multiple PRs each
-- using "0125" for something different), and `main` does not have 0125 at
-- all yet (0125 on `main` is an unrelated migration -
-- platform_admin_cv_document_stats_live_status, Finding 300). This
-- migration is written to stand on its own against `main`'s current
-- (0112) apply_payfast_itn(), so it does not depend on PR #197 merging
-- first. Once PR #197 is reviewed, its own fix is fully redundant once this
-- lands (harmless, but redundant) - recommend closing it in favour of this
-- one rather than merging both.
begin;

create table payfast_itn_applied_events (
  pf_payment_id text primary key,
  m_payment_id text not null,
  payment_status text not null,
  applied_at timestamptz not null default now()
);
comment on table payfast_itn_applied_events is
  'Append-only ledger of every real PayFast ITN apply_payfast_itn() (0128) has actually applied, keyed by PayFast''s own pf_payment_id (globally unique per real transaction). Exists solely to detect a stale or exact redelivery of ANY past event - not only the one currently reflected on company_subscriptions - and turn it into a no-op; closes the gap PR #197/0125''s own "matches the row''s CURRENT token" check left open for an older, already-superseded event.';

-- No RLS policy needed to be queried by anyone, same "enable RLS with zero
-- policies" precedent as payfast_payment_attempts (0081)/sent_deadline_reminders
-- (0079/0080): only apply_payfast_itn() (SECURITY DEFINER) ever touches
-- this table; PostgREST still requires RLS enabled to expose a table at
-- all over anon/authenticated, so this closes it to every client role.
alter table payfast_itn_applied_events enable row level security;

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
  v_ledger_hit text;
begin
  v_new_status := case p_payment_status
    when 'COMPLETE' then 'active'
    when 'FAILED' then 'past_due'
    else null
  end;
  if v_new_status is null then
    -- An ITN status we don't act on (e.g. PENDING) - acknowledged, no row
    -- change, and (deliberately, see header comment) never recorded in the
    -- ledger below either - nothing was actually applied.
    return;
  end if;

  if p_payfast_token is not null then
    insert into payfast_itn_applied_events (pf_payment_id, m_payment_id, payment_status)
    values (p_payfast_token, p_m_payment_id, p_payment_status)
    on conflict (pf_payment_id) do nothing
    returning pf_payment_id into v_ledger_hit;
    if v_ledger_hit is null then
      -- This exact real PayFast transaction has already been applied
      -- before - whether it's the row's current state or an older, already
      -- -superseded one. A stale/exact redelivery, not a new charge or
      -- status transition - no-op.
      return;
    end if;
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
  'Called only by app/api/billing/payfast/itn''s route handler, after it has independently verified the ITN''s signature AND confirmed the payload with PayFast''s own server (see lib/payfast.ts). Granted to anon because PayFast''s server calls us with no Supabase session - see 0078''s header comment for why that is safe. Falls back to payfast_payment_attempts (0081) for a successful payment whose m_payment_id a later checkout attempt has since superseded, restoring that attempt''s own plan, limits (0083) and reclaiming payfast_m_payment_id for it (0082) rather than silently dropping a real charge or leaving the wrong plan/limits showing. current_period_end only ever advances on a genuinely active result (0110) - a FAILED ITN must never show a future "paid through" date next to a "Past due" status. Verifies amount_gross against tt_plan_price_zar() for that m_payment_id''s own recorded plan before ever activating anything (0112). Now also a no-op on ANY redelivery of a real transaction it has ever applied before (payfast_itn_applied_events, keyed by PayFast''s own globally-unique pf_payment_id) - not just a redelivery of whatever the row''s CURRENT token happens to be - so neither an exact redelivery of the latest event NOR a stale redelivery of an older, already-superseded one can ever extend current_period_end/reset current_period_start a second time for free, or corrupt the row''s own stored payfast_token backwards (0128). A genuinely new charge (a different pf_payment_id, as PayFast always issues per real transaction) is unaffected either way.';

commit;
