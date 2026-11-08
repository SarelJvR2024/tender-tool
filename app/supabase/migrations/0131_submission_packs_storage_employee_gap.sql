-- Finding 210 (standing solution-architect review, 2026-11-08): the
-- 'submission-packs' bucket's OWN storage.objects RLS policy
-- (0017_pack_generation_jobs.sql, "submission-packs: tenant isolation by
-- path prefix") checks only is_company_member((storage.foldername(name))
-- [1]::uuid) - never role - even though BOTH real tables this bucket backs
-- already give 'employee' a COMPLETE BLOCK at the table level: 0077's own
-- "pack_generation_jobs: employee has no access" and "generated_documents:
-- employee has no access" RESTRICTIVE policies. The identical shape PR
-- #188 (migration 0127, tender-documents), PR #189 (migration 0128,
-- cv-documents), PR #190 (migration 0129, company-documents) and PR #191
-- (migration 0130, experience-documents) already found and fixed on this
-- same storage schema - this is that same reproduction and fix for the
-- 'submission-packs' bucket, one of the 3 buckets PR #191's own write-up
-- explicitly left open and unverified (narrative-documents,
-- onboarding-documents, submission-packs).
--
-- Path convention (0017's own policy, re-inserted unchanged by 0018 for the
-- general-engine flow): "<company_id>/tenders/<tender_id>/<job_id>/<file>"
-- - the company id is the FIRST path segment, so (same as
-- company-documents/0129 and experience-documents/0130) a single
-- bucket-wide employee exclusion closes it, no finer person-id parsing
-- needed.
--
-- Why this is reachable, not theoretical: every real app-layer call site
-- (app/app/tenders/[id]/submission-pack.tsx's createSignedUrl() reads of
-- the merged SANRAL pack PDF, reached from the Tender Workspace page any
-- signed-in company member - including an employee who follows a link into
-- /tenders/[id], confirmed reachable per this review family's own
-- 0119/systematic-sweep finding that AppShell.tsx's isEmployee only swaps
-- the nav list, never gates page content) goes through the identical
-- RLS-bound createClient() a Server Action/server component uses - exactly
-- the same family PR #188/#189/#190/#191 already established reaches
-- storage.objects directly from ANY authenticated client holding a valid
-- session JWT (app/lib/supabase/client.ts, a plain anon-key + user-JWT
-- client shipped to the browser by design, RLS being the only real
-- boundary), with no RPC and no table read/write involved at all. An
-- employee's own real company id is trivially known to them (their own
-- session's company) - no cross-tenant guessing needed - to reach every
-- submitted bid pack and generated document the company has ever produced:
-- priced technical workbooks, Form B returnable forms, covers, the full
-- merged SANRAL submission PDF - content 0077's own header names by name
-- ("the company's... pricing... submission content") as off-limits to this
-- role.
--
-- Verified live in a scratch Postgres (engine/security/replay_schema.sh,
-- 113 migrations through 0123, then this file) - full transcript in
-- docs/specs/QA-Edge-Case-Findings.md Finding 210 / docs/specs/
-- System-Status.md. Seeded one company, one 'owner' and one 'employee'
-- member, one real tenders/tender_packs/pack_generation_jobs row chain with
-- a real storage object inserted the legitimate way (as the owner). As the
-- employee (`begin; set local role authenticated; select set_config(
-- 'test.uid', '<uuid>', true); ...; commit;`):
--   Confirmed the table-level control already holds, as a control:
--   `select count(*) from pack_generation_jobs where company_id =
--   '<company>'` and the same for `generated_documents` as the employee -
--   0 rows both (0077's own block is airtight at the table level, exactly
--   as designed).
--   RED (migrations through 0123 only, no fix): SELECT on the real object
--   - returned the row (readable/downloadable). INSERT a brand-new object
--   under the company's own tenders/<tender>/<job>/ prefix - succeeded
--   (plantable). UPDATE the real object's own metadata - `UPDATE 1`
--   (tamperable). DELETE the real object - `DELETE 1`, confirmed gone by a
--   superuser read afterward (only the planted file remained).
--   GREEN (with this migration applied): the identical SELECT returned 0
--   rows; the identical INSERT failed with "new row violates row-level
--   security policy \"submission-packs: employee excluded, insert\""; the
--   identical UPDATE matched 0 rows; the identical DELETE matched 0 rows; a
--   superuser read afterward confirmed the real object was completely
--   untouched throughout. A separate control confirmed the owner's own
--   full access to the bucket (select/insert/update/delete) is completely
--   unaffected by this fix.
--
-- Fix: four new, additive RESTRICTIVE policies on storage.objects, scoped
-- to just bucket_id = 'submission-packs', excluding 'employee' entirely -
-- the same "full block" shape PR #188/#190/#191's own fixes already used
-- (as opposed to PR #189's finer "own person only" shape for
-- cv-documents, not needed here: both pack_generation_jobs and
-- generated_documents give 'employee' zero access, not "own record only").
-- Nothing existing is dropped or edited - the pre-existing PERMISSIVE
-- policy from 0017 is untouched; these four narrow what it grants.
-- is_employee_in_company() is false for owner/admin/member, so every check
-- below ANDs away to "true" (a no-op) for them - their access is
-- completely unchanged.
create policy "submission-packs: employee excluded, select" on storage.objects
  as restrictive for select to authenticated
  using (
    not (
      bucket_id = 'submission-packs'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "submission-packs: employee excluded, insert" on storage.objects
  as restrictive for insert to authenticated
  with check (
    not (
      bucket_id = 'submission-packs'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "submission-packs: employee excluded, update" on storage.objects
  as restrictive for update to authenticated
  using (
    not (
      bucket_id = 'submission-packs'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  )
  with check (
    not (
      bucket_id = 'submission-packs'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "submission-packs: employee excluded, delete" on storage.objects
  as restrictive for delete to authenticated
  using (
    not (
      bucket_id = 'submission-packs'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );
