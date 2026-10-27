-- Quality Scout triage, Phase 2 of the Admin Command Center brief
-- (2026-10-27): extends the existing low-confidence review queue (0074/0076)
-- with (1) a best-effort link back to the actual source document for each
-- item, and (2) a real "Reprocess" action.
--
-- Document link: deliberately NOT a stored, authoritative column anywhere -
-- confirmed by reading engine/general/process_general_jobs.py's
-- download_tender_documents() that a manifest item's own "document" field is
-- just a sanitised basename, with no id/path kept alongside it. This
-- resolves one, best-effort, read-only: match that basename/title against
-- tenders.document_urls (the buyer's own published [{url, title}] links,
-- 0018) for the SHARED manifest case. For a company's own private-document
-- override (0032), tender_private_documents IS a real, queryable table, but
-- its storage objects sit under storage.objects RLS policies gated on
-- is_company_member() (0032's own "tender-documents: readable by
-- authenticated users" policy) - a platform admin's own session is not a
-- member of an arbitrary tenant, so it cannot create a signed URL for that
-- path today. Extending that bucket policy to platform admins is a real,
-- separate privacy-boundary decision (any admin could then read any
-- tenant's private uploads directly via the Storage API, not just through a
-- curated admin page) - flagged in docs/specs/System-Status.md for Sarel's
-- own call, not made unilaterally here. So a private-document match returns
-- only its filename as a "document on file, not previewable yet" note, never
-- a broken or over-privileged link.
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
  source_document_url text,   -- best-effort match against tenders.document_urls; null if no match or not applicable
  source_document_note text   -- set instead of a URL when the document is a private company upload on file but not previewable from here
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
    i.item,
    -- Shared-manifest items only: best-effort title match, case-insensitive,
    -- against this tender's own published document links.
    case when i.company_id is null and i.item ->> 'document' is not null then (
      select du ->> 'url' from tenders t, jsonb_array_elements(t.document_urls) du
      where t.id = i.tender_id and lower(du ->> 'title') = lower(i.item ->> 'document')
      limit 1
    ) end,
    -- Company-override items only: a real private upload may exist under
    -- this exact title - named, not linked (see this migration's header).
    case when i.company_id is not null and i.item ->> 'document' is not null then (
      select 'Private document on file: ' || tpd.title || ' - not previewable from this console yet.'
      from tender_private_documents tpd
      where tpd.company_id = i.company_id and tpd.tender_id = i.tender_id
        and lower(tpd.title) = lower(i.item ->> 'document')
      limit 1
    ) end
  from items i
  where is_platform_admin()
  order by (i.item ->> 'confidence')::int asc
  limit p_limit;
$$;
comment on function platform_admin_low_confidence_requirement_items(smallint, int) is
  'Admin review queue (0076), extended (Phase 2, 2026-10-27) with a best-effort source_document_url/source_document_note per item - see this migration''s own header for why a private company upload only gets a note, never a link.';
revoke all on function platform_admin_low_confidence_requirement_items(smallint, int) from public;
grant execute on function platform_admin_low_confidence_requirement_items(smallint, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Reprocess: queue a real extract_requirements job (0026's unified job
-- queue), claimed by the SAME always-on engine/general/process_general_jobs.py
-- bridge every other general-engine job already goes through - never a new
-- worker, never synchronous. Deliberately `kind = 'extract_requirements'`,
-- not `generate_pack` - confirmed by reading process_job() in that script
-- that this kind calls run_extraction() only, with no pack assembly and no
-- pack-ready email side effect, so "Reprocess" does exactly what it says and
-- nothing more.
--
-- Company-scoped only (p_company_id required, matching pack_generation_jobs'
-- own not-null constraint): a platform admin has no company membership of
-- their own to insert a row as, and a job genuinely needs a company_id to
-- mean anything (re-reading that ONE company's manifest + its own private
-- documents). The SHARED manifest (a low-confidence item with no company
-- override at all) has no equivalent narrow job kind anywhere in this
-- codebase - it is only ever rebuilt as a side effect of some company's own
-- real job - so there is deliberately no reprocess path for those rows here;
-- building one would mean new job-queue architecture, not a wire-up, and is
-- flagged in docs/specs/System-Status.md rather than invented unilaterally.
create or replace function platform_admin_reprocess_requirement_extraction(
  p_company_id uuid, p_tender_id uuid
)
returns table (queued boolean, reason text)
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
  if not exists (select 1 from companies where id = p_company_id) then
    raise exception 'Company not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from tenders where id = p_tender_id) then
    raise exception 'Tender not found' using errcode = 'P0002';
  end if;
  begin
    insert into pack_generation_jobs (company_id, tender_id, engine, kind, status)
    values (p_company_id, p_tender_id, 'general', 'extract_requirements', 'requested')
    returning id into v_id;
    return query select true, 'Queued - the always-on engine worker picks this up on its next poll.';
  exception
    when unique_violation then
      -- pack_generation_jobs_one_open_key (0026): a reprocess for this exact
      -- (company, tender) is already requested or running - not an error,
      -- just nothing new to do.
      return query select false, 'Already queued or running for this company and tender - nothing new queued.';
  end;
end;
$$;
comment on function platform_admin_reprocess_requirement_extraction(uuid, uuid) is
  'Queues a kind=extract_requirements pack_generation_jobs row (0017/0026) for one company''s own reading of one tender - claimed by the existing always-on engine/general/process_general_jobs.py bridge, never run synchronously from this call. Platform-admin only (0043). Returns queued=false (not an error) when one is already in flight for the same (company, tender).';
revoke all on function platform_admin_reprocess_requirement_extraction(uuid, uuid) from public;
grant execute on function platform_admin_reprocess_requirement_extraction(uuid, uuid) to authenticated;
