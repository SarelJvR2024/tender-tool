-- Finding 318: platform_admin_low_confidence_requirement_items() (0076/0100)
-- never excluded an item that already has a requirement_extraction_reviews
-- row, so every item an admin had already marked correct/corrected/false
-- positive kept reappearing in the "Quality Scout" queue on every page
-- load, forever, indistinguishable from one never reviewed at all.
--
-- Why this happened: 0076's own header comment says item_key exists so "the
-- UI building the review queue needs to recognise 'this is the same item I
-- already reviewed' across re-extractions without a round trip" - but the
-- queue function itself never actually joins against
-- requirement_extraction_reviews at all, and engine/general/requirements.py's
-- own _apply_past_corrections() (confirmed by reading it directly) only ever
-- LOWERS a *similar future* item's confidence on a "false_positive"/
-- "corrected" match - it never raises confidence back up on a "correct"
-- verdict, and never touches the SAME item on the SAME tender either way.
-- So a shared-manifest item (company_id null, which has no reprocess path
-- at all - see 0100's own header) that is reviewed "correct" can never
-- leave this queue by any mechanism that already exists: its confidence
-- never changes and nothing excludes it. Reproduced live on a scratch
-- Postgres (seeded tender + low-confidence item, reviewed "correct" via the
-- real submit_requirement_extraction_review(), then called this function
-- again - the already-reviewed item still came back unchanged).
--
-- Fix: exclude any item for which a requirement_extraction_reviews row
-- already exists with the SAME (tender_id, item_key) - any verdict counts
-- as "already triaged", matching this migration's own queue label ("every
-- item... an admin can mark... correct/corrected/false positive", i.e. a
-- worklist to clear, not a permanent list). A later genuine re-extraction
-- that changes the item's document/quote text produces a different
-- item_key (0076's own hash definition) and is correctly treated as a new,
-- unreviewed item - this does not suppress real new findings, only an
-- exact repeat of one already triaged.
drop function if exists platform_admin_low_confidence_requirement_items(smallint, int);
create or replace function platform_admin_low_confidence_requirement_items(
  p_threshold smallint default 60, p_limit int default 200
)
returns table (
  tender_id uuid,
  tender_title text,
  tender_contract_no text,
  tender_buyer text,
  company_id uuid,
  item_type text,
  item_key text,
  item jsonb,
  source_document_url text,
  source_document_note text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with manifests as (
    select t.id as tender_id, t.title as tender_title, t.contract_no as tender_contract_no,
           t.buyer as tender_buyer, null::uuid as company_id, t.document_requirements as manifest
    from tenders t
    where t.document_requirements is not null
    union all
    select t.id, t.title, t.contract_no, t.buyer, tp.company_id, tp.document_requirements
    from tender_packs tp
    join tenders t on t.id = tp.tender_id
    where tp.document_requirements is not null
  ),
  items as (
    select m.tender_id, m.tender_title, m.tender_contract_no, m.tender_buyer, m.company_id,
           sect.item_type, elem.item,
           md5(m.tender_id::text || '|' || sect.item_type || '|' || coalesce(elem.item ->> 'document', '') || '|' || coalesce(elem.item ->> 'quote', '')) as item_key
    from manifests m
    cross join lateral (values
      ('forms', m.manifest -> 'forms'),
      ('buyer_forms', m.manifest -> 'buyer_forms'),
      ('returnables', m.manifest -> 'returnables'),
      ('roles', m.manifest -> 'roles'),
      ('person_registrations', m.manifest -> 'person_registrations'),
      ('cidb', case when m.manifest -> 'cidb' is not null then jsonb_build_array(m.manifest -> 'cidb') end),
      ('briefing', case when m.manifest -> 'briefing' is not null then jsonb_build_array(m.manifest -> 'briefing') end)
    ) as sect(item_type, arr)
    cross join lateral jsonb_array_elements(coalesce(sect.arr, '[]'::jsonb)) as elem(item)
    where (elem.item ->> 'confidence') is not null
      and (elem.item ->> 'confidence')::int < p_threshold
  )
  select
    i.tender_id, i.tender_title, i.tender_contract_no, i.tender_buyer, i.company_id,
    i.item_type,
    i.item_key,
    i.item,
    case when i.company_id is null and i.item ->> 'document' is not null then (
      select du ->> 'url' from tenders t, jsonb_array_elements(t.document_urls) du
      where t.id = i.tender_id and lower(du ->> 'title') = lower(i.item ->> 'document')
      limit 1
    ) end,
    case when i.company_id is not null and i.item ->> 'document' is not null then (
      select 'Private document on file: ' || tpd.title || ' - not previewable from this console yet.'
      from tender_private_documents tpd
      where tpd.company_id = i.company_id and tpd.tender_id = i.tender_id
        and lower(tpd.title) = lower(i.item ->> 'document')
      limit 1
    ) end
  from items i
  where is_platform_admin()
    and not exists (
      select 1 from requirement_extraction_reviews r
      where r.tender_id = i.tender_id and r.item_key = i.item_key
    )
  order by (i.item ->> 'confidence')::int asc
  limit p_limit;
$$;
comment on function platform_admin_low_confidence_requirement_items(smallint, int) is
  'Admin review queue (0076, extended 0100): every engine/general/requirements.py manifest item (forms/buyer_forms/returnables/roles/person_registrations/cidb/briefing) with confidence < p_threshold, across every tender''s shared manifest (tenders.document_requirements) and every company''s private-document override (tender_packs.document_requirements, 0032), EXCLUDING any item already given a verdict in requirement_extraction_reviews for the same (tender_id, item_key) - Finding 318 (0127): without this, an already-reviewed item reappeared on every page load forever, since nothing else ever removes or re-scores it. A real re-extraction that changes the item''s document/quote text produces a new item_key and is correctly treated as unreviewed. Returns nothing unless the caller is a platform admin (0043).';
revoke all on function platform_admin_low_confidence_requirement_items(smallint, int) from public;
grant execute on function platform_admin_low_confidence_requirement_items(smallint, int) to authenticated;
revoke execute on function platform_admin_low_confidence_requirement_items(smallint, int) from anon;
