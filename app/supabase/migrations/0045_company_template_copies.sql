-- Blank SANRAL templates: each company's upload is its own copy (POPIA /
-- cross-tenant audit follow-up, 2026-10-17 - docs/specs/POPIA-Security-Audit.md
-- section "Shared templates"). Reproduced before and shown closed after by
-- engine/security/test_tenant_isolation.py cases 16-17.
--
-- The hole. tender_documents (0001) is one row per (tender, template type),
-- "uploaded once per tender, not once per company", and 0025 let any company
-- with a pack on a tender supply it. Every other company pursuing the tender
-- then (a) could download that file straight from Storage (the tender folder
-- is readable by every company that can see the tender) and (b) had its own
-- submission pack built from it. Nothing checks that the file is really
-- blank. If company A uploaded its own filled-in Technical workbook - by
-- mistake, or the copy it already started typing into - company B could read
-- A's key people, ID numbers, projects, referees and registration numbers
-- out of it, and B's own pack kept every one of A's cells B's data did not
-- overwrite: reproduced by filling R.396-010-2025/1F as A (3 projects per
-- person, a SACPCMP number) and then filling A's output as B (1 project, no
-- SACPCMP): B's workbook still carried A's projects 2 and 3, A's referee and
-- phone number and A's SACPCMP number. The same channel lets a competitor
-- plant an altered template (positions, forms wording) that every other
-- bidder's pack is then built on - and since 0043, nobody else could replace
-- it. The Financial workbook carries the company's rates.
--
-- Why per-company copies and not a "is this file really blank" check: a
-- blank check can only look at the cells the fillers write (it misses
-- narrative text, other sheets, the .docx forms, the Financial workbook's
-- rates), it is evadable, and it says nothing about a file that is blank but
-- altered. The convenience being given up - the first company's upload
-- saving the next company one download - is exactly the channel: it is the
-- one place where one tenant's file flows into another tenant's output. And
-- every bidder downloads the tender documents from SANRAL anyway (to read
-- them, and to be on the downloaders' list that receives addenda), so
-- uploading those same files once more is a few seconds.
--
-- Now:
--   * tender_documents.company_id: null = shared, registered by the service
--     role from the buyer's own published documents (the intake,
--     process_general_jobs.register_sanral_tender) - the one trusted source,
--     still shared. Not null = that company's own copy: visible to and used
--     by that company only. One row per (tender, type, company).
--   * tender_requirements.company_id likewise: the positions read from a
--     company's own Technical workbook are that company's; the shared rows
--     (from the buyer's file) are what a company sees until it has its own.
--   * record_tender_document(): the file must be under the caller's own
--     private/<company>/<tender>/templates/<type>/ folder (0032's storage
--     scheme, readable only by that company), and it registers / replaces
--     only that company's copy; replacing the Technical workbook clears only
--     that company's positions. The shared row can't be touched by a client.
--   * The 0025 storage insert policy for <tender_id>/... is dropped: no
--     client writes into the shared tender folder any more.
--   * Files a company uploaded there before this migration (and every old
--     version it replaced) stay in Storage, so the bucket's select policy
--     now shows an object in a <tender_id>/<type>/ template folder only when
--     it is a shared row's file or the caller's own company's.
--   * tender_document_uploads() no longer reports "uploaded by another
--     company" - there is no such thing any more, which also removes the
--     "a competitor is on this tender" signal 0043 had to keep.
--
-- Existing data: a row a company uploaded becomes that company's copy
-- (company_id = uploaded_by_company); the positions read from it become that
-- company's positions. Other companies that were relying on it see the
-- template as "Needed" again and upload their own - intended.

-- ---------------------------------------------------------------------------
-- 1. tender_documents: per-company copies
-- ---------------------------------------------------------------------------
alter table tender_documents
  add column company_id uuid references companies(id) on delete cascade;
comment on column tender_documents.company_id is
  'Null = the shared copy, registered by the service role from the buyer''s own published documents. Otherwise the company whose own upload this is: visible to and used by that company only (0045).';

update tender_documents set company_id = uploaded_by_company where uploaded_by_company is not null;

alter table tender_documents drop constraint tender_documents_tender_id_doc_type_key;
alter table tender_documents add constraint tender_documents_tender_doc_company_key
  unique nulls not distinct (tender_id, doc_type, company_id);

drop policy "tender_documents readable by authenticated users" on tender_documents;
create policy "tender_documents readable by authenticated users" on tender_documents
  for select to authenticated using (
    (company_id is null or is_company_member(company_id))
    and exists (select 1 from tenders t where t.id = tender_id
                and (t.owner_company_id is null or is_company_member(t.owner_company_id))));

grant select (company_id) on tender_documents to authenticated;

-- ---------------------------------------------------------------------------
-- 2. tender_requirements: positions from a company's own workbook are its own
-- ---------------------------------------------------------------------------
alter table tender_requirements
  add column company_id uuid references companies(id) on delete cascade;
comment on column tender_requirements.company_id is
  'Null = read from the shared (buyer-published) Technical workbook. Otherwise read from that company''s own uploaded copy, and only that company sees them; a company with its own rows for a tender no longer sees the shared ones (0045).';

-- Positions read from a workbook that is now a company's own copy.
update tender_requirements r
   set company_id = d.company_id
  from tender_documents d
 where d.tender_id = r.tender_id and d.doc_type = 'technical_xlsm' and d.company_id is not null
   and not exists (select 1 from tender_documents s where s.tender_id = r.tender_id
                   and s.doc_type = 'technical_xlsm' and s.company_id is null);

alter table tender_requirements drop constraint tender_requirements_tender_id_position_code_is_alternate_key;
alter table tender_requirements add constraint tender_requirements_tender_position_company_key
  unique nulls not distinct (tender_id, position_code, is_alternate, company_id);

-- SECURITY DEFINER: a policy on tender_requirements can't query
-- tender_requirements itself (infinite recursion).
create or replace function tt_has_own_requirements(p_tender uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from tender_requirements r
                 where r.tender_id = p_tender and r.company_id is not null and is_company_member(r.company_id));
$$;
revoke all on function tt_has_own_requirements(uuid) from public;
grant execute on function tt_has_own_requirements(uuid) to authenticated;

drop policy "tender_requirements readable by authenticated users" on tender_requirements;
create policy "tender_requirements readable by authenticated users" on tender_requirements
  for select to authenticated using (
    case when company_id is null then not tt_has_own_requirements(tender_id)
         else is_company_member(company_id) end
    and exists (select 1 from tenders t where t.id = tender_id
                and (t.owner_company_id is null or is_company_member(t.owner_company_id))));

-- ---------------------------------------------------------------------------
-- 3. Storage
-- ---------------------------------------------------------------------------
drop policy "tender-documents: members working on the tender can upload" on storage.objects;

-- An object in a <tender_id>/<template type>/ folder is readable only when it
-- is a shared row's file or the caller's own company's copy. Everything else
-- there - a company's pre-0045 upload, every version a company replaced -
-- was one company's file and stays hidden. Other paths: unaffected.
create or replace function tt_template_object_readable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((storage.foldername(p_name))[2], '') not in
           ('technical_xlsm', 'financial_xlsm', 'c111_form_of_offer', 'c123_contract_data', 'a_forms')
      or exists (select 1 from tender_documents d
                 where d.storage_path = p_name
                   and (d.company_id is null or is_company_member(d.company_id)));
$$;
revoke all on function tt_template_object_readable(text) from public;
grant execute on function tt_template_object_readable(text) to authenticated;

drop policy "tender-documents: readable by authenticated users" on storage.objects;
create policy "tender-documents: readable by authenticated users" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'tender-documents'
    and case when (storage.foldername(name))[1] in ('manual', 'private')
             then is_company_member(((storage.foldername(name))[2])::uuid)
             else tender_folder_readable((storage.foldername(name))[1])
                  and tt_template_object_readable(name) end
  );

-- ---------------------------------------------------------------------------
-- 4. record_tender_document(): the caller's own copy only
-- ---------------------------------------------------------------------------
create or replace function record_tender_document(
  p_tender_id uuid, p_doc_type text, p_storage_path text, p_original_filename text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_id uuid;
begin
  if not exists (select 1 from tenders t where t.id = p_tender_id
                 and (t.owner_company_id is null or is_company_member(t.owner_company_id))) then
    raise exception 'tender not found' using errcode = 'P0002';
  end if;
  if p_doc_type not in ('technical_xlsm', 'financial_xlsm', 'c111_form_of_offer', 'c123_contract_data', 'a_forms') then
    raise exception 'Unknown template type: %', p_doc_type using errcode = '22023';
  end if;
  -- private/<company>/<tender>/templates/<doc_type>/<file>: the company is the
  -- one named in the path (so a member of two companies records it for the
  -- right one), and the caller must be its member.
  if split_part(p_storage_path, '/', 1) <> 'private'
     or split_part(p_storage_path, '/', 3) <> p_tender_id::text
     or split_part(p_storage_path, '/', 4) <> 'templates'
     or split_part(p_storage_path, '/', 5) <> p_doc_type
     or split_part(p_storage_path, '/', 6) = ''
     or p_storage_path like '%..%' or p_storage_path like '%//%'
     or split_part(p_storage_path, '/', 2) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'The file must be stored under your company''s own private/<company>/%/templates/%/ folder.', p_tender_id, p_doc_type
      using errcode = '42501';
  end if;
  v_company := split_part(p_storage_path, '/', 2)::uuid;
  if not is_company_member(v_company) then
    raise exception 'The file must be stored under your company''s own folder.' using errcode = '42501';
  end if;
  if not exists (select 1 from tender_packs tp where tp.tender_id = p_tender_id and tp.company_id = v_company) then
    raise exception 'Start a pack for this tender before uploading its templates.' using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'tender-documents' and o.name = p_storage_path) then
    raise exception 'Uploaded file not found in storage.' using errcode = '22023';
  end if;

  insert into tender_documents (tender_id, doc_type, company_id, storage_path, downloaded_at,
                                uploaded_by, uploaded_by_company, original_filename)
  values (p_tender_id, p_doc_type, v_company, p_storage_path, now(), auth.uid(), v_company, p_original_filename)
  on conflict (tender_id, doc_type, company_id) do update
    set storage_path = excluded.storage_path,
        downloaded_at = excluded.downloaded_at,
        uploaded_by = excluded.uploaded_by,
        uploaded_by_company = excluded.uploaded_by_company,
        original_filename = excluded.original_filename
  returning id into v_id;

  -- A new Technical workbook may list different positions: the pack bridge
  -- re-reads this company's SETUP sheet (process_pack_jobs
  -- sync_tender_requirements). Other companies' positions are not touched.
  if p_doc_type = 'technical_xlsm' then
    delete from tender_requirements where tender_id = p_tender_id and company_id = v_company;
  end if;

  return v_id;
end;
$$;
comment on function record_tender_document(uuid, text, text, text) is
  'Tender Workspace template upload (0025, 0045): registers the caller''s company''s OWN copy of a blank template, uploaded to tender-documents/private/<company>/<tender>/templates/<doc_type>/. Never touches the shared (buyer-published) copy or another company''s. Replacing the Technical workbook clears this company''s positions so the bridge re-reads its SETUP sheet.';
revoke all on function record_tender_document(uuid, text, text, text) from public;
grant execute on function record_tender_document(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. tender_document_uploads(): what the templates card shows
-- ---------------------------------------------------------------------------
drop function tender_document_uploads(uuid);
create function tender_document_uploads(p_tender_id uuid)
returns table (doc_type text, downloaded_at timestamptz, source text, uploaded_by uuid, original_filename text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Per type: the caller's own copy if it has one (that is what its pack
  -- uses), else the shared one from the buyer's published documents.
  select distinct on (d.doc_type)
         d.doc_type, d.downloaded_at,
         case when d.company_id is null then 'buyer' else 'own' end,
         d.uploaded_by, d.original_filename
  from tender_documents d
  join tenders t on t.id = d.tender_id
  where d.tender_id = p_tender_id
    and (t.owner_company_id is null or is_company_member(t.owner_company_id))
    and (d.company_id is null or is_company_member(d.company_id))
  order by d.doc_type, d.company_id nulls last;
$$;
comment on function tender_document_uploads(uuid) is
  'The blank templates the caller''s company''s pack will use for a tender: its own uploaded copy per type (source ''own''), else the shared copy from the buyer''s published documents (source ''buyer''). Never another company''s. 0043, 0045.';
revoke all on function tender_document_uploads(uuid) from public;
grant execute on function tender_document_uploads(uuid) to authenticated;
