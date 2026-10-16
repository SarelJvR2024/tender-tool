-- CV upload + generated-CV tracking (spec: "CVs: upload once, never recapture" +
-- "Use as-is option", docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md).
--
-- Two integration points, per Sarel's own direction (2026-10-16):
--   A. On CV upload (People page): a person uploads a CV once, with an explicit
--      choice - AI-extract + pre-generate the standard (non-tender-specific) CV
--      formats right away, or use the uploaded file exactly as-is (no AI at all).
--   B. On tender pack compilation (Tender Workspace): a "Generate tender-specific
--      CV" action for a chosen key person on that tender.
--
-- Architectural reality this schema is built around: the web app (Vercel/Next.js)
-- cannot run Python or LibreOffice, and engine/cv/generate_cv.py (python-docx +
-- soffice) is the one real generation implementation - see engine/cv/README.md
-- and CV-Engine-Findings.md. So generation is NOT synchronous from a web request.
-- These tables are request/status records that a human-run or scheduled process
-- (engine/cv/process_cv_jobs.py, this pass) picks up and fulfills by actually
-- running generate_cv.py - same bridge shape as engine/write_admin_harness_results.py
-- already uses for admin_harness.py. The UI shows requested/generating/ready/failed,
-- never a synchronous result.
--
-- Storage: same pattern as companies.logo_storage_path / tender_documents.storage_path
-- (a path in Supabase Storage, not the file itself). New private bucket
-- 'cv-documents', one bucket for both uploaded originals and generated output,
-- distinguished by the path prefix (see the upload/job-runner code for the
-- convention: "<company_id>/people/<person_id>/uploads/..." and ".../generated/...").

insert into storage.buckets (id, name, public)
values ('cv-documents', 'cv-documents', false)
on conflict (id) do nothing;

-- ============================================================================
-- cv_uploads: the original file a person's CV was uploaded as, and the mode
-- chosen at upload time. people has no file-storage column at all today
-- (flagged in System-Status.md "New spec requirement" section) - this is that
-- gap, as its own table rather than a column, because a person's CV gets
-- replaced over time (re-upload = a new row, not an overwrite) and "use as-is"
-- needs the exact original file kept, never re-rendered.
-- ============================================================================

create table cv_uploads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  storage_path text not null,
  original_filename text not null,
  -- 'as_is': this exact file is what gets attached to a submission for this
  --   person - no AI involvement at all, no re-extraction, no reformatting.
  -- 'ai_extract': an AI step reads this file and extracts the structured
  --   people/projects fields (qualifications, ECSA/SACPCMP, project history,
  --   years-of-experience inputs) for a human confirm/correct, and the standard
  --   (non-tender-specific) CV template formats get pre-generated right away -
  --   see generated_cvs below - so they're sitting there ready to view any time
  --   someone looks at this person, not generated lazily on first view.
  mode text not null check (mode in ('as_is', 'ai_extract')),
  -- 'uploaded': terminal state for mode='as_is' - nothing further happens.
  -- 'extraction_requested'/'extracting'/'extracted'/'extraction_failed': the
  --   mode='ai_extract' pipeline. Extraction itself (reading the file and
  --   proposing field values) is NOT built in this pass - see
  --   docs/specs/System-Status.md for this as a named, deferred gap, not a
  --   silently skipped one. This column exists so the UI can show real status
  --   once that step exists, rather than needing another migration for it.
  status text not null default 'uploaded' check (status in (
    'uploaded', 'extraction_requested', 'extracting', 'extracted', 'extraction_failed'
  )),
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
comment on table cv_uploads is
  'One row per CV file upload for one person. Re-uploading a newer CV is a new row (history kept), not an overwrite - see the "upload once, never recapture" spec section. mode=as_is means this exact file is the submission attachment; mode=ai_extract queues field extraction + standard-format pre-generation (see generated_cvs).';

create index cv_uploads_person_idx on cv_uploads (person_id, created_at desc);

-- ============================================================================
-- generated_cvs: one row per requested CV document (standard or tender-specific),
-- in one engine/cv/generate_cv.py format/detail combination. Fulfilled
-- out-of-band by engine/cv/process_cv_jobs.py, which actually runs generate_cv.py
-- and uploads the result - this table is the request + status + result pointer,
-- never a synchronous generation result.
-- ============================================================================

create table generated_cvs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  -- null = standard CV (no cover page, generic - e.g. for an EOI). Set together
  -- with position_code = tender-customized CV with the requirement-matching
  -- cover page (generate_cv.py's --tender/--position), built on
  -- tender_pack_assignments' own suggested_score/suggested_rationale -
  -- suggest_pack.py's own scoring, never a new matcher, same rule the CLI follows.
  tender_id uuid references tenders(id) on delete cascade,
  tender_pack_id uuid references tender_packs(id) on delete cascade,
  position_code text,
  format text not null check (format in ('sanral_keyperson', 'world_bank')),
  detail text not null check (detail in ('summary', 'detailed')),
  status text not null default 'requested' check (status in (
    'requested', 'generating', 'ready', 'failed'
  )),
  storage_path_docx text,
  storage_path_pdf text,
  error_message text,
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((tender_id is null) = (position_code is null))
);
comment on table generated_cvs is
  'One row per requested generate_cv.py output (format x detail x standard-or-tender-specific). Status starts "requested" and is advanced by engine/cv/process_cv_jobs.py, a human-run or scheduled process that actually runs generate_cv.py and uploads the result - the web app cannot run Python/LibreOffice (Vercel serverless), so this is never filled synchronously by a web request. See engine/cv/README.md.';

create index generated_cvs_person_idx on generated_cvs (person_id, tender_id, requested_at desc);
create index generated_cvs_status_idx on generated_cvs (status);

-- ============================================================================
-- Row Level Security - standard tenant isolation, same pattern as people/projects.
-- ============================================================================

alter table cv_uploads enable row level security;
alter table generated_cvs enable row level security;

create policy "cv_uploads: tenant isolation" on cv_uploads
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

create policy "generated_cvs: tenant isolation" on generated_cvs
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

-- Storage RLS: cv-documents objects are keyed "<company_id>/..." - a member can
-- read/write only under their own company's prefix. process_cv_jobs.py writes
-- generated output using the service role key, which bypasses this entirely
-- (same pattern write_admin_harness_results.py already uses), so this policy
-- only needs to cover client-side upload (the person's own browser upload) and
-- client-side download (viewing/downloading a ready file via a signed URL).
create policy "cv-documents: tenant isolation by path prefix" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'cv-documents'
    and is_company_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'cv-documents'
    and is_company_member((storage.foldername(name))[1]::uuid)
  );
