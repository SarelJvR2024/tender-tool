-- Finding 207 (standing solution-architect review, 2026-11-08): the
-- 'cv-documents' bucket's OWN storage.objects RLS policy
-- ("cv-documents: tenant isolation by path prefix", 0008_cv_uploads.sql)
-- checks only is_company_member((storage.foldername(name))[1]::uuid) - the
-- COMPANY id, never the PERSON id that is the very next path segment
-- ("<company_id>/people/<person_id>/uploads|generated/..."). It never
-- references is_employee_in_company()/own_linked_person_id() (0077) at all.
--
-- This is the identical "a client-reachable storage path re-implements a
-- table's own tenant check and forgets the finer-grained restriction" shape
-- PR #176/#182/#185/#186/#187 already found and fixed on public-schema
-- tables/functions, and PR #188 (migration 0127) already found and fixed on
-- this SAME storage schema for the 'tender-documents' bucket - but it is
-- the single most on-the-nose instance of the whole family: 0077's own
-- header comment for the 'employee' role says outright "review THEIR OWN
-- CV ... not see ... other people's records", and the table-level policies
-- backing this exact feature (cv_uploads/generated_cvs/cv_extraction_results,
-- 0077's "employee restricted to own person" RESTRICTIVE policies) already
-- enforce precisely that at the table level - but storage.objects, the
-- actual file bytes, had no person-level scoping whatsoever, only
-- company-level. PR #188's own write-up named this bucket by name as its
-- single highest-severity leftover lead, theorised but not yet reproduced
-- red/green; this migration is that reproduction and fix.
--
-- Why this is reachable, not theoretical: the real app flow
-- (app/app/my-cv/actions.ts uploadMyCv(), app/app/people/actions.ts
-- uploadCv()) always resolves personId server-side (own_linked_person_id /
-- the people-page's own route param, both already permission-checked) and
-- builds the storage path "<company_id>/people/<person_id>/uploads/<uuid>-
-- <filename>" (see people/actions.ts's own "Storage path convention"
-- comment above uploadCv()) - so the INTENDED flow never names a colleague's
-- person id. But storage.objects is reached the same way 0127's own finding
-- described: directly via the browser's own supabase.storage client
-- (upload/list/remove/createSignedUrl all map straight to the Storage REST
-- API, governed only by storage.objects' own RLS) - nothing stops a signed-in
-- employee from calling that client with a COLLEAGUE's real person id
-- substituted into the path by hand. storage.objects has no foreign key to
-- `people` at all, so even a made-up person id under their own real company
-- id works exactly as well as a colleague's real one.
--
-- Verified live in a scratch Postgres (engine/security/replay_schema.sh,
-- 113 migrations through 0123, then this file) - full transcript in
-- docs/specs/QA-Edge-Case-Findings.md Finding 207 / docs/specs/
-- System-Status.md. Seeded one company, one 'employee'-role member linked
-- to their own person (A), a second 'employee'-role member linked to a
-- different person (B) who uploaded a real CV the ordinary way. As employee
-- A, straight against storage.objects (no RPC, no table write/read):
--   RED (migrations through 0123 only): SELECT on B's real object row -
--   returned the row (readable). INSERT a brand-new object under B's own
--   "<company>/people/<B>/uploads/..." prefix - succeeded (plantable).
--   UPDATE B's real object row's own metadata - succeeded (tamperable).
--   DELETE B's real object row - `DELETE 1`, gone. All four succeeded even
--   though the identical operation against the matching `cv_uploads` TABLE
--   row for person B, as the same employee A, is correctly already refused
--   by 0077's own RESTRICTIVE policy ("new row violates row-level security
--   policy cv_uploads: employee restricted to own person") - confirming the
--   table-level control was never what was actually protecting the file
--   itself.
--   GREEN (with this migration applied): the identical SELECT returned 0
--   rows; the identical INSERT failed with "new row violates row-level
--   security policy cv-documents: employee restricted to own person,
--   insert"; the identical UPDATE matched 0 rows; the identical DELETE
--   matched 0 rows; a final superuser read confirmed B's real object was
--   completely untouched throughout. A separate owner/non-employee check on
--   the same green database confirmed an owner's own select/insert/update/
--   delete anywhere in the bucket (including a made-up person id) is
--   completely unaffected - is_employee_in_company() is false for
--   owner/admin/member, so every new RESTRICTIVE check below ANDs away to
--   "true" (a no-op) for them, exactly 0077's/0127's own convention. Also
--   confirmed employee A's own uploads (their own linked person id) are
--   completely unaffected by this fix, both before and after.
--
-- Fix: a small helper, cv_documents_path_person_id(), that safely parses
-- the "<company_id>/people/<person_id>/uploads-or-generated/<filename>"
-- convention out of an object name and returns null (never raises) for
-- anything that doesn't match it exactly - so a malformed/unexpected path
-- is denied for an employee rather than ever throwing an evaluation error
-- for an unrelated row in the same query (the (storage.foldername(name))[1]
-- ::uuid cast the pre-existing 0008 policy already does unconditionally for
-- every row in this bucket is left exactly as-is below - that invariant
-- already existed before this migration and this fix adds no new risk on
-- top of it). Then four new, additive RESTRICTIVE policies on
-- storage.objects, scoped to just this bucket, narrowing
-- SELECT/INSERT/UPDATE/DELETE for 'employee' to their own linked person's
-- path only - nothing existing is dropped or edited.
create or replace function cv_documents_path_person_id(name text)
returns uuid
language plpgsql
immutable
as $$
declare
  _folder text[];
begin
  _folder := storage.foldername(name);
  if array_length(_folder, 1) is distinct from 4 then
    return null;
  end if;
  if _folder[2] <> 'people' then
    return null;
  end if;
  return _folder[3]::uuid;
exception when others then
  return null;
end;
$$;
comment on function cv_documents_path_person_id(text) is
  'Parses the person id out of a cv-documents storage.objects name under the real "<company_id>/people/<person_id>/uploads-or-generated/<filename>" convention (0008_cv_uploads.sql). Returns null (never raises) for anything that does not match exactly, so a malformed or attacker-crafted path is denied for an employee rather than erroring the whole query for an unrelated row. Used only to narrow an employee''s storage access to their own person (0128) - never to grant access.';
revoke all on function cv_documents_path_person_id(text) from public;
grant execute on function cv_documents_path_person_id(text) to authenticated;

create policy "cv-documents: employee restricted to own person, select" on storage.objects
  as restrictive for select to authenticated
  using (
    not (
      bucket_id = 'cv-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
      and cv_documents_path_person_id(name) is distinct from own_linked_person_id((storage.foldername(name))[1]::uuid)
    )
  );

create policy "cv-documents: employee restricted to own person, insert" on storage.objects
  as restrictive for insert to authenticated
  with check (
    not (
      bucket_id = 'cv-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
      and cv_documents_path_person_id(name) is distinct from own_linked_person_id((storage.foldername(name))[1]::uuid)
    )
  );

create policy "cv-documents: employee restricted to own person, update" on storage.objects
  as restrictive for update to authenticated
  using (
    not (
      bucket_id = 'cv-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
      and cv_documents_path_person_id(name) is distinct from own_linked_person_id((storage.foldername(name))[1]::uuid)
    )
  )
  with check (
    not (
      bucket_id = 'cv-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
      and cv_documents_path_person_id(name) is distinct from own_linked_person_id((storage.foldername(name))[1]::uuid)
    )
  );

create policy "cv-documents: employee restricted to own person, delete" on storage.objects
  as restrictive for delete to authenticated
  using (
    not (
      bucket_id = 'cv-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
      and cv_documents_path_person_id(name) is distinct from own_linked_person_id((storage.foldername(name))[1]::uuid)
    )
  );
