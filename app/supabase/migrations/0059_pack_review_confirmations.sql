-- Pack Review: a pre-compile screen that shows EVERYTHING that will go into
-- a submission pack (company data, key positions/CVs, form answers,
-- signatures, documents, Form B7, the JV/typical-share field) so the company
-- can confirm or change it before clicking "Generate submission pack"
-- (Sarel, 2026-10-18: "share the full list... to show what is identified to
-- be used to compile the pack so the company have an easy way to confirm or
-- change it"). This replaces the old "gap list + one acknowledge_gaps
-- checkbox" in submission-pack.tsx with a real review step.
--
-- The review snapshot itself (app/app/tenders/[id]/pack-review-data.ts) is
-- computed LIVE on every page view, the same way readiness_snapshot already
-- is in requestSubmissionPack() (actions.ts) - there is nothing to store for
-- the content itself. What needs a durable row is only the human's "I've
-- reviewed this" signal, and that has to exist BEFORE a pack_generation_jobs
-- row does (the review happens before the first "Generate" click, and a
-- company may review several times across many requested/ready jobs for the
-- same tender). So this is its own small table, one row per (company,
-- tender) - not a column tacked onto pack_generation_jobs, which is keyed per
-- REQUEST, not per tender.
--
-- Deliberately proportionate (same spirit as admin_harness_runs' reviewed_at
-- in 0022): no staleness-tracking trigger. A later edit to a key position,
-- form answer, or document is still caught independently by
-- requestSubmissionPack()'s own live hard blockers (unconfirmed position,
-- missing template, Form B7) - those never depend on this table. This table
-- only answers "did a human look at the full pre-compile list at some point
-- before asking for a pack", which is what the button gates on.
create table pack_review_confirmations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  reviewed_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  unique (company_id, tender_id)
);
comment on table pack_review_confirmations is
  'One row per (company, tender): set (upserted) when a human clicks "I''ve reviewed this" on the Pack Review card (pack-review.tsx) after looking at the live pre-compile snapshot (pack-review-data.ts). requestSubmissionPack() (actions.ts) requires a row here before it will insert a pack_generation_jobs row.';

create index pack_review_confirmations_tender_idx on pack_review_confirmations (company_id, tender_id);

alter table pack_review_confirmations enable row level security;

create policy "pack_review_confirmations: tenant isolation" on pack_review_confirmations
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

-- Audit copy on the request itself (mirrors readiness_snapshot's own
-- "what the requester was shown" pattern): which review (if any) this
-- specific pack_generation_jobs row relied on, set once at request time and
-- never updated afterwards - same naming convention as admin_harness_runs'
-- reviewed_at/reviewed_by (0022).
alter table pack_generation_jobs
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users(id) on delete set null;
comment on column pack_generation_jobs.reviewed_at is
  'Copied from pack_review_confirmations at the moment this request was made (requestSubmissionPack, actions.ts) - audit trail only, not re-checked afterwards.';
