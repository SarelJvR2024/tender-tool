-- Manual tender load: "here's a tender I found some other way (SANRAL's own
-- site, a tender a client forwarded, a buyer not on eTenders) - load it and
-- run it through everything." (Sarel, 2026-10-17.)
--
-- Until now a tender could only enter the system through Discovery's OCDS
-- scrape (engine/discovery/etenders_national.py -> discovered_opportunities ->
-- pursue_discovered_opportunity(), 0018). General-Tender-Preparation-Findings
-- gap 8 / System-Status gap #1(d): "tenders not on eTenders can't be pursued".
--
-- What this adds:
--  1. tenders.source 'manual' + tenders.owner_company_id. A manually loaded
--     tender is PRIVATE to the company that loaded it (a client-forwarded RFQ
--     must not show up on every other tenant's dashboard), unlike the shared
--     SANRAL/eTenders rows. The select policies on tenders, tender_documents
--     and tender_requirements are narrowed accordingly: owner_company_id is
--     null (shared, as before) or the caller is a member of the owner.
--  2. tenders.intake: what the intake step (engine/intake/classify_tender.py,
--     run by the extract_requirements job) decided about the uploaded
--     documents - SANRAL template family vs. general route, the signal it
--     used (fingerprint.detect_family on an .xlsm sheet set), which documents
--     became the SANRAL blank templates, the fingerprint check, and any
--     discrepancy between what the user typed and the template's own SETUP.
--  3. discovered_opportunities.source / tender_id: the fit verdict and score
--     outlook (assess_tender.py / score_outlook.py) for a manual tender are
--     written to discovered_opportunities exactly like a discovered one, so
--     /discovery and the Tender Workspace read them the same way; tender_id
--     links an opportunity to the tender it became (set for manual loads and
--     now also by pursue_discovered_opportunity), so "Prepare this tender" on
--     an already-opened opportunity reopens it instead of creating a twin.
--     Also replaces 0004's partial (company_id, ocid) index with a plain
--     unique constraint so PostgREST upserts on it work (see section 3).
--  4. Storage: the uploaded documents go DIRECTLY from the browser into the
--     0017 'tender-documents' bucket under manual/<company_id>/<tender_id>/...
--     (bypassing the 4.5 MB Vercel server-action body limit - a SANRAL set is
--     two ~2 MB workbooks plus Book 1/2 PDFs). Members may write and read
--     only their own company's manual/ prefix; everything else in the bucket
--     stays read-only shared boilerplate as 0017 intended.
--  5. load_manual_tender() / add_manual_tender_documents(): the one controlled
--     way to create the private tenders row + this company's tender_pack +
--     the intake job (same SECURITY DEFINER shape as 0018's
--     pursue_discovered_opportunity()).

-- ---------------------------------------------------------------------------
-- 1. tenders
-- ---------------------------------------------------------------------------
alter table tenders drop constraint tenders_source_check;
alter table tenders add constraint tenders_source_check check (source in ('sanral', 'etenders_ocds', 'manual'));
alter table tenders add column owner_company_id uuid references companies(id) on delete cascade;
alter table tenders add column intake jsonb;
alter table tenders add constraint tenders_manual_has_owner check (source <> 'manual' or owner_company_id is not null);
create index tenders_owner_company_idx on tenders (owner_company_id) where owner_company_id is not null;

comment on column tenders.owner_company_id is
  'Null = shared public tender (SANRAL/eTenders, as before). Set = a tender one company loaded by hand from its own documents; only that company''s members can see it, its documents or its requirements.';
comment on column tenders.intake is
  'What the intake step (engine/intake/classify_tender.py, run inside the extract_requirements job) decided from the tender''s own documents: route (sanral|general), family, the signal used, the SANRAL templates it registered, the template fingerprint check, and notes/discrepancies. Null = not analysed yet.';

drop policy "tenders readable by authenticated users" on tenders;
create policy "tenders readable by authenticated users" on tenders
  for select to authenticated using (owner_company_id is null or is_company_member(owner_company_id));

drop policy "tender_documents readable by authenticated users" on tender_documents;
create policy "tender_documents readable by authenticated users" on tender_documents
  for select to authenticated using (
    exists (select 1 from tenders t where t.id = tender_id
            and (t.owner_company_id is null or is_company_member(t.owner_company_id))));

drop policy "tender_requirements readable by authenticated users" on tender_requirements;
create policy "tender_requirements readable by authenticated users" on tender_requirements
  for select to authenticated using (
    exists (select 1 from tenders t where t.id = tender_id
            and (t.owner_company_id is null or is_company_member(t.owner_company_id))));

-- ---------------------------------------------------------------------------
-- 3. discovered_opportunities
-- ---------------------------------------------------------------------------
alter table discovered_opportunities add column source text not null default 'etenders_ocds'
  check (source in ('etenders_ocds', 'manual'));
alter table discovered_opportunities add column tender_id uuid references tenders(id) on delete set null;
-- Plain unique constraints, NOT partial indexes: PostgREST's ?on_conflict=
-- can only target a constraint/index without a WHERE predicate (Postgres
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" otherwise - reproduced on a scratch replay). 0004's partial
-- (company_id, ocid) index therefore made seed_supabase_opportunities.py's
-- upsert fail against any real project. Nulls are distinct in a unique
-- constraint, so null-ocid / null-tender rows still never collide - the
-- reason 0004 gave for the partial index doesn't hold.
drop index discovered_opportunities_company_ocid_key;
alter table discovered_opportunities add constraint discovered_opportunities_company_ocid_key unique (company_id, ocid);
alter table discovered_opportunities add constraint discovered_opportunities_company_tender_key unique (company_id, tender_id);

-- ---------------------------------------------------------------------------
-- 4. Storage: tender-documents, manual/<company_id>/<tender_id>/<file>
-- ---------------------------------------------------------------------------
-- CASE (not AND) so the uuid cast is only attempted on a manual/ path.
drop policy "tender-documents: readable by authenticated users" on storage.objects;
create policy "tender-documents: readable by authenticated users" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tender-documents'
    and case when (storage.foldername(name))[1] = 'manual'
             then is_company_member(((storage.foldername(name))[2])::uuid)
             else true end
  );
create policy "tender-documents: members upload their own manual tenders" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tender-documents'
    and (storage.foldername(name))[1] = 'manual'
    and is_company_member(((storage.foldername(name))[2])::uuid)
  );
create policy "tender-documents: members remove their own manual uploads" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tender-documents'
    and (storage.foldername(name))[1] = 'manual'
    and is_company_member(((storage.foldername(name))[2])::uuid)
  );

-- ---------------------------------------------------------------------------
-- 5. load_manual_tender() / add_manual_tender_documents()
-- ---------------------------------------------------------------------------
-- p_documents: [{"title": "<original file name>", "storage_path": "manual/<company>/<tender>/<file>"}]
-- Each path must sit under this company's and this tender's own prefix - the
-- browser uploaded them there (policy above); this re-checks it server side.
create or replace function _manual_tender_documents(p_company_id uuid, p_tender_id uuid, p_documents jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  d jsonb;
  out jsonb := '[]'::jsonb;
  prefix text := 'manual/' || p_company_id::text || '/' || p_tender_id::text || '/';
begin
  if p_documents is null or jsonb_typeof(p_documents) <> 'array' or jsonb_array_length(p_documents) = 0 then
    raise exception 'Upload at least one of the tender''s own documents.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_documents) > 60 then
    raise exception 'Too many documents in one load (max 60) - zip them instead.' using errcode = '22023';
  end if;
  for d in select * from jsonb_array_elements(p_documents) loop
    if coalesce(d ->> 'storage_path', '') not like prefix || '%' or (d ->> 'storage_path') like '%..%' then
      raise exception 'Document path % is outside this tender''s upload folder.', d ->> 'storage_path' using errcode = '42501';
    end if;
    out := out || jsonb_build_array(jsonb_build_object(
      'title', left(coalesce(nullif(d ->> 'title', ''), regexp_replace(d ->> 'storage_path', '^.*/', '')), 200),
      'storage_path', d ->> 'storage_path',
      'bucket', 'tender-documents',
      'url', null));
  end loop;
  return out;
end;
$$;

create or replace function load_manual_tender(
  p_company_id uuid,
  p_tender_id uuid,
  p_title text,
  p_buyer text,
  p_reference text,
  p_ocid text,
  p_closing_date timestamptz,
  p_documents jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  docs jsonb;
  existing uuid;
  pack_id uuid;
begin
  if not is_company_member(p_company_id) then
    raise exception 'not a member of this company' using errcode = '42501';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'Give the tender a title.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_buyer), '') = '' then
    raise exception 'Say who the buyer is.' using errcode = '22023';
  end if;
  docs := _manual_tender_documents(p_company_id, p_tender_id, p_documents);

  -- An OCDS id that's already a tender here: that tender is already in the
  -- system (pursued from Discovery, or loaded before) - say so instead of
  -- creating a second copy of it.
  if nullif(btrim(p_ocid), '') is not null then
    select id into existing from tenders where ocid = btrim(p_ocid);
    if existing is not null then
      raise exception 'A tender with OCDS id % is already loaded - open it from the Tenders list instead.', btrim(p_ocid)
        using errcode = '23505';
    end if;
  end if;

  insert into tenders (id, slug, contract_no, title, description, closing_date, family, status,
                       buyer, ocid, source, document_urls, owner_company_id)
  values (p_tender_id, 'manual-' || p_tender_id::text,
          nullif(btrim(p_reference), ''),
          btrim(p_title), btrim(p_title),
          p_closing_date,
          null, -- decided by the intake job from the documents themselves
          case when p_closing_date is not null and p_closing_date < now() then 'closed' else 'open' end,
          btrim(p_buyer), nullif(btrim(p_ocid), ''), 'manual', docs, p_company_id);

  insert into tender_packs (company_id, tender_id) values (p_company_id, p_tender_id)
  returning id into pack_id;

  insert into tender_engine_jobs (company_id, tender_id, tender_pack_id, kind, requested_by)
  values (p_company_id, p_tender_id, pack_id, 'extract_requirements', auth.uid());

  return p_tender_id;
end;
$$;
comment on function load_manual_tender(uuid, uuid, text, text, text, text, timestamptz, jsonb) is
  'Signed-in member -> a private (owner_company_id) tenders row from documents they uploaded to tender-documents/manual/<company>/<tender>/, this company''s tender_pack, and the intake/extract_requirements job. Family is left null for the intake to decide from the documents.';

create or replace function add_manual_tender_documents(p_tender_id uuid, p_documents jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t tenders%rowtype;
  docs jsonb;
  pack_id uuid;
begin
  select * into t from tenders where id = p_tender_id;
  if not found or t.source <> 'manual' or not is_company_member(t.owner_company_id) then
    raise exception 'tender not found' using errcode = 'P0002';
  end if;
  docs := _manual_tender_documents(t.owner_company_id, p_tender_id, p_documents);
  update tenders set document_urls = document_urls || docs, last_seen_at = now() where id = p_tender_id;
  select id into pack_id from tender_packs where company_id = t.owner_company_id and tender_id = p_tender_id;
  insert into tender_engine_jobs (company_id, tender_id, tender_pack_id, kind, requested_by)
  values (t.owner_company_id, p_tender_id, pack_id, 'extract_requirements', auth.uid())
  on conflict (company_id, tender_id, engine, kind) where status in ('requested', 'generating') do nothing;
  return p_tender_id;
end;
$$;

revoke all on function _manual_tender_documents(uuid, uuid, jsonb) from public;
revoke all on function load_manual_tender(uuid, uuid, text, text, text, text, timestamptz, jsonb) from public;
revoke all on function add_manual_tender_documents(uuid, jsonb) from public;
grant execute on function load_manual_tender(uuid, uuid, text, text, text, text, timestamptz, jsonb) to authenticated;
grant execute on function add_manual_tender_documents(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- pursue_discovered_opportunity(): unchanged except it now records the
-- tender it opened on the opportunity (tender_id), and an opportunity that
-- already has one (a manual load, or pursued before) just reopens it.
-- ---------------------------------------------------------------------------
create or replace function pursue_discovered_opportunity(p_opportunity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  opp discovered_opportunities%rowtype;
  t_id uuid;
  rules jsonb;
begin
  select * into opp from discovered_opportunities where id = p_opportunity_id;
  if not found or not is_company_member(opp.company_id) then
    raise exception 'opportunity not found' using errcode = 'P0002';
  end if;
  if opp.tender_id is not null and exists (select 1 from tenders where id = opp.tender_id) then
    return opp.tender_id;
  end if;

  if opp.score_outlook ? 'experience_evidence' then
    rules := jsonb_build_object(
      'experience_evidence', opp.score_outlook -> 'experience_evidence',
      'locality', jsonb_build_object(
        'rows', coalesce(opp.score_outlook -> 'locality' -> 'rows', '[]'::jsonb),
        'mandatory_local_office', opp.score_outlook -> 'locality' -> 'mandatory_local_office'),
      'source_document', 'discovery outlook (first readable document)',
      'extracted_at', now());
  end if;

  insert into tenders (slug, contract_no, title, description, closing_date, family, status,
                       buyer, ocid, source, document_urls, evaluation_rules)
  values (coalesce(opp.ocid, 'opportunity-' || opp.id::text),
          coalesce(opp.title, opp.contract_number),
          opp.title,
          coalesce(opp.description, opp.title),
          opp.closing_date,
          'General (non-SANRAL)',
          case when opp.closing_date is not null and opp.closing_date < now() then 'closed' else 'open' end,
          opp.buyer, opp.ocid, 'etenders_ocds', opp.document_urls, rules)
  on conflict (slug) do update set last_seen_at = now()
  returning id into t_id;

  update discovered_opportunities set tender_id = t_id where id = opp.id;

  insert into tender_packs (company_id, tender_id)
  values (opp.company_id, t_id)
  on conflict (company_id, tender_id) do nothing;

  if not exists (select 1 from tenders where id = t_id and document_requirements is not null) then
    insert into tender_engine_jobs (company_id, tender_id, tender_pack_id, kind, requested_by)
    select opp.company_id, t_id, tp.id, 'extract_requirements', auth.uid()
    from tender_packs tp where tp.company_id = opp.company_id and tp.tender_id = t_id
    on conflict (company_id, tender_id, engine, kind) where status in ('requested', 'generating') do nothing;
  end if;

  return t_id;
end;
$$;
