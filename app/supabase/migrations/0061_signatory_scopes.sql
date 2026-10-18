-- Multiple authorised signatories per company, optionally scoped to a
-- region and/or industry/discipline (Sarel, 2026-10-18, verbatim: "Add
-- option to record multiple signatories to use for a company and then they
-- select which one to use. A company might get people to tender based on
-- area or type of project.").
--
-- What already existed: people.signatory_capacity (0001) is a free-text
-- field - non-null already means "this person can sign", and
-- submission-pack.tsx / pack-review-data.ts already read EVERY person with
-- a non-null signatory_capacity (not just one), offering a <select> once
-- more than one exists. So "multiple signatories" already worked by
-- accident of there being no single-signatory column to begin with - this
-- migration adds what was actually missing: a place to record which
-- region/industry/discipline each signatory is normally used for, so the
-- per-tender picker can suggest the right one instead of just "the oldest
-- one on file".
--
-- signatory_scopes: zero or more scope rows per person. Each row is one
-- OR'd condition (a region, an industry tag, a discipline tag, or any
-- combination - all the non-null columns on one row must match together;
-- multiple rows mean the person is suggested for any of several areas/
-- types). No rows at all = unscoped - the person is still a full,
-- selectable signatory for every tender, just never the one specifically
-- suggested over another scoped match. This is ADVISORY ONLY (Sarel: picks
-- the "default", never blocks any other choice) - nothing here is read by
-- requestSubmissionPack()'s validation, only by the suggestion logic in
-- signatory-logic.ts.
--
-- industry_tag / discipline_tag reuse discipline_categories (0040) - the
-- same vocabulary tenders.industry_tags / tenders.discipline_tags (0060)
-- are matched against - rather than a second taxonomy. Both migrations
-- landed the same day; this one depends on 0060's columns existing on
-- tenders (read-only there, no FK - tenders is shared/public, not owned by
-- a company) and on 0040's discipline_categories table.
--
-- region is free text (no catalog exists for SA regions/provinces in this
-- schema yet - tenders.region (0001) is itself free text from the source
-- listing), matched case-insensitively against tenders.region.

create table signatory_scopes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  region text,
  industry_tag text references discipline_categories(slug),
  discipline_tag text references discipline_categories(slug),
  created_at timestamptz not null default now(),
  check (region is not null or industry_tag is not null or discipline_tag is not null)
);
create index signatory_scopes_person_idx on signatory_scopes(person_id);
create index signatory_scopes_company_idx on signatory_scopes(company_id);

comment on table signatory_scopes is
  'Optional region/industry/discipline tags on a signatory (people.signatory_capacity, 0001), used only to SUGGEST a default pick on the per-tender signatory selector (signatory-logic.ts pickDefaultSignatory). No row here ever blocks picking a different recorded signatory - the company can always choose any of them for any tender.';
comment on column signatory_scopes.region is
  'Free text, matched case-insensitively against tenders.region (0001) - no SA region/province catalog exists yet in this schema.';
comment on column signatory_scopes.industry_tag is
  'discipline_categories (0040) GROUP slug, matched against tenders.industry_tags (0060).';
comment on column signatory_scopes.discipline_tag is
  'discipline_categories (0040) child slug, matched against tenders.discipline_tags (0060).';

alter table signatory_scopes enable row level security;
create policy "signatory_scopes: tenant isolation" on signatory_scopes
  for all to authenticated
  using (is_company_member(company_id))
  with check (is_company_member(company_id));

-- A person row deleted (deletePerson, actions.ts) cascades its scopes via
-- the FK above - no extra cleanup code needed, same pattern 0044 relies on
-- for projects/cv_uploads/etc.
