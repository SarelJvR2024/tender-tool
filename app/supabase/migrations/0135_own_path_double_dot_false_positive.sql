-- Fix: the "storage path must sit under the row's own company folder" checks
-- (0043 tt_own_path, 0050 tt_path_in_company, 0045 record_tender_document(),
-- 0024 _manual_tender_documents(), 0032 tender_private_documents_path) all
-- reject a path with the SUBSTRING ".." anywhere in it, not just a real
-- ".." path-traversal SEGMENT. Finding 35 (2026-10-20) found and fixed the
-- identical bug in engine/onboarding/process_onboarding_jobs.py's own inline
-- Python check ("Report..final.pdf", an entirely ordinary filename with two
-- consecutive dots, was rejected as "isn't in your company's own storage
-- folder") - but that fix was never swept to any of the five SQL sites
-- above, which share the exact same substring bug and sit in front of the
-- Python check at the DATABASE level: app/lib/safeFileName.ts (the one
-- shared sanitizer every upload path in this app uses, including
-- app/app/_components/document-intake/uploadBatch.ts, the shared uploader
-- document-scan's own upload-form.tsx calls) keeps '.' in its allowed
-- character set, so an ordinary file like "Report..Final.pdf" produces a
-- storage_path containing the literal substring "..". For cv_uploads,
-- generated_cvs, experience_items, company_document_templates,
-- generated_documents, pack_generation_jobs, the companies vault/logo
-- columns, company_principals (certified ID / disability proof),
-- held_registrations, property_documents and onboarding_uploads itself, the
-- browser INSERTs the row directly (RLS, not the service role) - so this
-- CHECK CONSTRAINT rejects the INSERT with a raw "violates check
-- constraint" error before engine/*/process_*_jobs.py's own, already-correct
-- (for onboarding) Python-side check is ever reached. Confirmed live in a
-- fresh scratch Postgres (113 migrations, no fix): inserting a cv_uploads
-- row with storage_path '<company>/people/<person>/uploads/<uuid>-Report..
-- Final.pdf' - the exact shape engine/cv/process_cv_jobs.py's own path
-- convention and safeFileName() together produce for a real file named
-- "Report..Final.pdf" - raised "violates check constraint
-- cv_uploads_path_own_folder" and inserted nothing. The identical shape
-- hits tender_private_documents_path (a company's own document on a shared
-- tender), record_tender_document() (SANRAL template upload - currently
-- only reachable via a random uuid filename, so not live-triggerable today,
-- but wrong on its own terms and worth fixing alongside its four true
-- siblings rather than left to rot), _manual_tender_documents() (loading a
-- tender from a client-forwarded document whose own filename has two dots),
-- and onboarding_uploads itself - meaning Finding 35's own fix never
-- actually reached a real browser upload at all: the row insert this
-- function's caller (app/app/company/document-scan/actions.ts) does BEFORE
-- process_onboarding_jobs.py ever claims the row would already have failed
-- with this same check constraint. Standing review, 2026-11-08.
--
-- Fix: every substring check ("... like '%..%'" / "... not like '%..%'")
-- below is replaced with a path-SEGMENT check - a POSIX regex requiring the
-- ".." to be an entire path segment, bounded by "/" or the start/end of the
-- string ('(^|/)\.\.(/|$)') - the SQL equivalent of the already-correct,
-- already-shipped Python fix (engine/onboarding/process_onboarding_jobs.py:
-- '".." in sp.split("/")'). A genuine traversal ("co1/../co2/x.pdf",
-- "co1/abc/..", "../co1/x.pdf") still matches and is still rejected; a
-- filename that merely CONTAINS ".." without it being a whole segment
-- ("Report..Final.pdf", "..hidden.pdf") no longer does. Confirmed directly
-- against all three shapes before writing this migration (see this pass's
-- own docs/specs/System-Status.md entry for the exact psql output). The "//"
-- double-slash check is untouched everywhere (no demonstrated false-positive
-- risk from it - same "fix only what's actually reproduced" discipline
-- Finding 35 itself used).

-- ---------------------------------------------------------------------------
-- 1. tt_own_path() (0043) - companies (7 cols), cv_uploads, generated_cvs
--    (2 cols), experience_items, company_document_templates,
--    generated_documents, pack_generation_jobs. No DDL needed on any of
--    those tables: redefining the function changes every CHECK that calls
--    it immediately, for every future write.
-- ---------------------------------------------------------------------------
create or replace function tt_own_path(p_path text, p_company uuid)
returns boolean
language sql
immutable
as $$
  select p_path is null
      or (p_path like p_company::text || '/%' and p_path !~ '(^|/)\.\.(/|$)' and p_path not like '%//%');
$$;

-- ---------------------------------------------------------------------------
-- 2. tt_path_in_company() (0050) - company_principals (certified_id_path +
--    disability_proof_path), held_registrations, property_documents, and
--    onboarding_uploads (0063, reuses this same function). Same reasoning:
--    redefining it fixes every CHECK that calls it.
-- ---------------------------------------------------------------------------
create or replace function tt_path_in_company(p_path text, p_company uuid)
returns boolean
language sql
immutable
as $$
  select p_path is null
      or (p_path like p_company::text || '/%' and p_path !~ '(^|/)\.\.(/|$)' and p_path not like '%//%');
$$;

-- ---------------------------------------------------------------------------
-- 3. tender_private_documents_path (0032) - a literal CHECK constraint on
--    the table, not a function call, so it needs its own DROP + ADD.
-- ---------------------------------------------------------------------------
alter table tender_private_documents drop constraint tender_private_documents_path;
alter table tender_private_documents add constraint tender_private_documents_path check (
  storage_path like 'private/' || company_id::text || '/' || tender_id::text || '/%'
  and storage_path !~ '(^|/)\.\.(/|$)'
);

-- ---------------------------------------------------------------------------
-- 4. record_tender_document() (current body: 0045) - its own inline check,
--    not tt_own_path. Body otherwise unchanged from 0045's own definition.
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
     or p_storage_path ~ '(^|/)\.\.(/|$)' or p_storage_path like '%//%'
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
  'Tender Workspace template upload (0025, 0045, 0135): registers the caller''s company''s OWN copy of a blank template, uploaded to tender-documents/private/<company>/<tender>/templates/<doc_type>/. Never touches the shared (buyer-published) copy or another company''s. Replacing the Technical workbook clears this company''s positions so the bridge re-reads its SETUP sheet.';

-- ---------------------------------------------------------------------------
-- 5. _manual_tender_documents() (0024) - never redefined since.
-- ---------------------------------------------------------------------------
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
    if coalesce(d ->> 'storage_path', '') not like prefix || '%' or (d ->> 'storage_path') ~ '(^|/)\.\.(/|$)' then
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
