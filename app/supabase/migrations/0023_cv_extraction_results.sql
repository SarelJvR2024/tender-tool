-- CV AI extraction: the proposed field values, held for a human to confirm or
-- correct before anything is written to people/projects.
--
-- Spec: "CVs: upload once, never recapture" (docs/specs/Tender-Tool-Competitor-
-- Feature-Deep-Dive.md) - "The extracted result is shown back for a quick
-- confirm/correct, not blind-trusted". Evidence and design:
-- docs/specs/CV-Extraction-Findings.md.
--
-- Flow:
--   People page upload, mode 'ai_extract'  -> cv_uploads.status 'extraction_requested' (0008)
--   engine/cv/extract_cv_fields.py claims it -> 'extracting' (extraction_claimed_at)
--     reads the file's text, calls the LLM, checks every value against the CV text
--     -> a cv_extraction_results row (review_status 'pending_review') + 'extracted'
--     or 'extraction_failed' with extraction_error (a reason the user can act on:
--     "this is a scan", "not a CV", ...)
--   People page review card: per field, current vs proposed, tick/edit/untick
--     -> "Save selected fields" writes ONLY the ticked fields to people/projects
--        and sets review_status 'applied' (+ what was applied); "Discard" sets
--        'discarded'. Neither path is taken without a person pressing the button.
--
-- The worker writes with the service-role key (bypasses RLS, same as every
-- bridge). Members can read their company's results and update them (the
-- review step); they can't insert or delete them - a proposal only ever comes
-- from the extraction step, and the history of what was proposed is kept.

alter table cv_uploads
  add column extraction_claimed_at timestamptz,
  add column extraction_completed_at timestamptz,
  add column extraction_error text;

comment on column cv_uploads.extraction_claimed_at is
  'Set when engine/cv/extract_cv_fields.py claims an ai_extract upload (status -> extracting). Lets a stale claim (worker died) be failed after 30 minutes, same pattern as generated_cvs.claimed_at (0019).';
comment on column cv_uploads.extraction_error is
  'Why extraction failed, in words shown to the user on the People page (e.g. no text layer / scanned image, not a CV). Null unless status = extraction_failed.';

create table cv_extraction_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  cv_upload_id uuid not null unique references cv_uploads(id) on delete cascade,
  -- {"document_kind": "cv" | "sanral_key_person_forms",
  --  "person":   {"<people column>": {"value", "evidence", "verified", "warnings": [..]}, ...},
  --  "projects": [{"client_and_number", "position_held", "value_rm", "start_date", "end_date",
  --                "contact_name", "contact_phone", "contact_email", "evidence", "verified", "warnings"}],
  --  "other_registrations": [{"body", "level", "number", "evidence", "verified"}]}
  -- "evidence" is the verbatim CV text the value was read from; "verified" is
  -- false when that quote (or a number's digits) can't be found in the CV, or
  -- a date is only a year/month placeholder - the review screen leaves those
  -- unticked by default.
  proposed jsonb not null,
  warnings jsonb not null default '[]'::jsonb, -- whole-document notes (pages with no text, layout problems)
  text_method text,          -- e.g. 'pdftotext -layout', 'python-docx'
  source_pages int,
  source_text_chars int,
  model text,                -- the model that answered (after any server-side fallback)
  usage jsonb,               -- {"input_tokens", "output_tokens"} - cost tracking
  review_status text not null default 'pending_review'
    check (review_status in ('pending_review', 'applied', 'discarded')),
  -- what the reviewer actually saved: {"person_fields": [...], "projects_added": n,
  -- "edited_fields": [...]} - provenance for "where did this value come from"
  applied jsonb,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table cv_extraction_results is
  'AI-proposed people/projects values from one ai_extract CV upload, each with the CV text it was read from. Never applied automatically: the People page review step writes only the fields a person ticks. Written by engine/cv/extract_cv_fields.py (service role).';

create index cv_extraction_results_person_idx on cv_extraction_results (person_id, review_status);

alter table cv_extraction_results enable row level security;

create policy "cv_extraction_results: members read" on cv_extraction_results
  for select to authenticated using (is_company_member(company_id));

create policy "cv_extraction_results: members review" on cv_extraction_results
  for update to authenticated
  using (is_company_member(company_id))
  with check (is_company_member(company_id));
