-- Sarel, 2026-10-19: "We need to have a full repository of all tenders on
-- the internet available to us, and all documents already downloaded...
-- It shouldn't be manually prompted by a user. We need it up front so we
-- can build engines to analyze if there's anything we haven't catered for,
-- so we're never surprised during a submission."
--
-- Today every government source's documents are fetched only TRANSIENTLY:
-- assess_tender.fetch_pdf_text downloads to a temp file purely to extract
-- text for scoring, then deletes it (engine/discovery/assess_tender.py). The
-- only PERMANENT document storage in the schema is tender_documents (0001),
-- and that is written only once a company "pursues" a discovered
-- opportunity (pursue_discovered_opportunity(), 0024/0051) - never at
-- discovery time, and never for the releases nobody ever pursues. This
-- migration is the missing piece: a permanent, shared store for every
-- document the discovery watch can see, downloaded automatically the moment
-- a tender is discovered - see engine/discovery/download_discovered_documents.py.
--
-- Why this is a NEW table, not a reuse of tender_documents:
--   1. Shape mismatch. tender_documents.tender_id is `not null references
--      tenders(id)` and doc_type is a closed SANRAL-specific enum
--      ('technical_xlsm', 'financial_xlsm', 'c111_form_of_offer',
--      'c123_contract_data', 'a_forms'). A discovered release has no
--      tenders row at all until pursue_discovered_opportunity() makes one
--      (0024) - which most discovered releases never get, by design: Sarel
--      wants the documents on file for EVERY release so the future
--      analysis engines have something to read, not only the ones a
--      company chooses to pursue. Making tender_id nullable and the
--      doc_type check open-ended would turn tender_documents into two
--      unrelated things sharing one table - the exact "distorting its
--      existing meaning" this project's migrations avoid (see 0045's own
--      reasoning for a different column rather than overloading an
--      existing one).
--   2. Scoping key mismatch. discovered_opportunities is per (company_id,
--      ocid) (0004) - the SAME release gets one row PER COMPANY it scores
--      for. Documents belong to the release, not to any one company's
--      verdict on it, so keying a documents table on company_id would mean
--      downloading and storing the same file once per company that happens
--      to see it - wasteful, and wrong the moment two companies both get a
--      report-worthy verdict on the same tender. The real identity is the
--      release itself: `release_key` here is the exact same key
--      watch_new_tenders.py's seen store already uses (its own
--      `release_key()`: ocid, falling back to contract_number when a
--      release has none) - one row per (release, document), shared across
--      every company, same "public/shared, not tenant-scoped" status as
--      `tenders` itself (0001).
--
-- SANRAL is deliberately excluded from automatic download. Its own
-- document-download form is gated behind reCAPTCHA v3, confirmed live on
-- real infrastructure (engine/discovery/download_documents.py's own
-- docstring: "CONFIRMED 2026-10-15 ... reCAPTCHA v3 reliably rejects ...
-- automation detector checks") - a hard, already-confirmed technical wall,
-- not attempted here. gov_sources.sanral_releases() already records SANRAL's
-- attached file TITLES with url=None (detail.py's attached_files - a human
-- still has to click through SANRAL's own site); this table keeps recording
-- exactly nothing for those (no URL means nothing to download), so that gap
-- stays visible rather than silently hidden. Every other source
-- (etenders_portal, etenders_ocds/national, eskom_bulletin,
-- transnet_etenders, capetown_procurement, cidb_tenders, dbsa_procurement,
-- sars_procurement) gives a direct, unauthenticated document URL - each
-- source's own module docstring says so explicitly.
--
-- status/error: a document that fails to download (dead link, timeout,
-- corrupt file, 404 on a buyer's site that moved its files) is recorded as
-- a failed row with the reason, never silently dropped and never retried
-- forever on every single watch run - download_discovered_documents.py
-- treats status='failed' the same as a success for idempotency purposes
-- (don't hammer a dead link every day). One bad link never aborts the run
-- (same philosophy as assess_tender.fetch_pdf_text); a single summary
-- system_alerts entry is raised per run when any document failed, not one
-- per document, so a feed with a handful of dead links doesn't flood Sarel.

create table discovered_opportunity_documents (
  id uuid primary key default gen_random_uuid(),

  -- Release identity - NOT company_id, NOT tender_id. See header comment.
  release_key text not null, -- watch_new_tenders.release_key(r): r['ocid'] or r['contract_number']
  ocid text,
  contract_number text,
  source text, -- gov_sources.py source name ('etenders_portal', 'eskom_bulletin', ...) - 'sanral' never gets a row here
  buyer text,
  release_title text,

  document_title text, -- the document's own title/filename, as the source gave it
  document_url text not null, -- the buyer's own direct, unauthenticated link
  content_hash text, -- sha256 of the downloaded bytes - lets a second URL pointing at an
  -- identical file be recognised as a duplicate, and lets a future run detect the SAME url
  -- now serving different bytes (an addendum silently replacing a document at its own link)
  content_type text,
  byte_size bigint,

  storage_path text, -- Supabase Storage path in 'discovered-tender-documents'; null when status = 'failed'
  status text not null default 'downloaded' check (status in ('downloaded', 'failed')),
  error text, -- the download/storage failure reason, when status = 'failed'; null otherwise

  downloaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- One row per (release, document URL): a re-run of the watch must not
  -- re-download or re-insert a document it already has, whether that
  -- download succeeded or failed (download_discovered_documents.py checks
  -- this before fetching anything).
  unique (release_key, document_url)
);
comment on table discovered_opportunity_documents is
  'Every document the discovery watch has found for every government tender source EXCEPT SANRAL (reCAPTCHA v3 wall - see this migration''s header), downloaded and stored permanently and automatically the moment a tender is discovered - never waiting for a company to "pursue" it. Shared/public like `tenders`/`tender_documents` (0001): one row per (release, document), not per company. Written only by engine/discovery/download_discovered_documents.py (service role) - never by a client.';
comment on column discovered_opportunity_documents.release_key is
  'Same identity as watch_new_tenders.py''s own seen-store key (release_key(): ocid, or contract_number when a release has none) - lets this table be joined back to a watch run''s releases without needing a tenders row, which most discovered releases never get.';
comment on column discovered_opportunity_documents.content_hash is
  'sha256 of the downloaded file. Not the dedupe key (document_url already is, via the unique constraint) - this is for a FUTURE engine to notice two different URLs are the same file, or that a URL''s content changed since it was last downloaded.';

create index discovered_opportunity_documents_release_key_idx
  on discovered_opportunity_documents (release_key);

alter table discovered_opportunity_documents enable row level security;

-- Shared/public, read-only to clients - same pattern as tenders/tender_documents (0001):
-- any authenticated user can read, only the service role (this watch step) writes.
create policy "discovered_opportunity_documents readable by authenticated users"
  on discovered_opportunity_documents
  for select to authenticated using (true);

insert into storage.buckets (id, name, public)
values ('discovered-tender-documents', 'discovered-tender-documents', false)
on conflict (id) do nothing;

-- Read-only to clients, same shape as the 'tender-documents' bucket policy (0017).
-- Nothing ever uploads here except the service role (bypasses RLS/storage policy
-- entirely), so there is no insert/update/delete policy for authenticated users.
create policy "discovered-tender-documents: readable by authenticated users" on storage.objects
  for select to authenticated using (bucket_id = 'discovered-tender-documents');
