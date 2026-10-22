-- Cover letter + methodology statement generator (Sarel, 2026-10-22).
--
-- This directly reopens a decision made five days earlier and documented in
-- docs/specs/Company-Voice-Audit.md: "AI-drafted executive summaries/
-- methodology were cut from scope because they make every tenant's
-- submission look the same." Sarel's own words then; Sarel's own stated
-- worry now ("it may NEVER generate the same or similar versions for two
-- companies") is the identical risk. Confirmed directly before building
-- this: generate a full, ready-to-use draft, grounded in each company's
-- real CVs/projects/profile/tender specifics and styled to their
-- preferences, WITH a mechanical similarity check across companies for the
-- SAME tender (not just "trust the prompt") - plus an explicit path to
-- export, hand-edit in Word, and re-upload the final version, so nothing
-- ships without a human actually reading and owning the words. That export/
-- re-upload step is also what keeps this consistent with the prior
-- decision's real point: the company's own voice should win, not an
-- unreviewed AI draft.
--
-- Same request/fulfil shape as pack_generation_jobs (0017) and generated_cvs
-- (0008): the web app cannot run the real generation step (an LLM call plus
-- python-docx), so a request here only inserts a row with status=
-- 'requested'. engine/narrative/process_narrative_jobs.py (a poll-once
-- bridge, same shape as process_cv_jobs.py/process_pack_jobs.py) claims it,
-- runs the real generator, and marks the row 'ready' (with the similarity
-- check's own result recorded, never silently discarded) or 'failed'.

insert into storage.buckets (id, name, public)
values ('narrative-documents', 'narrative-documents', false)
on conflict (id) do nothing;

create table narrative_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  kind text not null check (kind in ('cover_letter', 'methodology')),
  status text not null default 'requested' check (status in (
    'requested', 'generating', 'ready', 'failed'
  )),

  -- What the requester actually asked for - captured at request time, never
  -- re-derived, so a later re-generation can be compared against what was
  -- originally wanted.
  user_guidance text, -- free text: what they want this document to cover/emphasise
  style_length text not null default 'standard' check (style_length in ('concise', 'standard', 'thorough')),
  style_detail text not null default 'detailed' check (style_detail in ('high_level', 'detailed', 'highly_technical')),
  style_visual text not null default 'structured' check (style_visual in ('plain', 'structured', 'visual_rich')),
  style_color text not null default 'navy' check (style_color in ('navy', 'charcoal', 'forest', 'burgundy', 'slate')),

  -- The AI-drafted result. generated_text is the plain-text content (no
  -- styling) of the SAME draft as generated_storage_path's .docx - kept
  -- specifically so the uniqueness check below (and any future one) can
  -- compare content without opening/parsing the .docx itself. Never shown to
  -- any company other than the one that generated it - the backend worker
  -- reads across companies for the similarity check using the service role,
  -- the same elevated access every other engine/* script already has; no
  -- RLS policy here ever grants cross-company read.
  generated_storage_path text, -- 'narrative-documents' bucket
  generated_text text,
  generated_at timestamptz,

  -- The uniqueness safeguard this table exists for. similarity_score is the
  -- highest similarity found (0-1) against any OTHER company's ready
  -- document of the same kind for the SAME tender_id, computed by
  -- engine/narrative/uniqueness.py. A first draft that scores too high gets
  -- ONE automatic regeneration pass with an explicit distinctness
  -- instruction (regenerated_for_distinctness records that this happened);
  -- if the regenerated draft is STILL too similar, it is flagged rather than
  -- silently shipped or silently discarded - a human decides, the system
  -- never guesses.
  similarity_score numeric,
  similarity_flagged boolean not null default false,
  regenerated_for_distinctness boolean not null default false,

  -- The human-finishing step: export the draft, edit it in Word, upload the
  -- real final version back. Once final_storage_path is set, IT - not
  -- generated_storage_path - is the version anything downstream (a future
  -- pack-assembly step) should use; a company that only ever downloads and
  -- never re-uploads is still using the reviewed AI draft as-is, which is
  -- allowed, just not the point of offering this path.
  final_storage_path text,
  final_original_filename text,
  final_uploaded_at timestamptz,
  final_uploaded_by uuid references auth.users(id),

  error_message text,
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
comment on table narrative_documents is
  'One row per cover-letter/methodology generation request. Advanced requested -> generating -> ready/failed by engine/narrative/process_narrative_jobs.py - never generated by a web request. The similarity_score/similarity_flagged pair is the mechanical anti-collusion safeguard Sarel asked for directly (2026-10-22) - see this migration''s own header comment and docs/specs/Company-Voice-Audit.md for why this feature exists at all given that prior decision.';

create index narrative_documents_tender_idx on narrative_documents (company_id, tender_id, requested_at desc);
create index narrative_documents_status_idx on narrative_documents (status);
-- The uniqueness check's own access pattern: "every ready document of this
-- kind for this tender, across all companies" - the one query this table
-- exists to make fast, run only by the service-role worker (RLS below never
-- grants this across companies to a client).
create index narrative_documents_tender_kind_ready_idx on narrative_documents (tender_id, kind) where status = 'ready';

alter table narrative_documents enable row level security;

create policy "narrative_documents: tenant isolation" on narrative_documents
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

-- Same restricted-role pattern 0077's own "Part D" audit established across
-- every other company-business table (tender_answers, pack_review_confirmations,
-- etc.) - cover letters and methodology statements are submission content an
-- employee (CV-only access) has no business reading or writing.
create policy "narrative_documents: employee has no access" on narrative_documents
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));

-- "<company_id>/tenders/<tender_id>/<job_id>/<file>" - same path-prefix
-- tenant-isolation shape as submission-packs (0017). Members read their own
-- company's documents via a signed URL; the bridge writes with the service
-- role (bypasses RLS).
create policy "narrative-documents: tenant isolation by path prefix" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'narrative-documents'
    and is_company_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'narrative-documents'
    and is_company_member((storage.foldername(name))[1]::uuid)
  );
