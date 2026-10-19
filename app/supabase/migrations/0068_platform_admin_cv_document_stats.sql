-- Owner's daily review ask (Sarel, 2026-10-19): "how many open CVs have we
-- currently got in our system?" and "for how many of them did we manage to
-- download the tender documents?" - a permanent stat on /admin, not a
-- one-off query someone has to re-run by hand. Same SECURITY DEFINER +
-- is_platform_admin() (0043) pattern as 0064's platform_admin_* functions,
-- so it reads across every tenant from the admin console alone.
--
-- What "open CVs" means here: the schema has no literal "open" status on a
-- CV. cv_uploads.status tracks upload/extraction progress and
-- generated_cvs.status tracks requested/generating/ready/failed (0008) -
-- neither is an open/closed lifecycle a count of "open CVs" can honestly be
-- pulled from. Rather than guess which one the owner meant, this reports the
-- real, named counts side by side instead:
--   - cv_uploads_total: every source CV file on file (one row per upload;
--     a re-upload is a new row, not an overwrite - 0008's own "upload once,
--     never recapture" design), across every company.
--   - generated_cvs_total / generated_cvs_ready: every CV document ever
--     requested from engine/cv/generate_cv.py (standard + tender-specific,
--     every format/detail combination), and how many of those actually
--     finished (status='ready' - a real file sitting in the cv-documents
--     bucket right now, not a pending or failed request).
--
-- What "did we manage to download the tender documents" means here: a
-- tender-specific generated CV (generated_cvs.tender_id is not null - the
-- cover-page/position-matched kind built on tender_pack_assignments, 0008)
-- only matters once that tender's own blank SANRAL templates are on file
-- (tender_documents, 0001) for a pack to actually be built against.
-- tender_documents.downloaded_at is NOT NULL on every row (0001: defaults to
-- now() the moment a row is inserted) - there is no downloaded/not-downloaded
-- flag on an existing row; the row's EXISTENCE is the "we got the documents"
-- signal, and a tender with nothing downloaded simply has no tender_documents
-- row at all (see also 0045: a row may be the shared copy registered from
-- intake, or one company's own private copy - either counts as "on file"
-- here). So: among tenders that are currently open (tenders.status='open',
-- 0001) and have at least one tender-specific generated CV against them, how
-- many have at least one tender_documents row versus how many have none.
--
-- Simplification worth stating plainly (so this is trusted, not just
-- believed): this counts "a tender has documents" at the whole-tender level,
-- not per doc_type (technical_xlsm, financial_xlsm, c111_form_of_offer,
-- c123_contract_data, a_forms, 0001). A tender with only 1 of those 5 on file
-- still counts as "has documents" here, because that is the thing that
-- unblocks any CV/pack work starting at all; a finer per-doc_type breakdown
-- would need its own stat if the owner ever wants that level of detail.
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
    -- still means a CV is actively being worked for this tender).
    select distinct gc.tender_id
    from generated_cvs gc
    join tenders t on t.id = gc.tender_id
    where t.status = 'open'
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
  'Daily CV/document stats for the super admin console (/admin): total CVs on file (uploads + generated, by status) and, among currently-open tenders with a tender-specific generated CV, how many have at least one tender_documents row on file versus how many do not. Returns nothing unless the caller is a platform admin (0043). See this migration''s header comment for exactly what each column counts and why.';
revoke all on function platform_admin_cv_document_stats() from public;
grant execute on function platform_admin_cv_document_stats() to authenticated;
