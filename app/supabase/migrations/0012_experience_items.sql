-- Company experience library (Sarel, 2026-10-16: "We must have all experience
-- also be able to capture. That can be letter of awards, reference letters,
-- closeout reports, completion certificates... allow for manually updating the
-- attributes to specify what type of experience it shows, which industry,
-- which type of project, which type of service, how we can map that to
-- tenders.")
--
-- Evidence for every column below is in docs/specs/Experience-Library-Findings.md
-- (real tender documents in templates/incoming/, not a generic taxonomy). In
-- short: SANRAL's Form B6 "Past performance experience on reference projects"
-- is worth 15 of 100 functionality points and asks for 3 COMPLETED projects
-- of SIMILAR SCOPE in the LAST 10 YEARS, evidenced by a CIDB Annex 1 PSP
-- Performance Report or a client reference letter, each RATED
-- poor/adequate/good/excellent. Klipcorp's own completed submission
-- (NRA 2026/0084) shows a sworn affidavit declaring 0 completed projects
-- instead - i.e. this evidence was not to hand. Municipal tenders (Dawid
-- Kruiper TN051/2026) ask for 3 contactable references on client letterhead,
-- non-responsive without them.
--
-- This is COMPANY experience, deliberately separate from `projects` (0001),
-- which is ONE PERSON's key-person CV history (Forms B1/B2). Same coded
-- vocabularies are reused (client_type, project_type are SANRAL's own codes,
-- the same values projects.client_type/project_type already hold), and
-- `disciplines` uses exactly the category keys of
-- engine/discovery/assess_tender.py DISCIPLINE_KEYWORDS, so a discovered
-- tender's categorize() output can be matched against this table directly.
--
-- Two separate steps, both required (Sarel's own wording): CAPTURE (upload
-- the document - or record a project with no document yet) and TAGGING (a
-- human states what it shows). tagged_at is null until the second step is
-- done; experience_matches() below only ever counts tagged rows, because an
-- untagged upload hasn't been classified and can't honestly be claimed as
-- matching anything.

insert into storage.buckets (id, name, public)
values ('experience-documents', 'experience-documents', false)
on conflict (id) do nothing;

create table experience_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,

  -- ---- Capture step ----------------------------------------------------
  project_name text not null,          -- as the client's document names it
  -- What kind of evidence this is. Ordered by how tenders actually weigh
  -- them: SANRAL B6 accepts performance_report and reference_letter as
  -- scoreable evidence; completion_certificate / closeout_report prove
  -- completion; award_letter proves appointment only (NOT completion - see
  -- experience_matches()'s completed filter). 'project_record' = a project
  -- captured with no document attached yet (the evidence still has to be
  -- obtained - e.g. ask the client for a reference letter).
  document_type text not null check (document_type in (
    'performance_report', 'reference_letter', 'completion_certificate',
    'closeout_report', 'award_letter', 'project_record', 'other'
  )),
  storage_path text,                   -- 'experience-documents' bucket, "<company_id>/experience/<uuid>-<filename>"
  original_filename text,
  check ((storage_path is null) = (original_filename is null)),

  -- ---- Tagging step (manual, editable any time) --------------------------
  client_name text,                    -- e.g. "Airports Company South Africa"
  contract_number text,                -- e.g. "ORT5737/2018/RFP"
  -- SANRAL's own client codes (Form B1/B2 "CLIENT (coded)", scored in the
  -- managerial-knowledge "Client" criterion). Same values projects.client_type uses.
  client_type text check (client_type in (
    'National Roads Authority', 'Concessionaire', 'Provincial Authority',
    'Relevant SOE', 'Metro Council', 'Municipality', 'Private', 'Other'
  )),
  -- engine/discovery/assess_tender.py DISCIPLINE_KEYWORDS keys - one project
  -- can be several (Klipcorp's own profile is roads_civil + professional_services).
  disciplines text[] not null default '{}' check (disciplines <@ array[
    'roads_civil', 'water', 'buildings', 'electrical_mechanical',
    'it_telecoms', 'professional_services', 'security_facilities'
  ]::text[]),
  -- SANRAL project-type code (e.g. 'DS', 'RRM', 'MP/MS') where one applies;
  -- free text for buyers that don't code project types. Not check-constrained:
  -- SANRAL's list is ~40 codes and buyer-specific, the UI offers it as a
  -- suggestion list (app/lib/experience.ts SANRAL_PROJECT_TYPES).
  project_type text,
  -- Short plain-words scope, the thing tenders actually compare against
  -- ("similar scope e.g. crack sealing, pothole repair..." - SANRAL B6 note 1).
  scope_summary text,
  -- Which services were delivered - the project stages of CIDB Annex 1's
  -- "PSP Performance Report" (the stage the assessment covers).
  service_stages text[] not null default '{}' check (service_stages <@ array[
    'initiation', 'inception', 'concept_viability', 'design_development',
    'documentation_procurement', 'construction', 'close_out'
  ]::text[]),
  value_rm numeric,                    -- R millions, same unit as projects.value_rm and Form B1
  start_date date,
  completion_date date,                -- SANRAL B6/period relevance: within 10 years of closing
  -- The rating on the reference letter / CIDB report itself (SANRAL scores
  -- 1/3/4/5). Null when the document carries no rating (award letters etc.).
  performance_rating text check (performance_rating in ('poor', 'adequate', 'good', 'excellent')),
  -- Contactable reference (municipal tenders: "3 contactable references").
  reference_contact_name text,
  reference_contact_phone text,
  reference_contact_email text,
  notes text,

  tagged_at timestamptz,               -- null = captured but not yet tagged
  tagged_by uuid references auth.users(id),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table experience_items is
  'Company-level experience evidence (reference letters, CIDB performance reports, completion certificates, close-out reports, award letters, or a bare project record). One row per item. tagged_at null = uploaded but not yet classified. Query via experience_matches(). See docs/specs/Experience-Library-Findings.md.';

create index experience_items_company_idx on experience_items (company_id, completion_date desc);
create index experience_items_disciplines_idx on experience_items using gin (disciplines);

alter table experience_items enable row level security;

create policy "experience_items: tenant isolation" on experience_items
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

create trigger experience_items_set_updated_at before update on experience_items
  for each row execute function set_updated_at();

-- Same storage RLS shape as 'cv-documents' (0008): objects keyed "<company_id>/...".
create policy "experience-documents: tenant isolation by path prefix" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'experience-documents'
    and is_company_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'experience-documents'
    and is_company_member((storage.foldername(name))[1]::uuid)
  );

-- ============================================================================
-- experience_matches(): "does this company have experience matching tender
-- requirement X?" - the one query a compliance check needs. Every filter is
-- optional (null = don't filter on it). Only TAGGED rows are ever returned.
--
--   p_disciplines            overlap with experience_items.disciplines
--                            (pass assess_tender.py categorize() output as-is)
--   p_project_types          exact match on project_type (SANRAL codes)
--   p_client_types           exact match on client_type
--   p_min_value_rm           value_rm >= this
--   p_completed_within_years completion_date within N years before p_as_of
--                            (SANRAL B6: 10). Also excludes items with no
--                            completion date, and award letters by
--                            definition can't prove completion unless a
--                            completion date has been tagged on them.
--   p_as_of                  reference date, normally the tender closing date
--                            (defaults to today)
--
-- SECURITY INVOKER (the default): RLS still applies for signed-in callers, so a
-- user only ever sees their own company. A service-role caller (engine/) is not
-- RLS-limited, which is why p_company_id is a required, explicit filter.
--
-- Example (SANRAL B6-style: completed roads work in the last 10 years):
--   select count(*) from experience_matches('<company uuid>',
--     p_disciplines => array['roads_civil'], p_completed_within_years => 10,
--     p_as_of => '2026-10-22');
-- From supabase-js:  supabase.rpc('experience_matches', { p_company_id, p_disciplines: ['roads_civil'], p_completed_within_years: 10 })
-- ============================================================================
create or replace function experience_matches(
  p_company_id uuid,
  p_disciplines text[] default null,
  p_project_types text[] default null,
  p_client_types text[] default null,
  p_min_value_rm numeric default null,
  p_completed_within_years int default null,
  p_as_of date default current_date
)
returns setof experience_items
language sql
stable
as $$
  select e.*
  from experience_items e
  where e.company_id = p_company_id
    and e.tagged_at is not null
    and (p_disciplines is null or e.disciplines && p_disciplines)
    and (p_project_types is null or e.project_type = any (p_project_types))
    and (p_client_types is null or e.client_type = any (p_client_types))
    and (p_min_value_rm is null or e.value_rm >= p_min_value_rm)
    and (p_completed_within_years is null or (
          e.completion_date is not null
          and e.completion_date <= p_as_of
          and e.completion_date >= (p_as_of - make_interval(years => p_completed_within_years))::date
        ))
  order by e.completion_date desc nulls last, e.created_at desc;
$$;
comment on function experience_matches is
  'Tagged experience_items for one company matching optional discipline / project-type / client-type / min-value / completed-within-N-years filters. See 0012_experience_items.sql header and docs/specs/Experience-Library-Findings.md.';
