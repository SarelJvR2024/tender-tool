-- Time and cost saved counter (spec §9, Tender-Ready-Claude-Spec_v1.md).
-- Calculation-and-display only - no engine rules, prices, entitlements or
-- permissions changed by this migration, per the spec's own ground rule 0.

-- Company baseline: "hours your team usually spends on one tender" and
-- "cost per hour of that person's time" - editable in onboarding and on
-- /company (lib/companyProfileUpdate.ts's shared COMPANY_NUMERIC_FIELDS),
-- same column-on-companies pattern as 0030's how_we_work. Defaults match
-- the spec's own placeholders (20 hours, R450/hour) exactly - these are
-- NOT measured figures, just the spec's suggested starting point until the
-- owner supplies real timed numbers from an actual tender (§9's own note:
-- "Default hours per step are placeholders until the owner supplies timed
-- figures from a real tender").
alter table companies add column savings_baseline_hours_per_tender numeric not null default 20;
alter table companies add column savings_baseline_hourly_cost_zar numeric not null default 450;

alter table companies add constraint companies_savings_baseline_hours_nonneg
  check (savings_baseline_hours_per_tender >= 0);
alter table companies add constraint companies_savings_baseline_cost_nonneg
  check (savings_baseline_hourly_cost_zar >= 0);

comment on column companies.savings_baseline_hours_per_tender is
  'Hours this company''s team usually spends on one tender without Tender Ready - the cap on how many hours a single tender can ever be credited with saving (lib/savingsCounter.ts). Editable on /company and in onboarding step 2. Default 20 is the spec''s own placeholder, not a measured figure.';
comment on column companies.savings_baseline_hourly_cost_zar is
  'Rand cost per hour of that team''s time, used to convert hours saved into Rand saved (lib/savingsCounter.ts). Editable on /company and in onboarding step 2. Default 450 is the spec''s own placeholder, not a measured figure.';

-- Per-tender, per-step dedupe: "each completed step adds a fixed number of
-- hours... only completed steps count, each once per tender (re-runs don't
-- add)" (§9.2). A tender can be shared/unowned (owner_company_id null -
-- see general-workspace.tsx's own "isShared" handling), so company_id is
-- captured explicitly here rather than inferred by joining through tenders -
-- the company that actually did the work, not whichever company happens to
-- own the tender row (if any). hours is a SNAPSHOT of the step's configured
-- hour value at the moment it was counted (lib/savingsCounter.ts's
-- SAVINGS_STEP_HOURS table) - if the owner later retunes that config with
-- real timed figures, past counts stay historically accurate instead of
-- silently reinterpreting themselves.
create table savings_counted_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  step_key text not null,
  hours numeric not null check (hours >= 0),
  counted_at timestamptz not null default now(),
  unique (company_id, tender_id, step_key)
);
comment on table savings_counted_steps is
  'One row per (company, tender, step) the first time that step is completed - the unique constraint is the once-per-tender dedupe check itself (an insert that violates it is treated as "already counted", not an error - see recordSavingsStep() in lib/savingsCounter.ts). Powers the Home counter card''s this-month/all-time totals and the final review screen''s "how we worked this out" breakdown. Spec §9.2/§9.3.';

alter table savings_counted_steps enable row level security;
create policy "savings_counted_steps: tenant isolation" on savings_counted_steps
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

-- NOTE for whoever next has SUPABASE_DB_URL loaded: this migration has only
-- been checked against the house style of 0030/0079/0083 (column-on-
-- companies pattern, tenant-isolation RLS pattern) - it has NOT been run
-- against a real Postgres, since this environment has no SUPABASE_DB_URL
-- (see docs/specs/System-Status.md's "Resume here" section on the separate,
-- still-open live-migrations gap). Replay this migration for real before
-- trusting it in production.
