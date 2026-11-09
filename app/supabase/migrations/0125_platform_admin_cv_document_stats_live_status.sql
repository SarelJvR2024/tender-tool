-- Standing review finding, 2026-11-09 (Finding 300): tenders.status (0001,
-- "the buyer's public status" - 'open'/'closed'/'awarded'/'cancelled') is a
-- ONE-TIME, insert-only computation. Every insert site - pursue_discovered_
-- opportunity() (0018), the manual-load and private-document-load RPCs
-- (0024/0032), and the government-listing-changes insert (0051) - uses the
-- identical formula (closing_date < now() AT INSERT TIME ? 'closed' :
-- 'open'), and nothing anywhere in this schema, the app, or the engine ever
-- revisits it afterwards (grepped the whole repo for any later
-- `update tenders set status` - zero hits). Meanwhile tenders.closing_date
-- DOES get updated later, by accept_tender_update_date() (0111) when a
-- company accepts a corrigendum's new closing date - without ever touching
-- status.
--
-- Net effect, confirmed live in a disposable scratch database (full schema
-- replay, engine/security/replay_schema.sh): a tender that was 'open' when
-- first loaded keeps reading status = 'open' forever, even decades past its
-- own closing_date, with no sweep anywhere to correct it; and a tender
-- loaded (or left) at status = 'closed' whose closing_date is later
-- extended by an accepted corrigendum stays 'closed' forever too, even
-- though it is now genuinely open again. Live repro (ids anonymised here,
-- full script kept for this pass's own write-up): a tender inserted with
-- status='open' and closing_date 30 days in the past -
-- platform_admin_cv_document_stats() still counted it as "open" (
-- open_tender_cvs_count = 1, open_tender_cvs_docs_missing = 1) with nothing
-- else written since insert. A second case - status='closed', closing_date
-- 10 days in the FUTURE (the corrigendum-extension shape) - `where
-- status = 'open'` found 0 of 2 such rows; `where closing_date is null or
-- closing_date >= 'now'::timestamptz` correctly found exactly the 1 that is
-- genuinely still open and excluded the genuinely-closed one.
--
-- This function (0068) is the one place in the schema that reads
-- tenders.status as a live "is this tender currently open" signal for a
-- real, standing admin metric ("how many open CVs have we currently got in
-- our system?") - its own header comment already calls the rows it counts
-- "tenders that are currently open". Fixed to derive that live, the same
-- way every other "is this tender still open" check in this app already
-- does (lib/dates.ts's isPast(closing_date) family, and this file's own
-- sibling fix in lib/personCredentials.ts's registrationsAskedFor(), same
-- commit) - not from the column that promises it but doesn't deliver it.
-- tenders.status itself is left exactly as-is: deprecating or actively
-- maintaining it is a bigger, separate call (new standing item, see
-- System-Status.md) - this migration only stops the one real SQL consumer
-- from trusting it.
create or replace function platform_admin_cv_document_stats()
returns table (
  cv_uploads_total bigint,
  generated_cvs_total bigint,
  generated_cvs_ready bigint,
  open_tender_cvs_count bigint,
  open_tender_cvs_docs_downloaded bigint,
  open_tender_cvs_docs_missing bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with open_tender_cvs as (
    -- Distinct open tenders with at least one tender-specific generated CV
    -- on them (any generated_cvs status - a 'requested'/'generating' row
    -- still means a CV is actively being worked for this tender). "Open"
    -- read live from closing_date (0125), not the write-once tenders.status
    -- column - see this migration's own header for why that column can
    -- never be trusted here.
    select distinct gc.tender_id
    from generated_cvs gc
    join tenders t on t.id = gc.tender_id
    where t.closing_date is null or t.closing_date >= now()
  ),
  open_tender_cvs_docs as (
    select
      otc.tender_id,
      exists (select 1 from tender_documents td where td.tender_id = otc.tender_id) as has_docs
    from open_tender_cvs otc
  )
  select
    (select count(*) from cv_uploads),
    (select count(*) from generated_cvs),
    (select count(*) from generated_cvs where status = 'ready'),
    (select count(*) from open_tender_cvs_docs),
    (select count(*) from open_tender_cvs_docs where has_docs),
    (select count(*) from open_tender_cvs_docs where not has_docs)
  where is_platform_admin();
$$;
comment on function platform_admin_cv_document_stats() is
  'Daily CV/document stats for the super admin console (/admin): total CVs on file (uploads + generated, by status) and, among currently-open tenders (closing_date is null or in the future - 0125, NOT tenders.status, which is write-once and never revisited after insert) with a tender-specific generated CV, how many have at least one tender_documents row on file versus how many do not. Returns nothing unless the caller is a platform admin (0043). See 0068''s original header comment for what each column counts and why, and 0125''s header for why the "open" filter changed.';
revoke all on function platform_admin_cv_document_stats() from public;
grant execute on function platform_admin_cv_document_stats() to authenticated;
