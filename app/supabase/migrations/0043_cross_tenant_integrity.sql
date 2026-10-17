-- Cross-tenant integrity (POPIA / "no data visible between customers" audit,
-- Sarel 2026-10-17). Full write-up: docs/specs/POPIA-Security-Audit.md.
-- Reproduced before and shown closed after by
-- engine/security/test_tenant_isolation.py (Part 2 runs on a replay of every
-- migration).
--
-- RLS itself was found correct table by table: every table has it enabled,
-- every tenant table is scoped with is_company_member(), and a member of one
-- company can't read, change, delete or insert another company's rows. The
-- holes were one level down, in what a row is allowed to POINT AT:
--
-- 1. Cross-company references. RLS checks the row's own company_id, never the
--    company of a person / pack the row references. So a member of company A
--    could write (with B's people.id - not a secret: a former employee of B,
--    a URL in a screenshot or an e-mail is enough):
--      tender_pack_assignments.confirmed_person_id = B's person
--      generated_cvs.person_id = B's person
--      projects / cv_uploads.person_id = B's person
--      pack_generation_jobs.tender_pack_id = B's pack
--    and the service-role bridges (which bypass RLS by design) then read B's
--    person - ID number, phone, qualifications, projects, CV file - into A's
--    submission pack or CV, in A's own storage folder. In the other
--    direction an as-is CV or project A attached to B's person was picked up
--    by B's OWN pack. Now a trigger on every such column refuses a reference
--    outside the row's company, for every writer including the service role.
--    Also: a company's per-tender rows (tasks, answers, jobs, CVs...) may only
--    be on a tender it can see - shared, or its own private one.
--
-- 2. Storage paths. Several *_path columns are written by the client and later
--    downloaded by a bridge with the service-role key: the companies vault
--    columns and logo, cv_uploads, generated_cvs, experience_items,
--    company_document_templates, generated_documents, pack_generation_jobs.
--    A row pointing at "<B's company id>/..." made the bridge copy B's file
--    into A's pack / CV extraction. Storage RLS can't help: the bridge isn't
--    subject to it. Each column now has to sit under the row's own company
--    folder (same rule 0018 tender_answers and 0032 tender_private_documents
--    already had). NOT VALID first so a stray legacy row can't block the
--    deploy; validated straight after where the data allows (a warning names
--    the constraint otherwise).
--
-- 3. Shared SANRAL templates (0025). Any company with a pack on a SHARED
--    tender could replace the blank template another company had uploaded -
--    and replacing the Technical workbook deletes the tender's positions for
--    everyone. A company may now replace only a template its own members
--    uploaded (or any template on its own private tender); the first copy
--    stays shared as 0001/0025 intended.
--
-- 4. Admin console (0005/0022). "Owner of any company" was the admin proxy -
--    but every customer who onboards is the owner of their own company, so
--    every customer could read Sarel's internal harness results and
--    documents and mark runs reviewed. Now a separate platform_admins list
--    (service-role managed - Sarel adds his own user id once, see the audit
--    doc).
--
-- 5. Hardening: is_company_member() (0001) is SECURITY DEFINER without a
--    fixed search_path; every SECURITY DEFINER function now pins
--    search_path = public, pg_temp (pg_temp last, so a session temp table
--    can't shadow company_members).

-- ---------------------------------------------------------------------------
-- 5. search_path hardening (first: the triggers below call these)
-- ---------------------------------------------------------------------------
alter function is_company_member(uuid) set search_path = public, pg_temp;
alter function create_company_and_join(text) set search_path = public, pg_temp;
alter function pursue_discovered_opportunity(uuid) set search_path = public, pg_temp;
alter function load_manual_tender(uuid, uuid, text, text, text, text, timestamptz, jsonb) set search_path = public, pg_temp;
alter function add_manual_tender_documents(uuid, jsonb) set search_path = public, pg_temp;
alter function tender_folder_readable(text) set search_path = public, pg_temp;
alter function company_member_labels() set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. Cross-company references
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: the answer must be the truth, not "what the caller's RLS
-- happens to show" (the caller can't see the other company's rows, which is
-- exactly why an RLS-based check would be unreliable for the service role).
create or replace function tt_person_in_company(p_person uuid, p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_person is null
      or exists (select 1 from people where id = p_person and company_id = p_company);
$$;

create or replace function tt_pack_company(p_pack uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select company_id from tender_packs where id = p_pack;
$$;

-- A per-company row may only be on a tender that company can see: shared
-- (owner_company_id null) or its own private one (0024).
create or replace function tt_tender_visible_to(p_tender uuid, p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_tender is null
      or exists (select 1 from tenders where id = p_tender
                 and (owner_company_id is null or owner_company_id = p_company));
$$;

revoke all on function tt_person_in_company(uuid, uuid) from public;
revoke all on function tt_pack_company(uuid) from public;
revoke all on function tt_tender_visible_to(uuid, uuid) from public;

create or replace function tt_check_same_company()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
begin
  if tg_table_name = 'tender_pack_assignments' then
    v_company := tt_pack_company(new.tender_pack_id);
    -- Only a value being written is checked: when a person is deleted, 0044's
    -- ON DELETE SET NULL clears one column while the other may still name the
    -- (already deleted) person for a moment.
    if tg_op = 'INSERT' or new.tender_pack_id is distinct from old.tender_pack_id
       or new.suggested_person_id is distinct from old.suggested_person_id then
      if not tt_person_in_company(new.suggested_person_id, v_company) then
        raise exception 'tender_pack_assignments: the person must belong to the same company as the tender pack'
          using errcode = '23514';
      end if;
    end if;
    if tg_op = 'INSERT' or new.tender_pack_id is distinct from old.tender_pack_id
       or new.confirmed_person_id is distinct from old.confirmed_person_id then
      if not tt_person_in_company(new.confirmed_person_id, v_company) then
        raise exception 'tender_pack_assignments: the person must belong to the same company as the tender pack'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  v_company := new.company_id;

  -- Nested IFs on purpose: an expression naming new.<column> fails on a
  -- table without that column, and SQL doesn't promise to short-circuit AND.
  if tg_table_name in ('projects', 'cv_uploads', 'generated_cvs', 'cv_extraction_results', 'person_role_eligibility') then
    if not tt_person_in_company(new.person_id, v_company) then
      raise exception '%: person_id must be a person in the same company', tg_table_name using errcode = '23514';
    end if;
  end if;

  if tg_table_name = 'tender_tasks' then
    if not tt_person_in_company(new.assigned_to, v_company) then
      raise exception 'tender_tasks: assigned_to must be a person in the same company' using errcode = '23514';
    end if;
  end if;

  if tg_table_name = 'cv_extraction_results' then
    if not exists (select 1 from cv_uploads u where u.id = new.cv_upload_id
                   and u.company_id = v_company and u.person_id = new.person_id) then
      raise exception 'cv_extraction_results: the CV upload must be this company''s upload for this person' using errcode = '23514';
    end if;
  end if;

  if tg_table_name in ('generated_cvs', 'pack_generation_jobs') then
    if new.tender_pack_id is not null then
      if not exists (select 1 from tender_packs tp where tp.id = new.tender_pack_id
                     and tp.company_id = v_company and tp.tender_id = new.tender_id) then
        raise exception '%: tender_pack_id must be this company''s pack for this tender', tg_table_name using errcode = '23514';
      end if;
    end if;
  end if;

  if tg_table_name in ('tender_packs', 'tender_tasks', 'tender_answers', 'financial_captures', 'generated_documents',
                       'generated_cvs', 'pack_generation_jobs', 'tender_comments', 'tender_private_documents') then
    if not tt_tender_visible_to(new.tender_id, v_company) then
      raise exception '%: this tender is another company''s private tender', tg_table_name using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger tt_same_company before insert or update of tender_pack_id, suggested_person_id, confirmed_person_id
  on tender_pack_assignments for each row execute function tt_check_same_company();
create trigger tt_same_company before insert or update of company_id, person_id on projects
  for each row execute function tt_check_same_company();
create trigger tt_same_company before insert or update of company_id, person_id on cv_uploads
  for each row execute function tt_check_same_company();
create trigger tt_same_company before insert or update of company_id, person_id, tender_id, tender_pack_id on generated_cvs
  for each row execute function tt_check_same_company();
create trigger tt_same_company before insert or update of company_id, person_id, cv_upload_id on cv_extraction_results
  for each row execute function tt_check_same_company();
create trigger tt_same_company before insert or update of company_id, person_id on person_role_eligibility
  for each row execute function tt_check_same_company();
create trigger tt_same_company before insert or update of company_id, tender_id, assigned_to on tender_tasks
  for each row execute function tt_check_same_company();
create trigger tt_same_company before insert or update of company_id, tender_id, tender_pack_id on pack_generation_jobs
  for each row execute function tt_check_same_company();
create trigger tt_same_company before insert or update of company_id, tender_id on tender_packs
  for each row execute function tt_check_same_company();
create trigger tt_same_company before insert or update of company_id, tender_id on tender_answers
  for each row execute function tt_check_same_company();
create trigger tt_same_company before insert or update of company_id, tender_id on financial_captures
  for each row execute function tt_check_same_company();
create trigger tt_same_company before insert or update of company_id, tender_id on generated_documents
  for each row execute function tt_check_same_company();
create trigger tt_same_company before insert or update of company_id, tender_id on tender_comments
  for each row execute function tt_check_same_company();
create trigger tt_same_company before insert or update of company_id, tender_id on tender_private_documents
  for each row execute function tt_check_same_company();

-- ---------------------------------------------------------------------------
-- 2. Storage paths under the row's own company folder
-- ---------------------------------------------------------------------------
create or replace function tt_own_path(p_path text, p_company uuid)
returns boolean
language sql
immutable
as $$
  select p_path is null
      or (p_path like p_company::text || '/%' and p_path not like '%..%' and p_path not like '%//%');
$$;

alter table companies add constraint companies_paths_own_folder check (
  tt_own_path(logo_storage_path, id) and tt_own_path(coid_letter_document_path, id)
  and tt_own_path(sars_tcs_pin_document_path, id) and tt_own_path(pi_insurance_document_path, id)
  and tt_own_path(iso_9001_document_path, id) and tt_own_path(bank_confirmation_letter_path, id)
  and tt_own_path(bee_proof_document_path, id)) not valid;
alter table cv_uploads add constraint cv_uploads_path_own_folder
  check (tt_own_path(storage_path, company_id)) not valid;
alter table generated_cvs add constraint generated_cvs_paths_own_folder
  check (tt_own_path(storage_path_docx, company_id) and tt_own_path(storage_path_pdf, company_id)) not valid;
alter table experience_items add constraint experience_items_path_own_folder
  check (tt_own_path(storage_path, company_id)) not valid;
alter table company_document_templates add constraint company_document_templates_path_own_folder
  check (tt_own_path(storage_path, company_id)) not valid;
alter table generated_documents add constraint generated_documents_path_own_folder
  check (tt_own_path(storage_path, company_id)) not valid;
alter table pack_generation_jobs add constraint pack_generation_jobs_path_own_folder
  check (tt_own_path(storage_path_pdf, company_id)) not valid;

do $$
declare
  c record;
begin
  for c in select conrelid::regclass::text as tbl, conname from pg_constraint
           where conname in ('companies_paths_own_folder', 'cv_uploads_path_own_folder', 'generated_cvs_paths_own_folder',
                             'experience_items_path_own_folder', 'company_document_templates_path_own_folder',
                             'generated_documents_path_own_folder', 'pack_generation_jobs_path_own_folder') loop
    begin
      execute format('alter table %s validate constraint %I', c.tbl, c.conname);
    exception when check_violation then
      raise warning '0043: % has existing rows with a storage path outside their own company folder - constraint % stays NOT VALID (new writes are still checked). Review those rows: see docs/specs/POPIA-Security-Audit.md.', c.tbl, c.conname;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Shared SANRAL templates: replace only your own company's upload
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
  v_owner uuid;
  v_existing tender_documents%rowtype;
  v_id uuid;
begin
  select t.owner_company_id into v_owner from tenders t
  where t.id = p_tender_id and (t.owner_company_id is null or is_company_member(t.owner_company_id));
  if not found then
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
     or split_part(p_storage_path, '/', 2) <> p_doc_type
     or p_storage_path like '%..%' then
    raise exception 'The file must be stored under this tender''s own %/% folder.', p_tender_id, p_doc_type
      using errcode = '42501';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'tender-documents' and o.name = p_storage_path) then
    raise exception 'Uploaded file not found in storage.' using errcode = '22023';
  end if;

  -- 0043: on a SHARED tender the template is every pursuing company's copy.
  -- Only the company that uploaded it may replace it; one registered by the
  -- service role (the buyer's own published file, via the intake) or by
  -- another company stays. On the company's own private tender: any.
  select * into v_existing from tender_documents where tender_id = p_tender_id and doc_type = p_doc_type;
  if found and v_owner is null and v_existing.uploaded_by_company is distinct from v_company then
    raise exception 'This tender''s % template is already on file (uploaded %), and other companies working on this tender use it, so it can''t be replaced from here. If it is the wrong file, contact Tender Tool support.',
      p_doc_type, case when v_existing.uploaded_by_company is null then 'from the buyer''s published documents' else 'by another company' end
      using errcode = '42501';
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

revoke all on function record_tender_document(uuid, text, text, text) from public;
grant execute on function record_tender_document(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Platform admins (the admin console), not "owner of any company"
-- ---------------------------------------------------------------------------
create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  added_at timestamptz not null default now()
);
comment on table platform_admins is
  'Tender Tool''s own staff who may use the internal admin console (/admin: test-company harness results). Not a customer role - a company owner is NOT a platform admin. Managed only with the service role / SQL editor: insert into platform_admins (user_id, note) values (''<auth user id>'', ''Sarel'').';
alter table platform_admins enable row level security;
-- No client policy at all: nobody can list or add admins through the API.

create or replace function is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;
revoke all on function is_platform_admin() from public;
grant execute on function is_platform_admin() to authenticated;

drop policy "admin_harness_runs: owners can select" on admin_harness_runs;
create policy "admin_harness_runs: platform admins can select" on admin_harness_runs
  for select to authenticated using (is_platform_admin());

drop policy "admin_harness_runs: owners can record a review" on admin_harness_runs;
create policy "admin_harness_runs: platform admins can record a review" on admin_harness_runs
  for update to authenticated
  using (is_platform_admin())
  with check (is_platform_admin() and (reviewed_by is null or reviewed_by = auth.uid()));

drop policy "admin-harness-artifacts: owners can read" on storage.objects;
create policy "admin-harness-artifacts: platform admins can read" on storage.objects
  for select to authenticated
  using (bucket_id = 'admin-harness-artifacts' and is_platform_admin());

-- ---------------------------------------------------------------------------
-- 6. Shared templates: who uploaded them is not other companies' business
-- ---------------------------------------------------------------------------
-- tender_documents is readable by every company that can see the tender
-- (0001/0024), and since 0025 it also records WHICH company and user uploaded
-- each template and the file's original name ("Acme_R396_Technical.xlsm").
-- Tender Tool's customers bid against each other: that told every company
-- pursuing a tender that a competitor was on it too, and often which one.
-- Those three columns are now readable only through
-- tender_document_uploads(), which returns them only for the caller's own
-- company's uploads (and "another company" otherwise, nothing more).
revoke select on tender_documents from authenticated, anon;
grant select (id, tender_id, doc_type, storage_path, downloaded_at) on tender_documents to authenticated;

create or replace function tender_document_uploads(p_tender_id uuid)
returns table (doc_type text, downloaded_at timestamptz, uploaded_by_us boolean, uploaded_by_another_company boolean,
               uploaded_by uuid, original_filename text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.doc_type, d.downloaded_at,
         coalesce(is_company_member(d.uploaded_by_company), false),
         d.uploaded_by_company is not null and not coalesce(is_company_member(d.uploaded_by_company), false),
         case when coalesce(is_company_member(d.uploaded_by_company), false) then d.uploaded_by end,
         case when d.uploaded_by_company is null or is_company_member(d.uploaded_by_company) then d.original_filename end
  from tender_documents d
  join tenders t on t.id = d.tender_id
  where d.tender_id = p_tender_id
    and (t.owner_company_id is null or is_company_member(t.owner_company_id));
$$;
comment on function tender_document_uploads(uuid) is
  'The blank templates on file for a tender the caller can see, with who uploaded each - only when it was the caller''s own company (uploaded_by, original_filename); another company''s upload is just flagged. 0043.';
revoke all on function tender_document_uploads(uuid) from public;
grant execute on function tender_document_uploads(uuid) to authenticated;
