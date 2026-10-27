-- Tender Catalog & Intelligence, Phase 5 of the Admin Command Center brief
-- (2026-10-27): the one remaining tab from that brief ("Total active tenders
-- in database with filters [Client/Organ of State, Category, CIDB grading,
-- Closing date]. Extraction status badges... Aggregate popularity counter").
--
-- Filters, confirmed real against the live schema (audited before writing
-- this, not assumed):
--   - Client/Organ of State -> tenders.buyer (plain text, already there - 0001)
--   - Category              -> tenders.industry_tags / discipline_tags
--                               (0060 - discipline_categories taxonomy)
--   - CIDB grading           -> there is NO dedicated column. requirements.py's
--                               cidb extraction (confirmed by reading it) writes
--                               {"grading": "6CE", "quote", "confidence",
--                               "confidence_reason", "ambiguous"} at
--                               document_requirements->'cidb', only once a
--                               tender has actually been through extraction.
--                               Read from there, not invented as a new column.
--   - Closing date            -> tenders.closing_date, already there.
--
-- Extraction status badges ("Native Text Ready" / "OCR Required" /
-- "Parsing Failed", per the brief): confirmed real, stored, per-document
-- signals inside document_requirements->'documents' (strip_local() in
-- requirements.py only strips _work_dir/_all_text/_local - it keeps each
-- document's own "unreadable" (string reason, set when a document could not
-- be read at all - corrupt, truncated, no text layer even after an OCR
-- attempt) and "ocr" (a summary object, set by ocr_scanned_pages() only when
-- some/all of a document's text came from OCR rather than a native text
-- layer). So, honestly, per tender:
--   document_requirements is null                                -> not yet extracted at all
--   else any document has "unreadable" set                       -> Parsing Failed
--   else any document has "ocr" set                               -> OCR Required
--   else (readable, none via OCR)                                 -> Native Text Ready
-- A 4th state ("not_extracted") is real and shown as such, rather than
-- forced into one of the brief's 3 labels - a tender genuinely has no
-- extraction status yet before its first requirements pass.
--
-- Popularity counter: count(*) from tender_packs grouped by tender_id -
-- the exact same pattern platform_admin_companies() (0098) already uses for
-- that company's own tenders_pursued_count, just grouped the other way.
create or replace function platform_admin_tender_catalog()
returns table (
  tender_id uuid,
  title text,
  contract_no text,
  buyer text,
  closing_date timestamptz,
  region text,
  status text,
  industry_tags text[],
  discipline_tags text[],
  cidb_grading text,
  cidb_ambiguous boolean,
  extraction_status text,
  pursuing_count bigint,
  last_seen_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    t.id, t.title, t.contract_no, t.buyer, t.closing_date, t.region, t.status,
    t.industry_tags, t.discipline_tags,
    t.document_requirements -> 'cidb' ->> 'grading',
    (t.document_requirements -> 'cidb' ->> 'ambiguous')::boolean,
    case
      when t.document_requirements is null then 'not_extracted'
      when exists (
        select 1 from jsonb_array_elements(coalesce(t.document_requirements -> 'documents', '[]'::jsonb)) d
        where d -> 'unreadable' is not null and d -> 'unreadable' != 'null'::jsonb
      ) then 'parsing_failed'
      when exists (
        select 1 from jsonb_array_elements(coalesce(t.document_requirements -> 'documents', '[]'::jsonb)) d
        where d -> 'ocr' is not null and d -> 'ocr' != 'null'::jsonb
      ) then 'ocr_required'
      else 'native_text_ready'
    end,
    (select count(*) from tender_packs tp where tp.tender_id = t.id),
    t.last_seen_at, t.created_at
  from tenders t
  where is_platform_admin()
  order by t.closing_date asc nulls last, t.created_at desc;
$$;
comment on function platform_admin_tender_catalog() is
  'Admin tender catalog (/admin/tenders, Admin Command Center Phase 5) - every tender with its real filter fields (buyer, industry/discipline tags, best-effort CIDB grading from document_requirements->cidb), an honest extraction_status computed from document_requirements->documents (not_extracted/native_text_ready/ocr_required/parsing_failed - see this migration''s own header for why each maps to a real stored signal, nothing invented), and pursuing_count (tender_packs rows for that tender). Platform-admin only (0043).';
revoke all on function platform_admin_tender_catalog() from public;
grant execute on function platform_admin_tender_catalog() to authenticated;
