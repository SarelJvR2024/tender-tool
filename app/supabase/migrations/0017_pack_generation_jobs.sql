-- Submission-pack generation requests: the SANRAL document pack (filled
-- Technical workbook + Form B reports + returnable forms + covers + vault
-- documents + CVs) merged into ONE ordered, page-numbered PDF per request.
--
-- Same request/fulfil shape as generated_cvs (0008): the web app cannot run
-- Python/LibreOffice (Vercel serverless), and the real SANRAL fill engines
-- (engine/fill_conventional.py, fill_tender.py, print_reports.py,
-- run_forms_pipeline.py, ...) need both. So the Tender Workspace's
-- "Generate submission pack" action only inserts a row here with
-- status='requested'; engine/pack/process_pack_jobs.py - run by a human, cron
-- or a scheduler, never in the web request path - claims it, runs the real
-- engines, uploads the result to the 'submission-packs' bucket and marks the
-- row 'ready' (or 'failed' with error_message). The UI only shows status.
--
-- Also fixes a gap 0001 left: tender_documents.storage_path (the blank SANRAL
-- templates, shared public data) never had a bucket. 'tender-documents' is it.

insert into storage.buckets (id, name, public)
values
  ('submission-packs', 'submission-packs', false),
  ('tender-documents', 'tender-documents', false)
on conflict (id) do nothing;

create table pack_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  tender_pack_id uuid not null references tender_packs(id) on delete cascade,
  status text not null default 'requested' check (status in (
    'requested', 'generating', 'ready', 'failed'
  )),
  -- What to include. Defaults = "everything currently ready": every vault
  -- document with an uploaded copy, and for each position the newest ready
  -- generated CV (else the person's newest as-is upload). Anything missing is
  -- listed on the pack's contents page with its reason, never silently dropped.
  include_vault_documents boolean not null default true,
  include_cvs boolean not null default true,
  -- The compliance report's gaps at the moment of the request (what the
  -- requester was shown), and whether they explicitly chose to generate a
  -- draft pack anyway. Shape: {"mandatory_missing": [..], "missing": [..],
  -- "to_confirm": [..], "unfilled_positions": [..]} - labels, not ids.
  readiness_snapshot jsonb not null default '{}'::jsonb,
  acknowledged_gaps boolean not null default false,
  -- Results (set by process_pack_jobs.py).
  storage_path_pdf text,             -- the merged pack, in 'submission-packs'
  output_files jsonb not null default '{}'::jsonb,  -- filled .xlsm workbooks, ACTIONS_TO_SIGN.md, manifest
  page_count int,
  manifest jsonb,                    -- sections with page ranges, omitted items with reasons, warnings
  error_message text,
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
comment on table pack_generation_jobs is
  'One row per "Generate submission pack" request on the Tender Workspace. Advanced requested -> generating -> ready/failed by engine/pack/process_pack_jobs.py (a poll-once bridge, same shape as engine/cv/process_cv_jobs.py), which runs the real SANRAL fill engines - never filled by a web request.';

create index pack_generation_jobs_tender_idx on pack_generation_jobs (company_id, tender_id, requested_at desc);
create index pack_generation_jobs_status_idx on pack_generation_jobs (status);

alter table pack_generation_jobs enable row level security;

create policy "pack_generation_jobs: tenant isolation" on pack_generation_jobs
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

-- Generated packs: "<company_id>/tenders/<tender_id>/<job_id>/<file>". Members
-- read their own company's packs via a signed URL; the bridge writes with the
-- service role (bypasses RLS), same as cv-documents' generated output.
create policy "submission-packs: tenant isolation by path prefix" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'submission-packs'
    and is_company_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'submission-packs'
    and is_company_member((storage.foldername(name))[1]::uuid)
  );

-- Blank SANRAL templates are public boilerplate shared by every company (same
-- reasoning as the tender_documents table's own read-only policy in 0001):
-- any signed-in user may read; only the service role (discovery pipeline or
-- a hand upload) writes - there is deliberately no client write policy.
create policy "tender-documents: readable by authenticated users" on storage.objects
  for select to authenticated
  using (bucket_id = 'tender-documents');
