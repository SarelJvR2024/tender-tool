-- Finding 209 (standing solution-architect review, 2026-11-08): the
-- 'experience-documents' bucket's OWN storage.objects RLS policy
-- ("experience-documents: tenant isolation by path prefix", 0012_
-- experience_items.sql) checks only is_company_member((storage.foldername(
-- name))[1]::uuid) - never role - even though the real table this bucket
-- backs (experience_items) already gives 'employee' a COMPLETE BLOCK at
-- the table level (0077's own "experience_items: employee has no access"
-- RESTRICTIVE policy). The identical shape PR #188 (migration 0127,
-- tender-documents), PR #189 (migration 0128, cv-documents) and PR #190
-- (migration 0129, company-documents) already found and fixed on this same
-- storage schema - this is that same reproduction and fix for the
-- 'experience-documents' bucket, one of the 4 buckets PR #190's own
-- write-up explicitly left open and unverified (experience-documents,
-- narrative-documents, onboarding-documents, submission-packs).
--
-- Path convention (0012's own header comment, confirmed unchanged by every
-- later migration that touches this bucket): "<company_id>/experience/
-- <uuid>-<filename>" - the company id is the FIRST and ONLY relevant path
-- segment, so (same as company-documents/0129) a single bucket-wide
-- employee exclusion closes it, no person-id parsing needed.
--
-- Why this is reachable, not theoretical: every real app-layer call site
-- (app/app/experience/actions.ts's create/update/delete on experience_items
-- and their storage_path, app/app/experience/[id]/page.tsx and
-- app/app/experience/page.tsx's createSignedUrl() reads, and
-- app/app/company/document-scan/actions.ts's copyBetweenBuckets() from the
-- onboarding-documents bucket) all go through the identical RLS-bound
-- createClient() a Server Action/client component uses - exactly the same
-- family PR #188/#189/#190 already established reaches storage.objects
-- directly from the browser's own supabase.storage client
-- (app/lib/supabase/client.ts, a plain anon-key + user-JWT client shipped
-- to the browser by design, RLS being the only real boundary), with no RPC
-- and no table read/write involved at all. An employee's own real company
-- id is trivially known to them (their own session's company), so no
-- cross-tenant guessing is even needed to reach every track-record
-- document (performance reports, reference letters, completion
-- certificates, award letters) the company has ever stored for tender
-- compliance evidence.
--
-- Verified live in a scratch Postgres (engine/security/replay_schema.sh,
-- 113 migrations through 0123, then this file) - full transcript in
-- docs/specs/QA-Edge-Case-Findings.md Finding 209 / docs/specs/
-- System-Status.md. Seeded one company, one 'owner' and one 'employee'
-- member, one real experience_items row with a real storage object
-- inserted the legitimate way (as the owner). As the employee
-- (`begin; set local role authenticated; select set_config('test.uid',
-- '<uuid>', true); ...; commit;`):
--   Confirmed the table-level control already holds, as a control:
--   `select count(*) from experience_items where company_id = '<company>'`
--   as the employee - 0 rows (0077's own block is airtight at the table
--   level, exactly as designed).
--   RED (migrations through 0123 only, no fix): SELECT on the real object
--   - returned the row (readable/downloadable). INSERT a brand-new object
--   under the company's own experience/ prefix - succeeded (plantable).
--   UPDATE the real object's own metadata - `UPDATE 1` (tamperable).
--   DELETE the real object - `DELETE 1`, confirmed gone by a superuser
--   read afterward (only the planted file remained).
--   GREEN (with this migration applied): the identical SELECT returned 0
--   rows; the identical INSERT failed with "new row violates row-level
--   security policy \"experience-documents: employee excluded, insert\"";
--   the identical UPDATE matched 0 rows; the identical DELETE matched 0
--   rows; a superuser read afterward confirmed the real object was
--   completely untouched throughout. A separate control confirmed the
--   owner's own full access to the bucket (select/insert/update/delete)
--   is completely unaffected by this fix.
--
-- Fix: four new, additive RESTRICTIVE policies on storage.objects, scoped
-- to just bucket_id = 'experience-documents', excluding 'employee'
-- entirely - the same "full block" shape PR #188/#190's own fixes already
-- used (as opposed to PR #189's finer "own person only" shape for
-- cv-documents, not needed here: experience_items gives 'employee' zero
-- access, not "own record only"). Nothing existing is dropped or edited -
-- the pre-existing PERMISSIVE policy from 0012 is untouched; these four
-- narrow what it grants. is_employee_in_company() is false for
-- owner/admin/member, so every check below ANDs away to "true" (a no-op)
-- for them - their access is completely unchanged.
create policy "experience-documents: employee excluded, select" on storage.objects
  as restrictive for select to authenticated
  using (
    not (
      bucket_id = 'experience-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "experience-documents: employee excluded, insert" on storage.objects
  as restrictive for insert to authenticated
  with check (
    not (
      bucket_id = 'experience-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "experience-documents: employee excluded, update" on storage.objects
  as restrictive for update to authenticated
  using (
    not (
      bucket_id = 'experience-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  )
  with check (
    not (
      bucket_id = 'experience-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "experience-documents: employee excluded, delete" on storage.objects
  as restrictive for delete to authenticated
  using (
    not (
      bucket_id = 'experience-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );
