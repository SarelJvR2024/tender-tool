-- Private documents on a shared tender, and three holes in "a manually
-- loaded tender is private" closed (Sarel, 2026-10-17).
--
-- 1. A company can attach its OWN documents to a tender Discovery found
--    (shared: tenders.owner_company_id is null) - e.g. the full bid document
--    a buyer e-mailed it - without any other company pursuing the same tender
--    seeing them, their text, or anything read from them. Before this the
--    only way was to load a private duplicate with the OCDS id left blank
--    (Engine-Scenario-Test-Results.md "Limits").
--
--    Why not a company_id on tender_documents: that table (0001) is the
--    registry of the 5 SANRAL blank templates per tender, keyed
--    (tender_id, doc_type) - shared boilerplate the pack engine reads, one row
--    per type. A buyer's e-mailed documents are free-form and many; their
--    shared equivalent is tenders.document_urls. So the private equivalent is
--    a per-company list beside it: tender_private_documents, with the same
--    storage scheme 0024 uses for manual tenders - the 'tender-documents'
--    bucket under a company-owned prefix, private/<company_id>/<tender_id>/...,
--    written straight from the browser (no 4.5 MB server-action cap).
--
--    What is read FROM those documents must stay private too: the intake
--    (engine/general/process_general_jobs.py run_extraction) writes its
--    requirement manifest to tenders.document_requirements, which every
--    company sees. With private documents in the set it writes the manifest
--    and intake record to THIS company's tender_packs row instead
--    (tender_packs.document_requirements / intake, below); the Tender
--    Workspace and the pack builder prefer the pack's copy when there is one.
--
-- 2. Hole: the 'tender-documents' select policy (0024) left every path
--    outside manual/ readable by every signed-in user - including a private
--    tender's blank templates uploaded through the Tender Workspace's
--    templates card (0025 stores those at <tender_id>/<doc_type>/..., not
--    under manual/). Any user could list the bucket and read them. Now a
--    <tender_id>/ folder of a private tender is readable only by its owner's
--    members (tender_folder_readable(), SECURITY DEFINER so it sees the
--    tender row the caller's RLS hides).
--
-- 3. Hole: tender_packs' insert policy (0001) only checked membership of
--    company_id, so a company could create a pack for ANOTHER company's
--    private tender if it knew the id - and with a pack, 0025's
--    record_tender_document() would let it replace that tender's templates
--    and clear its positions. A restrictive policy now requires the tender
--    to be visible to the caller, and record_tender_document() checks it too.
--
-- 4. tenders.ocid was unique across ALL tenders (0018), so a company that
--    loaded a private copy of an eTenders tender with its OCDS id filled in
--    blocked every other company from pursuing that tender from Discovery
--    (pursue_discovered_opportunity would hit the unique index) - and the
--    error told them the tender existed. Unique among SHARED tenders only now;
--    load_manual_tender() refuses an OCDS id that is already a shared tender
--    and points to "add your private documents to it" instead.

-- ---------------------------------------------------------------------------
-- 1a. tender_private_documents
-- ---------------------------------------------------------------------------
create table tender_private_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  storage_path text not null unique,
  original_filename text,
  uploaded_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  -- The object must sit under this company's and this tender's own prefix,
  -- enforced for every writer, service role included.
  constraint tender_private_documents_path check (
    storage_path like 'private/' || company_id::text || '/' || tender_id::text || '/%'
    and storage_path not like '%..%'
  )
);
create index tender_private_documents_tender_idx on tender_private_documents (company_id, tender_id);

comment on table tender_private_documents is
  'A company''s own documents for a SHARED tender (one Discovery found), e.g. the bid document a buyer e-mailed it. Visible only to that company''s members; the intake reads them together with tenders.document_urls and writes what it found to that company''s tender_packs row, never to the shared tenders row. Files: tender-documents bucket, private/<company_id>/<tender_id>/.';

alter table tender_private_documents enable row level security;

create policy "tender_private_documents: members read their own" on tender_private_documents
  for select to authenticated using (is_company_member(company_id));
-- Only on a shared tender this company is working on (has a pack for). A
-- manually loaded tender is private already: its documents go through
-- add_manual_tender_documents() (0024).
create policy "tender_private_documents: members add to a shared tender" on tender_private_documents
  for insert to authenticated with check (
    is_company_member(company_id)
    and uploaded_by = auth.uid()
    and exists (select 1 from tenders t where t.id = tender_id and t.owner_company_id is null)
    and exists (select 1 from tender_packs tp where tp.company_id = tender_private_documents.company_id
                and tp.tender_id = tender_private_documents.tender_id)
  );
create policy "tender_private_documents: members remove their own" on tender_private_documents
  for delete to authenticated using (is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- 1b. This company's own reading of the tender (when it has private documents)
-- ---------------------------------------------------------------------------
alter table tender_packs
  add column document_requirements jsonb,
  add column intake jsonb;

comment on column tender_packs.document_requirements is
  'This company''s own requirement manifest (engine/general/requirements.py), read from the tender''s shared documents PLUS its tender_private_documents. Null = no private documents; use tenders.document_requirements. Never copied to the shared tenders row.';
comment on column tender_packs.intake is
  'The intake record (same shape as tenders.intake) for the reading in document_requirements.';

-- ---------------------------------------------------------------------------
-- 2. Storage: tender-documents
-- ---------------------------------------------------------------------------
-- True unless the folder names a PRIVATE tender the caller isn't a member of
-- the owner of. SECURITY DEFINER: the caller's own RLS on tenders hides that
-- row, so an invoker-rights check would wrongly say "no such tender".
create or replace function tender_folder_readable(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from tenders t
    where t.id::text = p_folder
      and t.owner_company_id is not null
      and not is_company_member(t.owner_company_id)
  );
$$;
revoke all on function tender_folder_readable(text) from public;
grant execute on function tender_folder_readable(text) to authenticated;

drop policy "tender-documents: readable by authenticated users" on storage.objects;
create policy "tender-documents: readable by authenticated users" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tender-documents'
    and case when (storage.foldername(name))[1] in ('manual', 'private')
             then is_company_member(((storage.foldername(name))[2])::uuid)
             else tender_folder_readable((storage.foldername(name))[1]) end
  );
create policy "tender-documents: members upload private documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tender-documents'
    and (storage.foldername(name))[1] = 'private'
    and is_company_member(((storage.foldername(name))[2])::uuid)
  );
create policy "tender-documents: members remove their private documents" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'tender-documents'
    and (storage.foldername(name))[1] = 'private'
    and is_company_member(((storage.foldername(name))[2])::uuid)
  );

-- ---------------------------------------------------------------------------
-- 3. tender_packs only for tenders the caller can see
-- ---------------------------------------------------------------------------
-- Restrictive, so it ANDs with 0001's tenant policy. The subquery runs under
-- the caller's RLS on tenders (0024), which is exactly "can see it".
create policy "tender_packs: only for visible tenders (insert)" on tender_packs
  as restrictive for insert to authenticated
  with check (exists (select 1 from tenders t where t.id = tender_id));
create policy "tender_packs: only for visible tenders (update)" on tender_packs
  as restrictive for update to authenticated
  using (true)
  with check (exists (select 1 from tenders t where t.id = tender_id));

create or replace function record_tender_document(
  p_tender_id uuid, p_doc_type text, p_storage_path text, p_original_filename text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_id uuid;
begin
  -- 0032: the tender itself must be visible to the caller (shared, or a
  -- private tender of their own company).
  if not exists (select 1 from tenders t where t.id = p_tender_id
                 and (t.owner_company_id is null or is_company_member(t.owner_company_id))) then
    raise exception 'tender not found' using errcode = 'P0002';
  end if;
  select tp.company_id into v_company
  from tender_packs tp
  where tp.tender_id = p_tender_id and is_company_member(tp.company_id)
  limit 1;
  if v_company is null then
    raise exception 'Start a pack for this tender before uploading its templates.' using errcode = '42501';
  end if;
  if p_doc_type not in ('technical_xlsm', 'financial_xlsm', 'c111_form_of_offer', 'c123_contract_data', 'a_forms') then
    raise exception 'Unknown template type: %', p_doc_type using errcode = '22023';
  end if;
  if split_part(p_storage_path, '/', 1) <> p_tender_id::text
     or split_part(p_storage_path, '/', 2) <> p_doc_type then
    raise exception 'The file must be stored under this tender''s own %/% folder.', p_tender_id, p_doc_type
      using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'tender-documents' and o.name = p_storage_path) then
    raise exception 'Uploaded file not found in storage.' using errcode = '22023';
  end if;

  insert into tender_documents (tender_id, doc_type, storage_path, downloaded_at,
                                uploaded_by, uploaded_by_company, original_filename)
  values (p_tender_id, p_doc_type, p_storage_path, now(), auth.uid(), v_company, p_original_filename)
  on conflict (tender_id, doc_type) do update
    set storage_path = excluded.storage_path,
        downloaded_at = excluded.downloaded_at,
        uploaded_by = excluded.uploaded_by,
        uploaded_by_company = excluded.uploaded_by_company,
        original_filename = excluded.original_filename
  returning id into v_id;

  if p_doc_type = 'technical_xlsm' then
    delete from tender_requirements where tender_id = p_tender_id;
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. OCDS id unique among shared tenders only
-- ---------------------------------------------------------------------------
drop index tenders_ocid_key;
create unique index tenders_ocid_key on tenders (ocid) where ocid is not null and owner_company_id is null;

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

  if nullif(btrim(p_ocid), '') is not null then
    -- Already a shared tender (found by Discovery): don't make a private twin
    -- - add the documents to it privately instead (0032). Another company's
    -- private copy with the same id is invisible here and blocks nothing.
    select id into existing from tenders where ocid = btrim(p_ocid) and owner_company_id is null;
    if existing is not null then
      raise exception 'Tender % is already in Tender Tool (found by Discovery) - open it from Discovery or the Tenders list and add these documents under "Your private documents": only your company will see them.', btrim(p_ocid)
        using errcode = '23505';
    end if;
    select id into existing from tenders where ocid = btrim(p_ocid) and owner_company_id = p_company_id;
    if existing is not null then
      raise exception 'You already loaded tender % - open it from the Tenders list and use "Add documents and re-analyse".', btrim(p_ocid)
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
