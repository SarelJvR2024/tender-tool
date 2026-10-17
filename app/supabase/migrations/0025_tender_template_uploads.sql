-- Upload the tender's blank SANRAL templates from the Tender Workspace.
--
-- tender_documents (0001) has always held the storage path of each blank
-- template the SANRAL engines fill (Technical/Financial workbooks, A-Forms,
-- C.1.1.1, C.1.2.3), and 0017 gave it a bucket ('tender-documents'), but both
-- were service-role-write-only and nothing wrote them: the submission pack
-- card hard-stopped on "blank templates not uploaded" for every tender.
-- SANRAL's download form is reCAPTCHA-gated (playbook section 1a), so the
-- files are downloaded by a person and uploaded here - this migration lets a
-- signed-in member do that upload, and nothing more.
--
-- Still shared/public data, as 0001 intended ("uploaded once per tender, not
-- once per company"): the templates are SANRAL's own boilerplate. What is new
-- is WHO may supply them: a member of a company that is working on the
-- tender (has a tender_packs row for it). Recorded per row, for audit.

alter table tender_documents
  add column uploaded_by uuid references auth.users(id),
  add column uploaded_by_company uuid references companies(id) on delete set null,
  add column original_filename text;

comment on column tender_documents.uploaded_by_company is
  'Company whose member uploaded this template (Tender Workspace). Null for rows written by the service role.';

-- Storage: "<tender_id>/<doc_type>/<uuid>-<filename>" in 'tender-documents'.
-- Insert only - no client update/delete, so an upload never overwrites or
-- removes a file another company's pack was built from; replacing a template
-- uploads a new object and repoints the row (record_tender_document below).
-- The folder is compared as text, so a malformed path is simply refused
-- rather than raising a uuid cast error.
create policy "tender-documents: members working on the tender can upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'tender-documents'
    and exists (
      select 1 from tender_packs tp
      where tp.tender_id::text = (storage.foldername(name))[1]
        and is_company_member(tp.company_id)
    )
  );

-- Records (or repoints) the tender_documents row once the file is in Storage.
-- SECURITY DEFINER because tender_documents stays client-read-only; every
-- check a policy would make is made here first, in the same pattern as
-- pursue_discovered_opportunity() (0018).
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

  -- A replaced Technical workbook may list different positions: let the pack
  -- bridge re-read SETUP (engine/pack/process_pack_jobs.py
  -- sync_tender_requirements only fills tenders with no rows).
  if p_doc_type = 'technical_xlsm' then
    delete from tender_requirements where tender_id = p_tender_id;
  end if;

  return v_id;
end;
$$;
comment on function record_tender_document(uuid, text, text, text) is
  'Tender Workspace template upload: a member of a company with a tender_pack for this tender records the blank template it just uploaded to the tender-documents bucket (path "<tender_id>/<doc_type>/..."). Upserts tender_documents by (tender_id, doc_type). Replacing the Technical workbook clears tender_requirements so the pack bridge re-reads its SETUP sheet.';

revoke all on function record_tender_document(uuid, text, text, text) from public;
grant execute on function record_tender_document(uuid, text, text, text) to authenticated;
