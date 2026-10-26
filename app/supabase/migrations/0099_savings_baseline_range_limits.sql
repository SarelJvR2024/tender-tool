-- Capacity Unlocked brief (2026-10-26): the savings baseline fields (0085)
-- are now bounded in the edit form (Company Settings) and in
-- lib/companyProfileUpdate.ts's own server-side validation - 10-40 hours,
-- R250-R1 500/hour. This migration backs that with a matching Postgres
-- CHECK constraint, same defence-in-depth reasoning as the existing
-- companies_savings_baseline_*_nonneg checks (0085): the app-level
-- validation is the first line of defence, this is the one a direct write
-- bypassing the form can't get past either.

-- Defensive clamp first: a company whose value was written before this
-- range existed (there was no upper/lower bound at all until now) could
-- otherwise make `ADD CONSTRAINT` fail outright if any row already sits
-- outside the new range - this repo's own "replay before trusting in
-- production" caution (0085's note) means that can't be ruled out here.
update companies set savings_baseline_hours_per_tender = 20
  where savings_baseline_hours_per_tender < 10 or savings_baseline_hours_per_tender > 40;
update companies set savings_baseline_hourly_cost_zar = 450
  where savings_baseline_hourly_cost_zar < 250 or savings_baseline_hourly_cost_zar > 1500;

alter table companies add constraint companies_savings_baseline_hours_range
  check (savings_baseline_hours_per_tender >= 10 and savings_baseline_hours_per_tender <= 40);
alter table companies add constraint companies_savings_baseline_cost_range
  check (savings_baseline_hourly_cost_zar >= 250 and savings_baseline_hourly_cost_zar <= 1500);

comment on column companies.savings_baseline_hours_per_tender is
  'Hours this company''s team usually spends on one tender without Tender Ready - the cap on how many hours a single tender can ever be credited with saving (lib/savingsCounter.ts). Editable on /company (10-40h range, lib/companyProfileUpdate.ts + companies_savings_baseline_hours_range). Default 20 is the spec''s own placeholder, not a measured figure.';
comment on column companies.savings_baseline_hourly_cost_zar is
  'Rand cost per hour of that team''s time, used to convert hours saved into Rand saved (lib/savingsCounter.ts). Editable on /company (R250-R1500 range, lib/companyProfileUpdate.ts + companies_savings_baseline_cost_range). Default 450 is the spec''s own placeholder, not a measured figure.';

-- NOT VERIFIED AGAINST A REAL POSTGRES - this environment has no
-- SUPABASE_DB_URL (same documented gap 0085's own note names). Replay this
-- migration for real before trusting it in production, same caution as
-- every other migration written under that gap.
