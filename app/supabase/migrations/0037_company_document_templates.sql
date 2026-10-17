-- Company-owned letters and documents: upload your own, or generate it from
-- your own guideline (Sarel, 2026-10-17, Hardcoded-Assumptions-Audit Q7):
--   "each company must have the option to upload their own docs or templates,
--    or provide a guideline of how AI engine must generate their docs - not
--    just this letter but all docs and letters that might be needed."
--
-- Before this, engine/fill_authority_letter.py wrote Klipcorp's own historical
-- "Letter of Authority to Sign" wording into EVERY company's pack. One row here
-- is one company's choice for one document type, the same two-way choice the CV
-- engine already offers (cv_uploads.mode, 0008):
--
--   mode = 'uploaded'      the company's own real document (storage_path, in the
--                          private company-documents bucket under
--                          "<company_id>/templates/<document_type>/..."), used
--                          as-is, unmodified, every time this document is needed.
--   mode = 'ai_guideline'  the company's own wording for this document (guideline),
--                          with {{field}} marks for the tender's details. The
--                          engine fills the marks and changes nothing else -
--                          same verbatim rule as companies.how_we_work (0030).
--   no row                 "not set up": the pack lists the document as not
--                          included. Nothing is generated in its place.
--
-- Both storage_path and guideline are kept when the mode is switched, so going
-- back loses nothing; the CHECK only requires the one the mode uses.
--
-- document_type is an open slug, not a fixed list (same reason as 0036): the
-- engine's registry (engine/company_documents.py DOCUMENT_TYPES) and the app's
-- (app/lib/companyDocuments.ts) name the types that are wired in today; a new
-- document type is code, not a migration.
--
-- Storage: no new bucket or policy - company-documents' path-prefix policy
-- (0014: is_company_member(first path segment)) already covers any path under
-- the company's own id.

create table company_document_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  document_type text not null,
  mode text not null check (mode in ('uploaded', 'ai_guideline')),
  storage_path text,
  original_filename text,
  guideline text,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, document_type),
  constraint company_document_templates_type_format check (document_type ~ '^[a-z][a-z0-9_]*$'),
  constraint company_document_templates_guideline_length check (guideline is null or char_length(guideline) <= 10000),
  constraint company_document_templates_mode_content check (
    (mode = 'uploaded' and storage_path is not null)
    or (mode = 'ai_guideline' and guideline is not null and btrim(guideline) <> '')
  )
);

comment on table company_document_templates is
  'One company''s choice for one letter/document type: uploaded (its own file, used as-is) or ai_guideline (its own wording with {{field}} marks, filled verbatim by engine/company_documents.py). No row = not set up - the engine produces nothing rather than another company''s wording. See Hardcoded-Assumptions-Audit.md Q7.';
comment on column company_document_templates.guideline is
  'The company''s own wording for this document, with {{field}} marks (e.g. {{signatory_name}}, {{tender_reference}}) where the tender''s details go. Used verbatim - never paraphrased or padded by an AI step.';

alter table company_document_templates enable row level security;

create policy "company_document_templates: tenant isolation" on company_document_templates
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));
