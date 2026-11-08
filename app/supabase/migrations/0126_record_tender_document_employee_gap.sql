-- Standing review finding, 2026-11-08 (the catalog-driven SECURITY DEFINER
-- sweep the two immediately preceding passes' own write-ups named as the
-- next angle: cross-check every `prosecdef = true` function in `public`
-- against `pg_policies` for a RESTRICTIVE `is_employee_in_company()`-shaped
-- policy on a table its own body touches, not just the ones a prior pass
-- happened to read by hand).
--
-- Built the catalog with:
--   select p.proname from pg_proc p join pg_namespace n on n.oid =
--   p.pronamespace where n.nspname = 'public' and p.prosecdef = true;
-- -> 74 functions. Cross-referenced against:
--   select tablename, policyname, qual from pg_policies where
--   schemaname = 'public' and permissive = 'RESTRICTIVE';
-- -> 45 policies on 42 tables, all `is_employee_in_company()`- or
-- `own_linked_person_id()`-shaped (0077/0117/0118). Read every one of the
-- 74 functions' own body (`pg_get_functiondef`) for which of those 42
-- tables it actually SELECTs/INSERTs/UPDATEs/DELETEs, then for each hit,
-- whether the body itself re-checks role. 71 of 74 came back clean -
-- already fixed (0119/PR #176's 12, 0121/PR #182's 2, the `tt_*`/`is_*`/
-- `own_linked_person_id` RLS-predicate helpers that only ever return a
-- boolean, every `platform_admin_*` function gated by `is_platform_admin()`,
-- and the handful whose own GRANT is `service_role` only - confirmed by
-- `information_schema.routine_privileges` - so not reachable by an
-- authenticated session at all, e.g. `company_notification_recipients()`,
-- `lifecycle_unsubscribe_token_for()`) - or already named as open findings
-- (`apply_cv_extraction_checked()`/`apply_my_cv_extraction_checked()`,
-- PR #186/Finding 204, left untouched per the standing guardrails).
--
-- The one genuine, previously-undocumented gap: record_tender_document()
-- (0025, narrowed 0032/0043/0045 for cross-tenant integrity, never once for
-- 0077's employee role). It reads `tenders` and `tender_packs` - both
-- carry an 0077/0032 RESTRICTIVE "employee has no access" (ALL operations)
-- policy - and writes `tender_documents` and conditionally DELETEs
-- `tender_requirements`, the live SETUP-sheet position list a technical
-- workbook replacement re-derives from. It checked only
-- `is_company_member(v_company)` on the uploading company, never role -
-- the identical shape 0119/0121/0125 each already fixed elsewhere, just
-- never checked against THIS function. Tender Workspace (where this RPC's
-- only real caller, `uploadTenderTemplate()` in
-- app/app/tenders/[id]/pack-inputs-actions.ts, lives) is not one of an
-- employee's two allowed pages at all (nav-items.ts's own
-- EMPLOYEE_NAV_ITEMS: Home + My CV only) - the same "block outright" shape
-- apply_cv_extraction_checked() and 10 of 0119's own 12 functions use, not
-- the narrower "only your own row" shape apply_my_cv_extraction_checked()
-- needed.
--
-- Reproduced directly in a disposable scratch Postgres
-- (engine/security/replay_schema.sh against all 123 prior migrations on
-- `main`, never the live DB - dropped and the service stopped immediately
-- after use). One company, one 'owner' member, one 'employee' member
-- (same company), one manually-loaded tender owned by that company, one
-- tender_packs row for it (status 'suggested', created by the owner before
-- this fix existed to test), one tender_requirements row (the real,
-- company-confirmed Project Leader position), one storage.objects row
-- simulating a file the employee uploaded themselves to
-- private/<company>/<tender>/templates/technical_xlsm/ (storage's own
-- "members upload private documents" policy, 0032, checks only
-- is_company_member() too - a separate, not-yet-covered angle logged in
-- docs/specs/System-Status.md rather than fixed here, since storage.objects
-- is a different schema from the 42-table RESTRICTIVE sweep this migration
-- is scoped to).
--
-- Pre-fix, acting as the employee (set role authenticated; select
-- set_config('test.uid', '<employee uuid>', true)):
--   * `select count(*) from tenders` and `select count(*) from
--     tender_packs` both returned 0 - RLS genuinely blocks this employee
--     from either table directly, confirming the RESTRICTIVE policies are
--     live and the bypass below is the SECURITY DEFINER function's own
--     doing, not a misconfigured policy.
--   * `select record_tender_document(<tender_id>, 'technical_xlsm',
--     '<the employee's own uploaded path>', 'evil.xlsm')` -> SUCCEEDED,
--     returning a new tender_documents.id.
--   * A follow-up superuser read confirmed a real tender_documents row now
--     existed (uploaded_by = the employee's own uid) AND the real
--     tender_requirements row (the company's actual confirmed Project
--     Leader position) had been DELETED by the function's own
--     `technical_xlsm` replacement branch - an employee with zero RLS
--     visibility into tenders or tender_packs at all had just overwritten
--     this company's live SANRAL submission data and destroyed its
--     requirement list.
--
-- Fixed the same additive-only, narrow-only, "block outright" shape 0119's
-- own 12 functions and apply_cv_extraction_checked() (0125) use: one new
-- guard right after the existing `is_company_member(v_company)` check
-- (the point the function already resolves which company is acting), using
-- the SAME v_company variable so it fires for the uploading company
-- regardless of whether the tender itself is shared (owner_company_id
-- null) or exclusively owned. Owner/admin/member callers are completely
-- unaffected (is_employee_in_company() is false for them, same as every
-- other migration in this family).
--
-- Verified green myself, same scratch database, re-running the exact same
-- call after this migration: the employee's call now raises "Tender
-- Workspace templates are managed by your company's owner, admin or
-- member - not the employee role." (42501) before touching
-- tender_documents or tender_requirements at all. A follow-up superuser
-- read confirmed both tables unchanged (the real tender_requirements row
-- still present). The owner calling the identical RPC for the same
-- company/tender/path still succeeds unchanged (new tender_documents row
-- inserted, tender_requirements correctly re-synced).

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
  -- 2026-11-08 (standing review, catalog-driven SECURITY DEFINER sweep):
  -- Tender Workspace - and this RPC with it - is not one of an employee's
  -- two allowed pages at all (nav-items.ts's own EMPLOYEE_NAV_ITEMS: Home +
  -- My CV only). Checked here, not left to RLS alone, because this
  -- function writes tender_documents and conditionally deletes
  -- tender_requirements by company id, never reading either back through a
  -- policy that could have hidden the row first.
  if is_employee_in_company(v_company) then
    raise exception 'Tender Workspace templates are managed by your company''s owner, admin or member - not the employee role.' using errcode = '42501';
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
  'Tender Workspace template upload (0025, 0045, 0126): registers the caller''s company''s OWN copy of a blank template, uploaded to tender-documents/private/<company>/<tender>/templates/<doc_type>/. Never touches the shared (buyer-published) copy or another company''s. Replacing the Technical workbook clears this company''s positions so the bridge re-reads its SETUP sheet. 0126: rejects an employee-role caller outright (this role has no Tender Workspace access at all).';
