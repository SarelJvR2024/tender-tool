-- Finding 206 (standing solution-architect review, 2026-11-08): the
-- 'tender-documents' bucket's OWN storage.objects RLS policies for its
-- manual/<company_id>/<tender_id>/... (0024) and private/<company_id>/
-- <tender_id>/... (0032) path prefixes check only is_company_member(...),
-- never is_employee_in_company(...) - the identical "a client-reachable
-- write path re-implements a table's own check and forgets the role
-- exclusion" shape PR #176/#182/#185/#186/#187 already found and fixed
-- across every public-schema SECURITY DEFINER function and RESTRICTIVE
-- table policy, but storage.objects is governed by its OWN RLS policies,
-- in the `storage` schema, which none of those prior sweeps ever walked
-- (they all enumerated `pg_policies where schemaname = 'public'`).
--
-- Verified live in a scratch Postgres, red then green (full transcript in
-- docs/specs/QA-Edge-Case-Findings.md Finding 206 / docs/specs/
-- System-Status.md): an employee-role member, using nothing but their own
-- company id (trivially their own) and ANY tender id - storage.objects has
-- no foreign key to `tenders`, so a made-up uuid works exactly as well as a
-- real one - could, straight from the browser's own `supabase.storage`
-- client (no server-side RPC involved at all):
--   * INSERT a brand-new file under their own company's manual/ or
--     private/ prefix for any tender id, real or invented;
--   * SELECT (list/read/download via a signed URL) every real file a
--     teammate already uploaded there, including a real "your private
--     documents" bid document only that company's owner/admin/member
--     should ever see;
--   * DELETE any of those same real files outright.
-- All three succeeded even though the row that is SUPPOSED to track
-- exactly this access - tender_private_documents (0032, employee-excluded
-- by 0077's own RESTRICTIVE policy) for the private/ case, and tenders/
-- tender_packs (0077, same RESTRICTIVE treatment) for the manual/ case -
-- is already correctly, completely unreachable for 'employee' at the table
-- level. The table-level fix for this exact feature is airtight; the
-- storage-level path around it, reachable with no table read and no RPC at
-- all, was wide open the entire time.
--
-- Fix: three new RESTRICTIVE policies, scoped to just this bucket and just
-- these two path prefixes, narrowing SELECT/INSERT/DELETE for 'employee' -
-- additive only, exactly 0077's own convention. is_employee_in_company()
-- is false for owner/admin/member, so every one of these ANDs away to
-- "true" (no-op) for them; their access is completely unchanged. Not
-- applied to any other folder under this bucket (the shared-tender
-- template folders governed by tender_folder_readable()/
-- tt_template_object_readable() are a deliberately different, company-
-- independent read visibility rule - untouched here, out of scope for this
-- fix).
create policy "tender-documents: employee excluded, select" on storage.objects
  as restrictive for select to authenticated
  using (
    not (
      bucket_id = 'tender-documents'
      and (storage.foldername(name))[1] in ('manual', 'private')
      and is_employee_in_company(((storage.foldername(name))[2])::uuid)
    )
  );

create policy "tender-documents: employee excluded, insert" on storage.objects
  as restrictive for insert to authenticated
  with check (
    not (
      bucket_id = 'tender-documents'
      and (storage.foldername(name))[1] in ('manual', 'private')
      and is_employee_in_company(((storage.foldername(name))[2])::uuid)
    )
  );

create policy "tender-documents: employee excluded, delete" on storage.objects
  as restrictive for delete to authenticated
  using (
    not (
      bucket_id = 'tender-documents'
      and (storage.foldername(name))[1] in ('manual', 'private')
      and is_employee_in_company(((storage.foldername(name))[2])::uuid)
    )
  );
