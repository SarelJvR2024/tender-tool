create table company_tender_preferences (
  company_id uuid primary key references companies(id) on delete cascade,
  hide_sanral_board boolean not null default false,
  interested_disciplines text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create index company_tender_preferences_disciplines_idx
  on company_tender_preferences using gin (interested_disciplines);
comment on table company_tender_preferences is
  'Per-company opportunity preferences: whether to hide the shared tenders table''s SANRAL board for companies not interested in SANRAL work, and which disciplines (same taxonomy as discipline_categories/0040) the company cares about for Discovery. One row per company, upserted from the Opportunity preferences panel on /discovery.';
alter table company_tender_preferences enable row level security;
create policy company_tender_preferences_select on company_tender_preferences
  for select to authenticated using (is_company_member(company_id));
create policy company_tender_preferences_upsert on company_tender_preferences
  for insert to authenticated with check (is_company_member(company_id));
create policy company_tender_preferences_update on company_tender_preferences
  for update to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));
