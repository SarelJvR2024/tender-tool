-- Fixes a real "customer paid, subscription never activated, nobody told"
-- gap found by the standing QA pass, in the exact function 0078's own header
-- comment calls "the one place in this piece of work where correctness
-- really matters (money-adjacent)".
--
-- start_payfast_checkout() OVERWRITES company_subscriptions.payfast_m_payment_id
-- every time it's called (one row per company, by design - PayFast resends
-- the SAME m_payment_id on every recurring ITN for a subscription, so this
-- column deliberately isn't append-only). But nothing stops a company's
-- member from starting a SECOND checkout (a double-click, two tabs, or
-- clicking "Subscribe" again after returning from PayFast - app/billing's
-- own CheckoutLink is a plain <Link>, no debounce, no "checkout in
-- progress" state) before the FIRST payment's ITN has arrived. PayFast ITNs
-- are asynchronous and PayFast itself retries on anything but a 200 (this
-- file's own route handler header comment) - so the delay this needs is
-- entirely ordinary, not contrived.
--
-- When that happens: the first payment can genuinely succeed at PayFast (the
-- customer's card IS charged), but by the time its ITN lands,
-- payfast_m_payment_id has already moved on to the second attempt's id.
-- apply_payfast_itn()'s UPDATE matches no row, raises, and the route handler
-- (app/api/billing/payfast/itn/route.ts) only console.errors it and returns
-- 200 (so PayFast never retries - it believes the notification was
-- received). There is no system_alerts-equivalent anywhere in this
-- TypeScript codebase (confirmed by grep before writing this migration) -
-- so a real charge with no activated subscription had ZERO visibility
-- anywhere in the product, not even a log anyone is likely to watch.
--
-- Fix: an append-only log of every m_payment_id ever issued per company, so
-- a SUCCESSFUL payment whose id has since been superseded can still be
-- traced to the right company and applied, instead of silently dropped.
-- Deliberately NOT used to rescue a FAILED/past_due notification for a
-- superseded, abandoned attempt - that carries no information worth acting
-- on once the company has moved on, and applying it could wrongly downgrade
-- an already-active paying customer whose LATER attempt already succeeded.
create table payfast_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  m_payment_id text not null unique,
  created_at timestamptz not null default now()
);
comment on table payfast_payment_attempts is
  'Append-only record of every payfast_m_payment_id ever issued by start_payfast_checkout(), per company - never overwritten, unlike company_subscriptions.payfast_m_payment_id itself (0078). Lets apply_payfast_itn() trace a successful payment back to its company even after a later checkout attempt has superseded the "current" m_payment_id on company_subscriptions (0081).';

-- No RLS needed to be queried by anyone: only start_payfast_checkout() (adds
-- a row) and apply_payfast_itn() (reads one) ever touch it, both already
-- SECURITY DEFINER - same "enable RLS with zero policies" precedent as
-- sent_deadline_reminders (0079/0080): PostgREST still requires RLS enabled
-- to expose a table at all over anon/authenticated, so this closes it to
-- every client role rather than leaving it openly readable by default.
alter table payfast_payment_attempts enable row level security;

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

  -- 0081: record it permanently, in addition to (never instead of) the
  -- update above - see this migration's header comment.
  insert into payfast_payment_attempts (company_id, m_payment_id) values (v_company_id, v_m_payment_id);

  return v_m_payment_id;
end;
$$;
comment on function start_payfast_checkout(text, text) is
  'Called by the signed-in user from /billing before redirecting to PayFast. Sets the plan/interval the user picked and issues a fresh unguessable payfast_m_payment_id, which the route handler embeds in the signed PayFast redirect and apply_payfast_itn() below later matches the ITN against. Also logs the id to payfast_payment_attempts (0081) so a successful payment under an id a LATER checkout attempt has since superseded can still be traced back to this company.';

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

  -- 0081: this m_payment_id is no longer "current" for any company - a later
  -- checkout attempt (from the same company) must have superseded it on
  -- company_subscriptions before this ITN arrived. Only rescue a genuinely
  -- successful payment this way, via the append-only attempts log; a stale
  -- FAILED notification for an abandoned, superseded attempt is left alone
  -- (see this migration's header comment for why).
  if v_new_status = 'active' then
    select company_id into v_company_id from payfast_payment_attempts where m_payment_id = p_m_payment_id;
    if v_company_id is not null then
      update company_subscriptions
         set status = v_new_status,
             payfast_token = coalesce(p_payfast_token, payfast_token),
             current_period_end = coalesce(p_period_end, current_period_end)
       where company_id = v_company_id;
      return;
    end if;
  end if;

  raise exception 'no subscription pending for this m_payment_id' using errcode = 'P0002';
end;
$$;
comment on function apply_payfast_itn(text, text, text, timestamptz) is
  'Called only by app/api/billing/payfast/itn''s route handler, after it has independently verified the ITN''s signature AND confirmed the payload with PayFast''s own server (see lib/payfast.ts). Granted to anon because PayFast''s server calls us with no Supabase session - see 0078''s header comment for why that is safe. Falls back to payfast_payment_attempts (0081) for a successful payment whose m_payment_id a later checkout attempt has since superseded, rather than silently dropping a real charge.';
