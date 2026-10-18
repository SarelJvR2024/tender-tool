-- Bulk onboarding document scan: a company drops in a whole folder/zip of
-- whatever compliance documents it already has, instead of uploading and
-- tagging one at a time. Same proposal/confirm shape as the CV AI-extraction
-- pipeline (0023, engine/cv/extract_cv_fields.py) - the precedent this is
-- modelled on directly, not reinvented:
--
--   upload (straight to Storage from the browser, many files at once) ->
--   onboarding_uploads row per file, status 'classification_requested' ->
--   engine/onboarding/process_onboarding_jobs.py claims it, calls
--   engine/onboarding/classify_documents.py (OCR fallback, ONE structured
--   LLM call per document, quote-verification against the source text,
--   exactly as extract_cv_fields.py does) -> onboarding_document_results row,
--   review_status 'pending_review' -> the review screen (app/app/company/
--   document-scan) shows detected type + fields, per field verified/not ->
--   ONLY the explicit "Confirm" action writes anything to a real table, and
--   it writes to the ALREADY-EXISTING slot for that document type (the
--   Document Vault columns on `companies`, 0014; held_registrations, 0050;
--   experience_items, 0012; or, for a CV, a handoff into the existing
--   cv_uploads/cv_extraction_results pipeline, 0008/0023 - never a second,
--   parallel CV extraction). No new generic "document type" storage model.
--
-- A fresh private bucket, not 'company-documents' (the vault): these are
-- unclassified, unconfirmed files - nothing in them is trusted yet, so they
-- don't belong in the same bucket real compliance documents live in. Same
-- path-prefix tenant isolation as every other bucket here
-- ("<company_id>/<uuid>-<filename>", no batch subfolder needed - batch_id is
-- a plain column, not a storage path segment, so a cloud-storage connector
-- feeding this same table later doesn't need one either).
--
-- batch_id is a client-generated uuid grouping the files from one upload
-- session for the review screen (same "client generates the id, no separate
-- batches table" pattern as manual tender load's tenderId - app/lib/
-- manualTender.ts) - deliberately not its own table: nothing about a batch
-- is ever queried except "every upload with this batch_id", and a batch has
-- no status of its own beyond the sum of its rows' statuses.

-- Correction found while building this (not in the task's own v1 mapping,
-- which assumed CIDB routes to held_registrations): 0050's own seed row for
-- 'cidb' sets stored_in = 'companies.cidb_grading', and
-- tt_held_registrations_check() REFUSES a held_registrations row for any
-- registration_type with stored_in set - so a CIDB certificate can NOT go
-- into held_registrations; that would fail at insert. companies.cidb_grading
-- (0018) is a plain text column with no document or expiry slot at all - the
-- one real gap in the Document Vault (0014 covers COID/SARS/PI
-- insurance/ISO/bank/B-BBEE, but never CIDB). Filling that gap the same way
-- 0014 did for every other vault document, rather than forcing CIDB through
-- the wrong table, is a 2-column addition, not a new storage model.
alter table companies
  add column cidb_expiry date,
  add column cidb_document_path text;
comment on column companies.cidb_document_path is
  'The uploaded CIDB grading certificate itself. cidb_grading (0018) already held the grading as text with nowhere to attach the document or an expiry - this completes it, same pattern as every other Document Vault column (0014).';

insert into storage.buckets (id, name, public)
values ('onboarding-documents', 'onboarding-documents', false)
on conflict (id) do nothing;

create policy "onboarding-documents: tenant isolation by path prefix" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'onboarding-documents'
    and is_company_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'onboarding-documents'
    and is_company_member((storage.foldername(name))[1]::uuid)
  );

-- ============================================================================
-- onboarding_uploads: one row per uploaded file, same request/status shape as
-- cv_uploads (0008). mode is always, in effect, "ai_extract" here (there is
-- no "use as-is" choice for a document whose type isn't even known yet), so
-- there is no mode column - just status.
-- ============================================================================

create table onboarding_uploads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  batch_id uuid not null,
  storage_path text not null,
  original_filename text not null,
  status text not null default 'classification_requested' check (status in (
    'classification_requested', 'classifying', 'classified', 'classification_failed'
  )),
  classification_claimed_at timestamptz,
  classification_completed_at timestamptz,
  classification_error text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (tt_path_in_company(storage_path, company_id))
);
create index onboarding_uploads_batch_idx on onboarding_uploads (batch_id);
create index onboarding_uploads_company_idx on onboarding_uploads (company_id, created_at desc);
comment on table onboarding_uploads is
  'One row per file in a bulk onboarding upload (local folder/zip only, this pass - a cloud-storage connector could feed the same table later). engine/onboarding/process_onboarding_jobs.py claims classification_requested rows. Written by the browser (company member RLS) on insert; status fields written by the worker (service role).';

-- ============================================================================
-- onboarding_document_results: the AI-proposed classification + extracted
-- fields for one upload, held for a human to confirm, correct or discard -
-- never written to a real table automatically. Same shape as
-- cv_extraction_results (0023).
-- ============================================================================

create table onboarding_document_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  onboarding_upload_id uuid not null unique references onboarding_uploads(id) on delete cascade,
  -- v1 types, each with an existing table/column to route into (see header),
  -- plus the two cases that are explicitly NOT routed automatically:
  -- 'professional_registration_other' (ECSA/SACPCMP/PSIRA/... - dedicated
  -- per-person UI, higher stakes, flagged to add manually) and 'unknown'
  -- (model couldn't tell, or said so itself).
  document_kind text not null check (document_kind in (
    'cidb_registration', 'bbbee_certificate', 'sars_tax_clearance', 'id_document', 'cv',
    'bank_confirmation_letter', 'pi_insurance_certificate', 'iso_9001_certificate',
    'experience_reference_letter', 'professional_registration_other', 'unknown'
  )),
  document_kind_reason text,
  -- {"<field>": {"value", "evidence", "verified", "warnings": [..]}, ...} -
  -- same per-field shape as cv_extraction_results.proposed.person. The field
  -- set depends on document_kind; see classify_documents.py KIND_FIELDS.
  fields jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  text_method text,
  source_pages int,
  source_text_chars int,
  model text,
  usage jsonb,
  review_status text not null default 'pending_review'
    check (review_status in ('pending_review', 'applied', 'skipped', 'discarded')),
  -- Where it actually went: {"table": "held_registrations", "id": "<uuid>"} /
  -- {"table": "companies", "column": "bee_proof_document_path"} /
  -- {"table": "experience_items", "id": "<uuid>"} / {"handed_off_to": "cv_uploads", "id": "<uuid>"}.
  -- Provenance for "where did this value come from", same role as
  -- cv_extraction_results.applied.
  applied jsonb,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index onboarding_document_results_company_idx on onboarding_document_results (company_id, review_status);
comment on table onboarding_document_results is
  'AI-proposed document type + extracted fields from one onboarding upload, each field with the source quote it was read from. Never applied automatically: the review screen (app/app/company/document-scan) writes only on explicit confirm, routing to the correct EXISTING table/column for that document_kind. Written by engine/onboarding/classify_documents.py (service role).';

alter table onboarding_uploads enable row level security;
create policy "onboarding_uploads: members read" on onboarding_uploads
  for select to authenticated using (is_company_member(company_id));
create policy "onboarding_uploads: members insert" on onboarding_uploads
  for insert to authenticated with check (is_company_member(company_id));
-- No member update/delete: status is worker-owned; a company starts a fresh
-- upload rather than editing one mid-flight. The worker writes with the
-- service role (bypasses RLS), same as every other bridge.

alter table onboarding_document_results enable row level security;
create policy "onboarding_document_results: members read" on onboarding_document_results
  for select to authenticated using (is_company_member(company_id));
create policy "onboarding_document_results: members review" on onboarding_document_results
  for update to authenticated
  using (is_company_member(company_id))
  with check (is_company_member(company_id));
-- No member insert/delete, same reasoning as cv_extraction_results: a
-- proposal only ever comes from the classification step, and its history
-- (including what was discarded) is kept.
