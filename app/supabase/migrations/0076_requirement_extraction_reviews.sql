-- Platform-admin review/correction of individual engine/general/requirements.py
-- extraction items, and the "train to improve the confidence" feedback loop
-- (Sarel, relayed with the per-item confidence work: "an admin-level review/
-- correction mechanism that feeds back to improve future confidence/
-- accuracy ... go ahead with everything").
--
-- requirements.py's manifest (stored as-is in tenders.document_requirements
-- for the shared reading, or tender_packs.document_requirements when a
-- company's own private documents change the reading - see 0018/0032) now
-- carries a 0-100 "confidence" + "confidence_reason" on every item that
-- carries a "quote" (forms, buyer_forms, returnables, roles,
-- person_registrations, cidb, briefing). This migration adds:
--   1. requirement_extraction_reviews - one row per admin verdict on one
--      extracted item.
--   2. platform_admin_low_confidence_requirement_items() - the admin review
--      queue: every item below a confidence threshold, across every tender's
--      shared manifest AND every company's private-document override.
--   3. submit_requirement_extraction_review() - record a verdict.
-- Same escape-hatch pattern as 0043/0064/0072: is_platform_admin() gate,
-- SECURITY DEFINER, search_path pinned to public, pg_temp.
--
-- item_key: a manifest item has no natural primary key of its own (it's a
-- position inside a jsonb array engine/general/requirements.py rebuilds from
-- scratch on every re-extraction), so item_key is a deterministic hash of
-- (tender_id, item_type, document, quote) - stable across re-extractions of
-- the SAME document set (the quote text doesn't change unless the source
-- document or the regex/extraction logic changes), and distinct across
-- different findings even when two items share a label (e.g. two different
-- "CIDB" mentions in different documents). md5() rather than a sequence/
-- surrogate id: the UI building the review queue needs to recognise "this is
-- the same item I already reviewed" across re-extractions without a round
-- trip, and a content hash gives it that for free.
create table requirement_extraction_reviews (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  item_key text not null, -- md5(tender_id || item_type || document || quote) - see header
  item_snapshot jsonb not null, -- the full extracted item (confidence, quote, mentions, document...) as it looked when reviewed
  verdict text not null check (verdict in ('correct', 'corrected', 'false_positive')),
  corrected_value jsonb, -- the admin's replacement item; null unless verdict = 'corrected'
  note text,
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (verdict = 'corrected' or corrected_value is null)
);
comment on table requirement_extraction_reviews is
  'One platform-admin verdict on one engine/general/requirements.py extracted manifest item (not a whole tender). Read by the admin review queue (platform_admin_low_confidence_requirement_items) and by extract_requirements() itself as few-shot "a human corrected this before" examples (see that function''s own comment for the training mechanism). item_key lets the same item be recognised across re-extractions - see this migration''s header.';
comment on column requirement_extraction_reviews.item_key is
  'md5(tender_id || ''|'' || item_type || ''|'' || coalesce(document, '''') || ''|'' || coalesce(quote, '''')) - stable across re-extractions of the same documents, distinct across different findings. Computed by the caller (the admin UI / submit_requirement_extraction_review''s own callers), not by this table.';
comment on column requirement_extraction_reviews.item_snapshot is
  'The extracted item exactly as shown to the admin when reviewed (confidence, confidence_reason, quote, mentions, document, etc.) - kept even if a later re-extraction changes or drops the item, so the review record stays meaningful on its own.';
comment on column requirement_extraction_reviews.corrected_value is
  'The admin''s replacement for item_snapshot when verdict=''corrected'' (e.g. a different form code, a quote that was actually about a different requirement). Null for ''correct'' and ''false_positive''.';

create index requirement_extraction_reviews_tender_id_idx on requirement_extraction_reviews (tender_id);
create index requirement_extraction_reviews_item_key_idx on requirement_extraction_reviews (item_key);
create index requirement_extraction_reviews_verdict_created_idx on requirement_extraction_reviews (verdict, created_at desc);

alter table requirement_extraction_reviews enable row level security;
create policy "requirement_extraction_reviews: platform admins can select"
  on requirement_extraction_reviews for select to authenticated using (is_platform_admin());
-- No client insert/update/delete policy: writes go only through
-- submit_requirement_extraction_review() below (SECURITY DEFINER), so every
-- write is attributed to the calling admin via auth.uid() and can't be
-- forged as somebody else's review.

-- ---------------------------------------------------------------------------
-- 2. Review queue: every item under the threshold, across BOTH
-- tenders.document_requirements (the shared manifest) and every
-- tender_packs.document_requirements override (a company's own private-
-- document reading - 0032). A tender with a pack override is listed once per
-- company override PLUS once for the shared manifest if that is also still
-- below threshold - they can differ (0032: "Never copied to the shared
-- tenders row"), so conflating them would hide a real discrepancy.
--
-- Each manifest section has a different shape (forms/buyer_forms/returnables/
-- roles/person_registrations are arrays; cidb/briefing are single objects),
-- so this walks each section with its own jsonb_array_elements /
-- jsonb_build_array call rather than one generic path query - every section
-- it reads matches exactly what engine/general/requirements.py now writes
-- "confidence" onto (see this migration's header).
-- ---------------------------------------------------------------------------
create or replace function platform_admin_low_confidence_requirement_items(
  p_threshold smallint default 60, p_limit int default 200
)
returns table (
  tender_id uuid,
  tender_title text,
  tender_contract_no text,
  tender_buyer text,
  company_id uuid, -- null when the item comes from the shared tenders.document_requirements manifest
  item_type text, -- 'forms' | 'buyer_forms' | 'returnables' | 'roles' | 'person_registrations' | 'cidb' | 'briefing'
  item_key text,
  item jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with manifests as (
    -- shared manifest, company_id null
    select t.id as tender_id, t.title as tender_title, t.contract_no as tender_contract_no,
           t.buyer as tender_buyer, null::uuid as company_id, t.document_requirements as manifest
    from tenders t
    where t.document_requirements is not null
    union all
    -- per-company private-document override (0032)
    select t.id, t.title, t.contract_no, t.buyer, tp.company_id, tp.document_requirements
    from tender_packs tp
    join tenders t on t.id = tp.tender_id
    where tp.document_requirements is not null
  ),
  items as (
    select m.tender_id, m.tender_title, m.tender_contract_no, m.tender_buyer, m.company_id,
           sect.item_type, elem.item
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
    md5(i.tender_id::text || '|' || i.item_type || '|' || coalesce(i.item ->> 'document', '') || '|' || coalesce(i.item ->> 'quote', '')),
    i.item
  from items i
  where is_platform_admin()
  order by (i.item ->> 'confidence')::int asc
  limit p_limit;
$$;
comment on function platform_admin_low_confidence_requirement_items(smallint, int) is
  'Admin review queue: every engine/general/requirements.py manifest item (forms/buyer_forms/returnables/roles/person_registrations/cidb/briefing) with confidence < p_threshold, across every tender''s shared manifest (tenders.document_requirements) and every company''s private-document override (tender_packs.document_requirements, 0032). item_key matches the hash submit_requirement_extraction_review() expects. Returns nothing unless the caller is a platform admin (0043).';
revoke all on function platform_admin_low_confidence_requirement_items(smallint, int) from public;
grant execute on function platform_admin_low_confidence_requirement_items(smallint, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Submit a verdict
-- ---------------------------------------------------------------------------
create or replace function submit_requirement_extraction_review(
  p_tender_id uuid, p_item_key text, p_item_type text, p_item_snapshot jsonb,
  p_verdict text, p_corrected_value jsonb default null, p_note text default null
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
  insert into requirement_extraction_reviews
    (tender_id, item_key, item_snapshot, verdict, corrected_value, note, reviewed_by)
  values
    (p_tender_id, p_item_key, p_item_snapshot || jsonb_build_object('item_type', p_item_type),
     p_verdict, p_corrected_value, p_note, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
comment on function submit_requirement_extraction_review(uuid, text, text, jsonb, text, jsonb, text) is
  'Records one platform-admin verdict on one requirements.py extraction item (p_item_key from platform_admin_low_confidence_requirement_items, or computed the same way for an item an admin reviews outside the low-confidence queue). p_item_type is folded into the stored item_snapshot so a later reader does not need a separate column. Feeds engine/general/requirements.py''s few-shot correction examples - see that function''s own comment. Platform-admin only (0043).';
revoke all on function submit_requirement_extraction_review(uuid, text, text, jsonb, text, jsonb, text) from public;
grant execute on function submit_requirement_extraction_review(uuid, text, text, jsonb, text, jsonb, text) to authenticated;
