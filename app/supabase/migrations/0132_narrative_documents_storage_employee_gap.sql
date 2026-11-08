-- Finding 211 (standing solution-architect review, 2026-11-08): the
-- 'narrative-documents' bucket's OWN storage.objects RLS policy
-- (0087_narrative_documents.sql, "narrative-documents: tenant isolation by
-- path prefix") checks only is_company_member((storage.foldername(name))
-- [1]::uuid) - never role - even though the one real table this bucket
-- backs, narrative_documents, already gives 'employee' a COMPLETE BLOCK at
-- the table level (0087's own "narrative_documents: employee has no
-- access" RESTRICTIVE policy, same migration, lines ~122-126). The
-- identical shape PR #188 (migration 0127, tender-documents), PR #189
-- (0128, cv-documents), PR #190 (0129, company-documents), PR #191 (0130,
-- experience-documents) and PR #192 (0131, submission-packs) already found
-- and fixed on this same storage schema - this is that same reproduction
-- and fix for 'narrative-documents', one of the two buckets PR #191's own
-- write-up explicitly left open and unverified (narrative-documents,
-- onboarding-documents - submission-packs, the third, was closed by #192).
--
-- Path convention (0087's own policy): "<company_id>/tenders/<tender_id>/
-- <job_id>/<file>" - the company id is the FIRST path segment, same as
-- company-documents/experience-documents/submission-packs - a single
-- bucket-wide employee exclusion closes it, no finer person-id parsing
-- needed (confirmed: narrative_documents has no person-scoped column at
-- all, only company_id/tender_id - it is cover-letter/methodology
-- submission content, not a per-person CV).
--
-- Why this is reachable, not theoretical: app/app/tenders/[id]/
-- narrative-documents.tsx (a card on the Tender Workspace, reachable by any
-- signed-in company member, employee included - this review family's own
-- 0119/systematic-sweep finding already established AppShell.tsx's
-- isEmployee only swaps the nav list, never gates page content) calls
-- `createClient()` (@/lib/supabase/server, RLS-bound) and does
-- `supabase.storage.from("narrative-documents").createSignedUrl(p, 600)`
-- directly - no RPC, no table read of narrative_documents required first.
-- An employee's own real company id is trivially known to them (their own
-- session's company), and storage.objects has no foreign key into
-- narrative_documents, so a made-up tender/job id under their own company
-- prefix works exactly as well as a real one for INSERT. Content this
-- bucket holds (cover letters, methodology statements - real submission
-- content the table-level RESTRICTIVE policy's own comment already names
-- as off-limits to this role) was fully readable, plantable and
-- deletable straight through the Storage API.
--
-- Verified live in a scratch Postgres (engine/security/replay_schema.sh,
-- 113 migrations through 0123, then this file) - full transcript in
-- docs/specs/QA-Edge-Case-Findings.md Finding 211 / docs/specs/
-- System-Status.md. Seeded one company, one 'owner' and one 'employee'
-- member, one real tenders/narrative_documents row with a real storage
-- object inserted the legitimate way (as the owner). As the employee
-- (`begin; set local role authenticated; select set_config('test.uid',
-- '<uuid>', true); ...; rollback;`):
--   Confirmed the table-level control already holds, as a control:
--   `select count(*) from narrative_documents where company_id =
--   '<company>'` as the employee - 0 rows (0087's own block is airtight at
--   the table level, exactly as designed).
--   RED (migrations through 0123 only, no fix): SELECT on the real object
--   - returned the row (readable/downloadable). INSERT a brand-new object
--   under the company's own tenders/<tender>/<job>/ prefix - `INSERT 0 1`
--   (plantable). DELETE the real object - `DELETE 1` (destroyable).
--   GREEN (with this migration applied, re-run from a fresh replay): the
--   identical SELECT returned 0 rows; the identical INSERT failed with
--   "new row violates row-level security policy \"narrative-documents:
--   employee excluded, insert\""; the identical DELETE matched 0 rows. A
--   separate control confirmed the owner's own full access to the bucket
--   (select/insert/update/delete) is completely unaffected by this fix.
--
-- Fix: four new, additive RESTRICTIVE policies on storage.objects, scoped
-- to just bucket_id = 'narrative-documents', excluding 'employee' entirely
-- - the same "full block" shape PR #188/#190/#191/#192's own fixes already
-- used (as opposed to PR #189's finer "own person only" shape for
-- cv-documents, not needed here: narrative_documents gives 'employee' zero
-- access, not "own record only"). Nothing existing is dropped or edited -
-- the pre-existing PERMISSIVE policy from 0087 is untouched; these four
-- narrow what it grants. is_employee_in_company() is false for owner/
-- admin/member, so every check below ANDs away to "true" (a no-op) for
-- them - their access is completely unchanged.
create policy "narrative-documents: employee excluded, select" on storage.objects
  as restrictive for select to authenticated
  using (
    not (
      bucket_id = 'narrative-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "narrative-documents: employee excluded, insert" on storage.objects
  as restrictive for insert to authenticated
  with check (
    not (
      bucket_id = 'narrative-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "narrative-documents: employee excluded, update" on storage.objects
  as restrictive for update to authenticated
  using (
    not (
      bucket_id = 'narrative-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  )
  with check (
    not (
      bucket_id = 'narrative-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "narrative-documents: employee excluded, delete" on storage.objects
  as restrictive for delete to authenticated
  using (
    not (
      bucket_id = 'narrative-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );
