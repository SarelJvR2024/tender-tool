-- Tender Tool: initial schema.
--
-- Tenant-aware from day one, per the explicit decision (2026-10-15): v1 ships as a
-- single-company (Klipcorp) tool, but every tenant-scoped table carries company_id and
-- is isolated by Row Level Security from the start, so opening this to other companies
-- later is adding a signup flow - not a data-model migration.
--
-- Two kinds of table here:
--   - SHARED/PUBLIC: tenders, tender_requirements, tender_documents. SANRAL's own public
--     tender data - the same tender looks the same to every company. Readable by any
--     authenticated user; only the backend engine (service role) writes to them, via the
--     discovery pipeline - never a client directly.
--   - TENANT-SCOPED: companies, people, projects, tender_packs, tender_pack_assignments,
--     financial_captures, generated_documents. Isolated per company_id via RLS.
--
-- Run via the Supabase SQL editor or `supabase db push`.

create extension if not exists "pgcrypto";

-- ============================================================================
-- Tenant & membership
-- ============================================================================

create table companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  csd_trading_name text,
  cipc_registration_number text,
  vat_number text,
  income_tax_number text,
  paye_number text,
  csd_supplier_number text,
  coid_registration_number text,
  coid_letter_of_good_standing_number text,
  coid_letter_of_good_standing_expiry date,
  bee_level int,
  black_ownership_pct numeric,
  bee_procurement_recognition_pct numeric,
  status text, -- e.g. "QSE"
  registered_address text,
  postal_address text,
  head_office text,
  other_offices int default 0,
  ecsa_registered_staff_count int default 0,
  sacpcmp_registered_staff_count int default 0,
  total_employees int,
  typical_jv_share_pct numeric,
  bank_name text,
  bank_branch_code text,
  -- Deliberately NOT storing a bank account number here - same rule the CLI engine
  -- already follows (fill_docx_forms.py writes "WITHHELD" and never persists it).
  -- If this is ever needed, it goes in a separate, more tightly-restricted table.
  director_name text,
  -- director_id_number: real PII, same caution as people.id_number below.
  director_id_number text,
  logo_storage_path text, -- path in Supabase Storage, not the file itself
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table companies is 'The tenant. One row per company using the tool.';
comment on column companies.director_id_number is
  'Real PII. Column-level access should be restricted further than the general RLS policy once auth design is finalised - do not expose this in any list/summary view.';

create table company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);
comment on table company_members is
  'Links an auth.users account to a company. v1 has one company; this table makes multi-user and multi-company support additive, not a migration.';

-- Helper used by every tenant-scoped RLS policy below. SECURITY DEFINER so it can read
-- company_members regardless of the calling policy's own RLS context.
create or replace function is_company_member(check_company_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from company_members
    where company_id = check_company_id
      and user_id = auth.uid()
  );
$$;

-- ============================================================================
-- People (CVs / key persons) & their project history
-- ============================================================================

create table people (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  -- Real PII (a South African ID number). Confirmed via this project's own history
  -- (2026-10-15) that these must be stored/written as TEXT, never as a number -
  -- int() silently drops a leading zero, which many real SA ID numbers have.
  id_number text,
  description text, -- e.g. "Contracts Engineer"
  role text, -- the person's actual job title at the company
  signatory_capacity text, -- single source of truth for docs that need it (A2 letter, C.1.1.1, C.1.2.3) -
  -- confirmed 2026-10-15 that hardcoding this separately in two form-fillers is exactly how it drifted out of sync before
  phone text,
  email text,
  ecsa_level text,
  ecsa_number text,
  ecsa_date date,
  sacpcmp_number text,
  sacpcmp_date date,
  highest_level text,
  highest_description text,
  highest_institution text,
  highest_graduated date, -- years_experience is ALWAYS computed from this relative to a
  -- specific tender's closing date, never stored as a static number (confirmed bug, 2026-10-15:
  -- a stored "17" was actually wrong by the time it was checked against a real form)
  initial_description text,
  initial_institution text,
  initial_graduated date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column people.id_number is 'Real PII. Store as text, never cast to int.';

create table projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  client_and_number text not null,
  client_type text, -- SANRAL's own coded value, e.g. "Relevant SOE"
  project_type text, -- e.g. "DS"
  position_code text, -- e.g. "CE"
  position_held text, -- e.g. "Contract Engineer"
  value_rm numeric,
  contact_name text,
  contact_phone text,
  contact_email text,
  start_date date,
  end_date date,
  -- B6 past-performance matching status: how confident we are this project's cited
  -- contract number matches a real signed performance report. Never silently assumed.
  contact_match_confidence text check (
    contact_match_confidence in ('confirmed', 'partially_confirmed', 'unconfirmed', 'missing')
  ),
  source_note text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Tenders (SHARED/PUBLIC - the daily discovery pipeline's own output)
-- ============================================================================

create table tenders (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, -- e.g. "r-334-030-2025-1f"
  contract_no text, -- e.g. "R.334-030-2025/1F"
  nra_reference text,
  title text,
  description text,
  region text,
  closing_date timestamptz,
  family text, -- "Conventional Consultant Tender" | "RRM Consultant Tender" | "UNKNOWN"
  status text not null default 'open' check (status in ('open', 'closed', 'awarded', 'cancelled')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
comment on table tenders is
  'SANRAL''s own public tender data, discovered daily. Shared across every company - not tenant-scoped. Written only by the discovery pipeline (service role).';

create table tender_requirements (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  position_code text not null, -- e.g. "PL", "DS1"
  position_description text, -- e.g. "Design Specialist 1 - Pavement and Materials"
  managerial boolean not null default false,
  is_alternate boolean not null default false, -- SETUP row 5 "ALT" marker
  unique (tender_id, position_code, is_alternate)
);
comment on table tender_requirements is
  'Read straight from each tender''s own SETUP sheet - never guessed. One row per required key position.';

create table tender_documents (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  doc_type text not null check (doc_type in (
    'technical_xlsm', 'financial_xlsm', 'c111_form_of_offer', 'c123_contract_data', 'a_forms'
  )),
  storage_path text not null, -- Supabase Storage path to the blank template
  downloaded_at timestamptz not null default now(),
  unique (tender_id, doc_type)
);
comment on table tender_documents is
  'The blank SANRAL template files for a tender - public boilerplate, shared across companies. Downloaded manually (reCAPTCHA v3 blocks automation here by design - see docs/specs/tender-compilation-playbook.md section 1a) then uploaded once per tender, not once per company.';

-- ============================================================================
-- Per-company work on a tender
-- ============================================================================

create table tender_packs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  status text not null default 'suggested' check (status in ('suggested', 'confirmed', 'filled')),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, tender_id)
);
comment on table tender_packs is
  'One per company per tender. Mirrors the CLI pack_generator''s suggest/confirm flow: status stays "suggested" until a named human confirms every position in tender_pack_assignments.';

create table tender_pack_assignments (
  id uuid primary key default gen_random_uuid(),
  tender_pack_id uuid not null references tender_packs(id) on delete cascade,
  position_code text not null,
  suggested_person_id uuid references people(id),
  suggested_score int,
  suggested_rationale text,
  specialism_warning boolean not null default false,
  confirmed_person_id uuid references people(id), -- null until a human confirms
  created_at timestamptz not null default now(),
  unique (tender_pack_id, position_code)
);
comment on table tender_pack_assignments is
  'Per-position AI suggestion + human confirmation. confirmed_person_id stays null - and the tender_pack stays "suggested", never advances to fill - until a human sets it, same hard gate confirm_pack.py already enforces in the CLI.';

create table financial_captures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'complete')),
  hours_tendered numeric,
  normalised_hours numeric,
  -- Deliberately minimal for now - this is the new piece (2026-10-15) and the real
  -- structure (hours-by-discipline, C3.x pricing detail, F1 Forecast, ADJ sheets,
  -- SUMMARY TENDERED FEE) is still being mapped from the real Financial Submission
  -- workbook (docs/specs/financial-submission-workbook.md). Extend this table as each
  -- piece is confirmed against a real file - never guessed ahead of that confirmation.
  raw_capture jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (company_id, tender_id)
);
comment on table financial_captures is
  'The real pricing/hours figures for a tender - always supplied by a human, never computed or guessed, same rule the CLI engine has followed from the start (fill_conventional.py refuses to touch FORM C2.4 TECH without real figures).';

create table generated_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  doc_type text not null, -- e.g. "technical_filled", "financial_filled", "c111_filled",
  -- "a2_authority_letter", "envelope_cover_outer", "envelope_cover_technical", "envelope_cover_financial"
  storage_path text not null,
  generated_by uuid references auth.users(id),
  generated_at timestamptz not null default now()
);
comment on table generated_documents is
  'Output files - the tenant-specific, real-data equivalent of the CLI''s gitignored out/ directory.';

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table companies enable row level security;
alter table company_members enable row level security;
alter table people enable row level security;
alter table projects enable row level security;
alter table tenders enable row level security;
alter table tender_requirements enable row level security;
alter table tender_documents enable row level security;
alter table tender_packs enable row level security;
alter table tender_pack_assignments enable row level security;
alter table financial_captures enable row level security;
alter table generated_documents enable row level security;

-- Shared/public tables: any authenticated user can read; only the service role
-- (the discovery pipeline, run outside RLS) writes.
create policy "tenders readable by authenticated users" on tenders
  for select to authenticated using (true);
create policy "tender_requirements readable by authenticated users" on tender_requirements
  for select to authenticated using (true);
create policy "tender_documents readable by authenticated users" on tender_documents
  for select to authenticated using (true);

-- companies: a user can see/edit only the company they're a member of.
create policy "companies: members can select" on companies
  for select to authenticated using (is_company_member(id));
create policy "companies: members can update" on companies
  for update to authenticated using (is_company_member(id));
-- No public insert policy: creating a new company is a privileged, backend-mediated
-- action (it must also create the first company_members row atomically), not a bare
-- client-side insert.

create policy "company_members: members can select their own company's roster" on company_members
  for select to authenticated using (is_company_member(company_id));

-- Tenant-scoped tables: standard "all four verbs, gated by company_id membership".
create policy "people: tenant isolation" on people
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

create policy "projects: tenant isolation" on projects
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

create policy "tender_packs: tenant isolation" on tender_packs
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

create policy "tender_pack_assignments: tenant isolation via parent pack" on tender_pack_assignments
  for all to authenticated using (
    exists (select 1 from tender_packs tp where tp.id = tender_pack_id and is_company_member(tp.company_id))
  ) with check (
    exists (select 1 from tender_packs tp where tp.id = tender_pack_id and is_company_member(tp.company_id))
  );

create policy "financial_captures: tenant isolation" on financial_captures
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

create policy "generated_documents: tenant isolation" on generated_documents
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

-- ============================================================================
-- updated_at maintenance
-- ============================================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger companies_set_updated_at before update on companies
  for each row execute function set_updated_at();
create trigger people_set_updated_at before update on people
  for each row execute function set_updated_at();
create trigger financial_captures_set_updated_at before update on financial_captures
  for each row execute function set_updated_at();
