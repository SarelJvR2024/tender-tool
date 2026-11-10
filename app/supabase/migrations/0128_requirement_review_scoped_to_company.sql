-- Finding 335: 0127's own fix for Finding 318 (an already-reviewed item
-- reappearing in the "Quality Scout" queue forever) excluded an item by
-- (tender_id, item_key) ALONE - but item_key (0076's own definition) is
-- md5(tender_id || item_type || document || quote), with NO company_id in
-- it at all. requirement_extraction_reviews carries no company_id either.
-- So a verdict recorded while looking at ONE company's own private-document
-- override (tender_packs.document_requirements, 0032) silently excludes the
-- IDENTICAL item_key from the queue for EVERY OTHER company's own override
-- on the same tender, and for the shared manifest (tenders.document_
-- requirements) too - even though nobody ever reviewed those other
-- manifests, and the admin's own "corrected_value" (when verdict=
-- 'corrected') is never applied to them either (requirements.py's
-- _apply_past_corrections(), read directly, only ever lowers a DIFFERENT
-- future item's confidence by a stable identity field - never writes this
-- one back anywhere). This is not a rare edge case: 0032's own header
-- comment says the per-company override is built by reading the SAME
-- shared buyer documents (tenders.document_urls) together with that
-- company's own private documents, so every "forms"/"buyer_forms"/
-- "returnables"/"roles" item untouched by private documents is identical,
-- document-and-quote-for-document-and-quote, to the shared manifest's own
-- entry and to every other company's own override - exactly the common
-- case, not the exception.
--
-- Reproduced live on a scratch Postgres (117 migrations, 2 companies + 1
-- shared tender, each carrying the identical low-confidence item):
-- `platform_admin_low_confidence_requirement_items()` correctly listed all
-- 3 rows (shared + company A + company B) before any review; reviewing
-- ONLY company A's own row via the real `submit_requirement_extraction_
-- review()` made the SAME call return ZERO rows afterward - company B's
-- own item (never reviewed) and the shared manifest's own item (never
-- reviewed) both silently vanished from the queue too.
--
-- Fix: requirement_extraction_reviews now records WHICH manifest the
-- admin was actually looking at (company_id, null = the shared manifest -
-- same convention the queue function's own output column already uses),
-- and the exclusion in the queue function is scoped to match it exactly
-- (`is not distinct from`, so null correctly matches null rather than
-- excluding everything or nothing). A shared-manifest review still
-- correctly stops that same item recurring on the shared manifest (Finding
-- 318's own original fix, unregressed); a company's own review now only
-- ever retires that company's own copy, never a sibling's or the shared
-- manifest's.
alter table requirement_extraction_reviews
  add column company_id uuid references companies(id) on delete cascade;
comment on column requirement_extraction_reviews.company_id is
  'Which manifest this verdict was recorded against - null for the shared manifest (tenders.document_requirements), a company id for that company''s own private-document override (tender_packs.document_requirements, 0032). Added by Finding 335/0128: without it, item_key alone (no company_id in its own hash - see 0076) let one company''s review silently retire the identical item for every other company and the shared manifest too, none of which were actually reviewed.';
create index requirement_extraction_reviews_company_item_idx
  on requirement_extraction_reviews (tender_id, item_key, company_id);

drop function if exists submit_requirement_extraction_review(uuid, text, text, jsonb, text, jsonb, text);
create or replace function submit_requirement_extraction_review(
  p_tender_id uuid, p_item_key text, p_item_type text, p_item_snapshot jsonb,
  p_verdict text, p_corrected_value jsonb default null, p_note text default null,
  p_company_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not is_platform_admin() then
    raise exception 'Only a Tender Tool platform admin can do this' using errcode = '42501';
  end if;
  if p_verdict not in ('correct', 'corrected', 'false_positive') then
    raise exception 'verdict must be correct, corrected or false_positive' using errcode = '22023';
  end if;
  if p_verdict = 'corrected' and p_corrected_value is null then
    raise exception 'corrected_value is required when verdict is corrected' using errcode = '22023';
  end if;
  if p_verdict <> 'corrected' and p_corrected_value is not null then
    raise exception 'corrected_value may only be set when verdict is corrected' using errcode = '22023';
  end if;
  if not exists (select 1 from tenders where id = p_tender_id) then
    raise exception 'Tender not found' using errcode = 'P0002';
  end if;
  if p_company_id is not null and not exists (select 1 from companies where id = p_company_id) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;
  insert into requirement_extraction_reviews
    (tender_id, item_key, item_snapshot, verdict, corrected_value, note, reviewed_by, company_id)
  values
    (p_tender_id, p_item_key, p_item_snapshot || jsonb_build_object('item_type', p_item_type),
     p_verdict, p_corrected_value, p_note, auth.uid(), p_company_id)
  returning id into v_id;
  return v_id;
end;
$$;
comment on function submit_requirement_extraction_review(uuid, text, text, jsonb, text, jsonb, text, uuid) is
  'Records one platform-admin verdict on one requirements.py extraction item (p_item_key from platform_admin_low_confidence_requirement_items, or computed the same way for an item an admin reviews outside the low-confidence queue). p_company_id (Finding 335/0128) is which manifest was actually reviewed - null for the shared manifest, a company id for that company''s own private-document override - so the exclusion in the queue function cannot alias a different company''s (or the shared manifest''s) identical item_key as "already reviewed". p_item_type is folded into the stored item_snapshot so a later reader does not need a separate column. Feeds engine/general/requirements.py''s few-shot correction examples - see that function''s own comment. Platform-admin only (0043).';
revoke all on function submit_requirement_extraction_review(uuid, text, text, jsonb, text, jsonb, text, uuid) from public;
grant execute on function submit_requirement_extraction_review(uuid, text, text, jsonb, text, jsonb, text, uuid) to authenticated;
revoke execute on function submit_requirement_extraction_review(uuid, text, text, jsonb, text, jsonb, text, uuid) from anon;

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
        and r.company_id is not distinct from i.company_id
    )
  order by (i.item ->> 'confidence')::int asc
  limit p_limit;
$$;
comment on function platform_admin_low_confidence_requirement_items(smallint, int) is
  'Admin review queue (0076, extended 0100): every engine/general/requirements.py manifest item (forms/buyer_forms/returnables/roles/person_registrations/cidb/briefing) with confidence < p_threshold, across every tender''s shared manifest (tenders.document_requirements) and every company''s private-document override (tender_packs.document_requirements, 0032), EXCLUDING any item already given a verdict in requirement_extraction_reviews for the SAME (tender_id, item_key, company_id) - Finding 318 (0127) added the exclusion; Finding 335 (0128) scoped it to company_id (via `is not distinct from`, so null matches null) after a live repro showed a company_id-less exclusion let one company''s review silently retire the identical item for every other company''s own override and the shared manifest too, none of which were actually reviewed. A real re-extraction that changes the item''s document/quote text produces a new item_key and is correctly treated as unreviewed. Returns nothing unless the caller is a platform admin (0043).';
revoke all on function platform_admin_low_confidence_requirement_items(smallint, int) from public;
grant execute on function platform_admin_low_confidence_requirement_items(smallint, int) to authenticated;
revoke execute on function platform_admin_low_confidence_requirement_items(smallint, int) from anon;
