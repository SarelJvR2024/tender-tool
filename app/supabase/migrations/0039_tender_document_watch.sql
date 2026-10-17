-- Tender updates after discovery: addenda, changed closing dates, new
-- documents (Sarel, 2026-10-17: "we need to monitor any new documents that
-- gets added to eTenders to see what they contain, if it's potentially
-- addendums ... any customer that is actively busy on a tender, any new
-- information about that tender, we need to warn them ... we need to inform
-- of changes of dates, because that might also allow someone to tender for
-- something if they have more time").
--
-- engine/discovery/watch_tender_updates.py re-checks every tender at least one
-- company is actively pursuing (a tender_packs row at found/bidding/submitted)
-- against its source - the tender's own OCDS release on eTenders (each
-- document there has a stable id and its own datePublished/dateModified) or,
-- for a SANRAL tender, SANRAL's own tender page ("Attached Files", file
-- count, closing date). A document that wasn't known on the last check is
-- downloaded, read (engine/general/requirements.py read_document, OCR for
-- scans) and classified: addendum / clarification / cancellation / revised
-- document / plain supporting document, with any closing-date change,
-- briefing change and other amendment lines quoted from its own text.
--
-- Three tables:
--
-- 1. tender_watched_documents - the "known documents for this tender"
--    record the watch diffs against. One row per document per tender, shared
--    across companies (a tender's published documents are the same for
--    everyone, exactly like tenders.document_urls). `baseline` rows were
--    already known when the tender was first watched (listed in
--    tenders.document_urls at discovery/pursue time, or present on the
--    watch's first look at a SANRAL page) and are never reported; every
--    other row is an update, with what the watch read in it.
--
-- 2. tender_watch_state - per tender: where the watch last found its OCDS
--    release (release date - the single-release API endpoint returns HTTP
--    500, so the watch re-reads a one-day window), SANRAL page signature,
--    when it last checked, and the last error. Service role only.
--
-- 3. tender_update_notifications - the seen store for notifications: one row
--    per (company, document) once that company has been told. `alerted_at`
--    is the watch's own alert run; `digested_at` is set when the daily digest
--    (engine/notify/daily_digest.py) has carried it. A document is never
--    reported to the same company twice by either path. Database-backed from
--    the start, the same direction as discovery_seen_releases (0038, Sarel's
--    audit follow-up (d)): a local JSON file would not survive a redeploy or
--    a run from a second machine.
--
-- Closing dates: the watch writes a detected new closing date to
-- tenders.closing_date (and every company's "Tender closes" task) ONLY when
-- the source listing itself agrees (the OCDS tenderPeriod.endDate or SANRAL's
-- page shows the same day). A date read only from a document - possibly by
-- OCR - is recorded here and shown, never applied: the closing date on file is
-- what every reminder, countdown and expiry check uses, so a misread must not
-- move it.
--
-- RLS: members read the documents of tenders they can see (same rule as
-- tender_documents/tender_requirements since 0024, so a private manual
-- tender's updates stay with its owner) and their own company's
-- notifications. Nothing is written by a client.

create table tender_watched_documents (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  -- eTenders: "<OCDS document id>@<dateModified>", so a file the buyer
  -- replaces under the same id is a new row. SANRAL: "sanral:<file name>".
  doc_key text not null check (length(doc_key) between 1 and 600),
  source text not null check (source in ('etenders_ocds', 'sanral_page')),
  title text,
  url text,
  date_published timestamptz,
  date_modified timestamptz,
  baseline boolean not null default false,
  first_seen_at timestamptz not null default now(),
  -- Set for non-baseline rows once the watch has looked at the document.
  kind text check (kind in ('addendum', 'clarification', 'cancellation', 'revised_document', 'supporting_document')),
  -- 'text' = from the document's own text layer; 'ocr' = from OCR of a scan;
  -- 'title_only' = the file couldn't be read (SANRAL's are behind a
  -- reCAPTCHA, or a format with no text) so only its name was used.
  read_basis text check (read_basis in ('text', 'ocr', 'title_only')),
  urgency text check (urgency in ('critical', 'high', 'info')),
  summary text,
  -- {closing_date: {date, time, previous_on_file, direction: later|earlier|same|unknown,
  --   quote, listing_date, listing_agrees, applied},
  --  briefing: {date, previous_date, quote}, other_changes: [{kind, quote}],
  --  caveats: [text]}
  changes jsonb not null default '{}'::jsonb,
  read_error text,
  unique (tender_id, doc_key)
);

comment on table tender_watched_documents is
  'Every document published on a tender, as engine/discovery/watch_tender_updates.py last saw its source (OCDS release / SANRAL page). baseline = known at discovery, not reported. Non-baseline rows are updates added after discovery, read and classified (kind, changes). Shared per tender; written by the service role only.';
comment on column tender_watched_documents.changes is
  'What the watch read in the document: a closing-date change (with the date on file before, direction later/earlier, the verbatim quote, whether the listing agrees and whether it was applied to tenders.closing_date), a briefing change, other amendment lines (verbatim), caveats.';

create index tender_watched_documents_tender_idx on tender_watched_documents (tender_id) where not baseline;

create table tender_watch_state (
  tender_id uuid primary key references tenders(id) on delete cascade,
  release_date date,
  sanral_signature jsonb,
  last_checked_at timestamptz,
  last_found_at timestamptz,
  last_error text
);

comment on table tender_watch_state is
  'Per tender, for the update watch: the OCDS release date it was last found under (the single-release API endpoint is broken, so the watch reads that one-day window), SANRAL page signature, last check and error. Service role only.';

create table tender_update_notifications (
  company_id uuid not null references companies(id) on delete cascade,
  watched_document_id uuid not null references tender_watched_documents(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  pipeline_stage text,
  alerted_at timestamptz,
  digested_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (company_id, watched_document_id)
);

comment on table tender_update_notifications is
  'Seen store for tender-update notifications: one row once a company actively pursuing the tender (tender_packs at found/bidding/submitted) has been told about a new document. alerted_at = the watch''s own alert; digested_at = carried by the daily digest. Never reported to the same company twice. Service role writes only.';

create index tender_update_notifications_digest_idx on tender_update_notifications (company_id) where digested_at is null;

alter table tender_watched_documents enable row level security;
alter table tender_watch_state enable row level security;
alter table tender_update_notifications enable row level security;

create policy "tender_watched_documents readable for visible tenders" on tender_watched_documents
  for select to authenticated using (
    exists (select 1 from tenders t where t.id = tender_id
            and (t.owner_company_id is null or is_company_member(t.owner_company_id))));

create policy "tender_update_notifications: members read their own" on tender_update_notifications
  for select to authenticated using (is_company_member(company_id));

-- tender_watch_state: no policy at all - engine bookkeeping, service role only.
-- No insert/update/delete policy on any of the three for authenticated clients.
