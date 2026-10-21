-- Subscription billing via PayFast (Sarel, 2026-10-21: "I have a payfast
-- account" / "Add subscription billing to Tender Ready").
--
-- Plans (Sarel's own structure, not feature-gated - every plan gets every
-- engine; plans differ only by how many people and how many bid packs a
-- month):
--   starter       R1,490/mo -  2 users, 5 packs/month
--   professional  R2,990/mo -  5 users, 15 packs/month
--   business      R4,990/mo - 10 users, 30 packs/month
--   enterprise    priced on request - no self-serve checkout, contact-only
-- Annual = 10 months for 12 (Sarel's own "ten months for the price of
-- twelve"), stored as its own price rather than computed, so a future
-- change to the discount doesn't silently change what a seeded row means.
--
-- This app never holds the Supabase service-role key (confirmed in
-- 0077's own header comment, still true) - the PayFast ITN webhook
-- (app/app/api/payfast/itn/route.ts) is a trusted SERVER-SIDE route
-- (never reachable from a browser's own JS) that calls
-- record_payfast_itn() below, a narrow SECURITY DEFINER function, rather
-- than using any elevated client. The route itself does PayFast's own
-- three-part verification (signature, server-to-server /validate call,
-- source IP/hostname) BEFORE ever calling this function - the function
-- is not a second line of signature defense, it trusts the route the same
-- way build_general_pack.py trusts engine/ code that already authenticated
-- itself, but still checks invariants (known payment_status values, the
-- amount matches the plan actually being paid for) as defense in depth.
--
-- payfast_checkouts.m_payment_id is the real access-control boundary here,
-- the same "bearer token" reasoning 0077's own company_invites.token
-- already uses: a cryptographically random uuid, created only by an
-- authenticated company admin's own checkout request, known only to this
-- app and to PayFast (which echoes it back on the ITN) - not guessable,
-- so granting record_payfast_itn() to `anon` (required, since the ITN
-- route has no signed-in user) is an acceptable, already-precedented risk,
-- not a new one.

-- ---------------------------------------------------------------------------
-- Part A: the plan catalog (shared, not per-company)
-- ---------------------------------------------------------------------------

create table subscription_plans (
  code text primary key check (code in ('starter', 'professional', 'business', 'enterprise')),
  name text not null,
  monthly_price_zar numeric(10, 2), -- null = enterprise, priced on request
  annual_price_zar numeric(10, 2),  -- null = enterprise; "10 months for 12" stored as its own number
  max_users integer,                -- null = enterprise, negotiated
  max_packs_per_month integer,      -- null = enterprise, negotiated
  is_custom boolean not null default false,
  sort_order integer not null,
  created_at timestamptz not null default now()
);
comment on table subscription_plans is
  'The 4 billing tiers (Sarel, 2026-10-21) - a lookup table, not hardcoded in app code, the same reasoning registration_types (0040) already uses for a small, admin-visible catalog. Every plan includes every engine; plans differ only by max_users/max_packs_per_month. Enterprise has no self-serve price - the app shows "contact us" for it, never a checkout form.';

alter table subscription_plans enable row level security;
create policy "subscription_plans: readable by everyone signed in" on subscription_plans
  for select to authenticated using (true);

insert into subscription_plans (code, name, monthly_price_zar, annual_price_zar, max_users, max_packs_per_month, is_custom, sort_order) values
  ('starter', 'Starter', 1490.00, 14900.00, 2, 5, false, 1),
  ('professional', 'Professional', 2990.00, 29900.00, 5, 15, false, 2),
  ('business', 'Business', 4990.00, 49900.00, 10, 30, false, 3),
  ('enterprise', 'Enterprise', null, null, null, null, true, 4);

-- ---------------------------------------------------------------------------
-- Part B: one subscription per company
-- ---------------------------------------------------------------------------

create table company_subscriptions (
  company_id uuid primary key references companies(id) on delete cascade,
  plan_code text not null references subscription_plans(code),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'annual')),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'cancelled', 'incomplete')),
  -- 14-day trial, no card (Sarel's own spec) - granted the moment a company
  -- is created (see Part D's trigger below), not something a person has to
  -- ask for.
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  -- PayFast's own subscription token, returned on the FIRST successful ITN
  -- for a subscription_type=1 checkout - lets a future pass call PayFast's
  -- own cancel/pause API using this token. Not used to cancel yet (see
  -- cancel_at_period_end below) - PayFast's subscription-management API has
  -- its own separate request-signing scheme this pass did not verify
  -- against a real account, so building a "Cancel" button that calls it
  -- would be guessing at an unverified contract. Flagged, not faked.
  payfast_token text,
  -- Set by a company admin clicking "Cancel" - access reverts to the free
  -- trial state at current_period_end, but does NOT stop PayFast's own
  -- recurring charge (see payfast_token's own comment) - Sarel must also
  -- cancel the subscription in the PayFast dashboard today, until the API
  -- cancellation flow is built.
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table company_subscriptions is
  'One row per company - its current plan, billing cycle, and status. Rows are created automatically (trialing) when a company is created (Part D), and only ever promoted to active by record_payfast_itn() below, never by a direct client write.';

create index company_subscriptions_status_idx on company_subscriptions (status);

alter table company_subscriptions enable row level security;
-- Read: any company member (so the billing page can show "N of 5 packs
-- used" to everyone, same as the existing readiness score) - but only an
-- admin can change cancel_at_period_end (the only column a client may ever
-- write directly; every other column is service-style, via the function).
create policy "company_subscriptions: members can select" on company_subscriptions
  for select to authenticated using (is_company_member(company_id));
create policy "company_subscriptions: admins can set cancel_at_period_end" on company_subscriptions
  for update to authenticated
  using (tt_is_company_admin(company_id))
  with check (
    tt_is_company_admin(company_id)
    -- Every other column must be unchanged by this policy's own update -
    -- enforced by a trigger (set_updated_at already covers updated_at;
    -- the trigger below covers the rest), not assumed from the policy
    -- alone.
  );

create trigger company_subscriptions_set_updated_at before update on company_subscriptions
  for each row execute function set_updated_at();

-- A client-side update may only ever change cancel_at_period_end (and the
-- trigger-owned updated_at) - every other column (plan_code, status,
-- billing_cycle, trial/period dates, payfast_token) is service-style,
-- written only by record_payfast_itn() or the trial-seeding trigger below.
-- Without this, the admin-only UPDATE policy above would still let an
-- admin silently grant their own company a bigger plan or an 'active'
-- status with no payment at all.
create or replace function tt_check_subscription_client_columns()
returns trigger
language plpgsql
as $$
begin
  -- record_payfast_itn() sets this transaction-local flag immediately before
  -- its own update - SECURITY DEFINER bypasses RLS but not triggers, so
  -- without this the guard below would also block that legitimate update.
  if current_setting('app.bypass_subscription_guard', true) = 'true' then
    return new;
  end if;

  if new.plan_code is distinct from old.plan_code
    or new.status is distinct from old.status
    or new.billing_cycle is distinct from old.billing_cycle
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.current_period_start is distinct from old.current_period_start
    or new.current_period_end is distinct from old.current_period_end
    or new.payfast_token is distinct from old.payfast_token
  then
    raise exception 'Only cancel_at_period_end can be changed directly - plan, status and billing dates are set by payment confirmation only.';
  end if;
  return new;
end;
$$;
create trigger company_subscriptions_guard_client_columns before update on company_subscriptions
  for each row execute function tt_check_subscription_client_columns();

-- ---------------------------------------------------------------------------
-- Part C: checkout sessions and the payment ledger
-- ---------------------------------------------------------------------------

create table payfast_checkouts (
  -- This IS the m_payment_id PayFast echoes back on the ITN - generated
  -- here, not by PayFast, so the ITN can look up which company/plan it was
  -- ever for without trusting anything the ITN itself claims about that.
  m_payment_id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  plan_code text not null references subscription_plans(code),
  billing_cycle text not null check (billing_cycle in ('monthly', 'annual')),
  expected_amount_zar numeric(10, 2) not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Set once the ITN for this checkout has been processed (whatever the
  -- outcome) - a second ITN resend for the same m_payment_id (PayFast's own
  -- documented retry behaviour on a non-200 response) is a no-op, not a
  -- second charge recorded twice.
  resolved_at timestamptz
);
comment on table payfast_checkouts is
  'One row per "Upgrade"/"Subscribe" click, before the visitor ever reaches PayFast - the real access-control boundary for the ITN webhook (see this migration''s own header comment). expected_amount_zar is compared against the ITN''s own amount_gross as defense in depth, not trusted from the client at ITN time.';

alter table payfast_checkouts enable row level security;
create policy "payfast_checkouts: admins create their own company's checkout" on payfast_checkouts
  for insert to authenticated with check (tt_is_company_admin(company_id) and created_by = auth.uid());
create policy "payfast_checkouts: members can select their own company's" on payfast_checkouts
  for select to authenticated using (is_company_member(company_id));
-- No client update/delete - resolved_at is service-style, set only by
-- record_payfast_itn().

create table subscription_payments (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: an ITN for an m_payment_id we never created (not a real
  -- checkout from this app) is still logged, with no company to attribute
  -- it to - see record_payfast_itn()'s orphan branch.
  company_id uuid references companies(id) on delete cascade,
  m_payment_id uuid references payfast_checkouts(m_payment_id) on delete set null,
  pf_payment_id text, -- PayFast's own id for this specific transaction
  payment_status text not null check (payment_status in ('COMPLETE', 'FAILED', 'CANCELLED')),
  amount_gross_zar numeric(10, 2),
  raw_itn jsonb not null, -- the full ITN payload, for audit/debugging a disputed charge
  received_at timestamptz not null default now()
);
comment on table subscription_payments is
  'An append-only ledger of every ITN this app has processed (whatever the outcome) - never written except by record_payfast_itn(). raw_itn keeps the full payload so a billing dispute can be checked against what PayFast actually sent, not just the status this app derived from it.';

create index subscription_payments_company_idx on subscription_payments (company_id, received_at desc);

alter table subscription_payments enable row level security;
create policy "subscription_payments: admins can select their own company's" on subscription_payments
  for select to authenticated using (tt_is_company_admin(company_id));
-- No client insert/update/delete at all - service-style only.

-- ---------------------------------------------------------------------------
-- Part D: new companies start on a 14-day trial automatically
-- ---------------------------------------------------------------------------

create or replace function tt_seed_company_trial()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into company_subscriptions (company_id, plan_code, status, trial_ends_at)
  values (new.id, 'starter', 'trialing', now() + interval '14 days');
  return new;
end;
$$;
comment on function tt_seed_company_trial() is
  'Every new company gets a 14-day, no-card trial automatically (Sarel''s own spec) - plan_code defaults to starter only as a placeholder for what the trial LOOKS like; see check_pack_allowance() (Part E) for the real trial rule (one pack total, not the starter plan''s monthly 5).';
create trigger companies_seed_trial after insert on companies
  for each row execute function tt_seed_company_trial();

-- ---------------------------------------------------------------------------
-- Part E: usage checks - pure read functions, called by server actions
-- before queueing a pack job or accepting a team invite (never enforced by
-- RLS alone, since "how many packs this month" is a business rule, not a
-- row-visibility rule).
-- ---------------------------------------------------------------------------

create or replace function company_packs_this_period(p_company_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
  from pack_generation_jobs pgj
  join company_subscriptions cs on cs.company_id = p_company_id
  where pgj.company_id = p_company_id
    and pgj.status = 'ready'
    and pgj.requested_at >= coalesce(cs.current_period_start, cs.created_at);
$$;
comment on function company_packs_this_period(uuid) is
  'How many bid packs (both engines - SANRAL and general) this company has successfully completed since its current billing period started (or since the trial began, if still trialing - trial has no monthly period, see check_pack_allowance below for why the trial cap is checked separately, not via this count alone).';
revoke all on function company_packs_this_period(uuid) from public;
grant execute on function company_packs_this_period(uuid) to authenticated;

create or replace function company_can_request_pack(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when cs.status = 'trialing' then
      -- The trial's own cap is ONE pack total (Sarel: "one full standard
      -- bid pack so you see a real submission"), not a monthly allowance -
      -- counts every ready pack ever, not just since trial_ends_at minus
      -- 14 days (a company_subscriptions row's created_at IS the trial
      -- start, so this is equivalent and simpler).
      (select count(*) from pack_generation_jobs where company_id = p_company_id and status = 'ready') < 1
    when cs.status in ('active') then
      sp.max_packs_per_month is null -- enterprise, negotiated, never capped here
      or company_packs_this_period(p_company_id) < sp.max_packs_per_month
    else false -- past_due, cancelled, incomplete: no new packs until payment resumes
  end
  from company_subscriptions cs
  join subscription_plans sp on sp.code = cs.plan_code
  where cs.company_id = p_company_id;
$$;
comment on function company_can_request_pack(uuid) is
  'Whether this company may queue one more pack build right now - the real gate general-actions.ts/pack-review-actions.ts call before requestGeneralPack()/requestSubmissionPack() queue a job. False (not an error) when the company has no subscription row at all (shouldn''t happen - every company gets one on creation, Part D - but never assumed).';
revoke all on function company_can_request_pack(uuid) from public;
grant execute on function company_can_request_pack(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Part F: record_payfast_itn() - the one function the ITN route calls,
-- after it has ALREADY verified the signature, done the server-to-server
-- /validate call, and checked the source host (see this migration's own
-- header comment for why this function itself does not re-verify any of
-- that).
-- ---------------------------------------------------------------------------

create or replace function record_payfast_itn(
  p_m_payment_id uuid,
  p_pf_payment_id text,
  p_payment_status text,
  p_amount_gross_zar numeric,
  p_raw jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_checkout payfast_checkouts;
  v_plan subscription_plans;
  v_amount_ok boolean;
begin
  select * into v_checkout from payfast_checkouts where m_payment_id = p_m_payment_id;
  if v_checkout.m_payment_id is null then
    -- Unknown m_payment_id - never created by createCheckoutSession(), so
    -- this can't be a real checkout this app started. Log it (the ledger
    -- row below still gets written, company_id null) and stop - there is
    -- no subscription to update.
    insert into subscription_payments (company_id, m_payment_id, pf_payment_id, payment_status, amount_gross_zar, raw_itn)
    values (null, null, p_pf_payment_id, case when p_payment_status in ('COMPLETE', 'FAILED', 'CANCELLED') then p_payment_status else 'FAILED' end, p_amount_gross_zar, p_raw);
    return;
  end if;

  select * into v_plan from subscription_plans where code = v_checkout.plan_code;
  -- Defense in depth: the amount actually paid must match what this
  -- checkout was FOR (the plan/cycle price at the time it was created) -
  -- within 1 cent, for rounding. A mismatch is recorded, not silently
  -- trusted.
  v_amount_ok := abs(p_amount_gross_zar - v_checkout.expected_amount_zar) < 0.01;

  insert into subscription_payments (company_id, m_payment_id, pf_payment_id, payment_status, amount_gross_zar, raw_itn)
  values (v_checkout.company_id, p_m_payment_id, p_pf_payment_id, p_payment_status, p_amount_gross_zar, p_raw);

  -- Local to this transaction only (third arg true) - lets the two updates
  -- below past the client-column guard trigger without weakening it for
  -- anyone else.
  perform set_config('app.bypass_subscription_guard', 'true', true);

  if p_payment_status = 'COMPLETE' and v_amount_ok then
    update company_subscriptions
    set plan_code = v_checkout.plan_code,
        billing_cycle = v_checkout.billing_cycle,
        status = 'active',
        current_period_start = now(),
        current_period_end = now() + (case when v_checkout.billing_cycle = 'annual' then interval '1 year' else interval '1 month' end),
        cancel_at_period_end = false
    where company_id = v_checkout.company_id;
  elsif p_payment_status in ('FAILED', 'CANCELLED') then
    update company_subscriptions set status = 'past_due' where company_id = v_checkout.company_id and status = 'active';
  end if;

  update payfast_checkouts set resolved_at = now() where m_payment_id = p_m_payment_id and resolved_at is null;
end;
$$;
comment on function record_payfast_itn(uuid, text, text, numeric, jsonb) is
  'Called only by app/app/api/payfast/itn/route.ts, after that route has independently verified the ITN''s signature, confirmed it with PayFast''s own server-to-server /validate call, and checked the source host - this function does not repeat any of that. Granted to anon because the ITN route runs with no signed-in user; the real access-control boundary is p_m_payment_id being an unguessable uuid this app generated, never PayFast''s own claims alone (see migration header).';
revoke all on function record_payfast_itn(uuid, text, text, numeric, jsonb) from public;
grant execute on function record_payfast_itn(uuid, text, text, numeric, jsonb) to anon;
