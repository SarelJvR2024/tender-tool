-- Renumbered 0105 -> 0110 (2026-10-30/31): this file originally landed on main as
-- 0105_payfast_itn_failed_payment_period_end.sql (commit ee36c9e, 2026-10-29).
-- PR #173 independently added its own, unrelated 0105_tender_pipeline_stage_v2.sql
-- and 0106_tender_update_resolution_v2.sql, so by the time both were on main there
-- were two different migrations both named "0105" - flagged by a standing-review
-- pass as backlog item 16 (docs/specs/System-Status.md), fixed here by giving
-- THIS file (the one PR #173's own 0105_tender_pipeline_stage_v2.sql collided
-- with, arriving second) the next free number - 0107 through 0109 were claimed
-- by other sessions between the collision being flagged and this fix landing,
-- so 0110, not the 0107 first suggested. No SQL content changed, filename only -
-- whether this specific migration has already been run live is unconfirmed from
-- here either way and unaffected by the rename (this repo has no CLI-tracked
-- migration-history table; a filename change has no effect on a function
-- already applied under the old one).
--
-- Bug found during the 2026-10-29 standing review: apply_payfast_itn()'s primary
-- UPDATE (0083) always moved current_period_end forward to p_period_end regardless
-- of the new status - including on a FAILED ITN (v_new_status = 'past_due'). The
-- route handler (app/app/api/billing/payfast/itn/route.ts) computes p_period_end
-- from the decoded plan/interval whenever custom_str2 is present, with no
-- payment_status check of its own, so a failed payment still handed this function
-- a real future date. Reproduced against a scratch table before writing this fix:
-- a FAILED ITN left status='past_due' but current_period_end jumped a full billing
-- interval into the future - visible directly on admin/billing's own table, which
-- renders Status and "Period end" as two columns on the same row ("Past due" next
-- to a date that reads as "paid through next month" - a real, same-screen
-- contradiction, the same bug shape this session's other standing-review passes
-- have repeatedly found elsewhere). current_period_start already had the correct
-- "only on active" guard (0083); current_period_end never did. Fixed by giving it
-- the identical guard. The rescue path below (0081/0082/0083) is unaffected - it
-- was already scoped to `if v_new_status = 'active'` before ever touching
-- current_period_end, so it never had this bug.
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
         current_period_end = case when v_new_status = 'active' then coalesce(p_period_end, current_period_end) else current_period_end end,
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
  'Called only by app/api/billing/payfast/itn''s route handler, after it has independently verified the ITN''s signature AND confirmed the payload with PayFast''s own server (see lib/payfast.ts). Granted to anon because PayFast''s server calls us with no Supabase session - see 0078''s header comment for why that is safe. Falls back to payfast_payment_attempts (0081) for a successful payment whose m_payment_id a later checkout attempt has since superseded, restoring that attempt''s own plan, limits (0083) and reclaiming payfast_m_payment_id for it (0082) rather than silently dropping a real charge or leaving the wrong plan/limits showing. current_period_end only ever advances on a genuinely active result (0110, renumbered from its original 0105 to resolve a numbering collision with 0105_tender_pipeline_stage_v2.sql - see System-Status.md) - a FAILED ITN must never show a future "paid through" date next to a "Past due" status.';
