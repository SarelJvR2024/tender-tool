-- Finding 212 (standing solution-architect review, 2026-11-08): the
-- 'onboarding-documents' bucket's OWN storage.objects RLS policy
-- (0063_onboarding_document_scan.sql, "onboarding-documents: tenant
-- isolation by path prefix") checks only is_company_member((storage.
-- foldername(name))[1]::uuid) - never role - even though BOTH real tables
-- this bucket backs already give 'employee' a COMPLETE BLOCK at the table
-- level: 0077's own "onboarding_uploads: employee has no access" and
-- "onboarding_document_results: employee has no access" RESTRICTIVE
-- policies (0077_company_invites_and_employee_role.sql, lines ~452-461).
-- The identical shape PR #188 (migration 0127, tender-documents), PR #189
-- (0128, cv-documents), PR #190 (0129, company-documents), PR #191 (0130,
-- experience-documents) and PR #192 (0131, submission-packs) already found
-- and fixed on this same storage schema, and this review's own prior pass
-- (migration 0132, narrative-documents) just closed the other of the two
-- buckets PR #191's own write-up explicitly left open and unverified - this
-- is the matching reproduction and fix for 'onboarding-documents', the
-- last of the original 7-bucket catalog.
--
-- Path convention (0063's own policy and its own header comment): "<company_id>/
-- <uuid>-<filename>" - no batch subfolder (batch_id is a plain column, not
-- a storage path segment). The company id is the FIRST path segment, same
-- shape as company-documents/experience-documents/submission-packs/
-- narrative-documents - a single bucket-wide employee exclusion closes it,
-- no finer person-id parsing needed (onboarding_uploads/
-- onboarding_document_results have no person-scoped column at all - these
-- are not-yet-classified company documents, not a per-person CV).
--
-- Why this is reachable, not theoretical: app/app/company/document-scan/
-- upload-form.tsx uploads straight from the browser to the
-- 'onboarding-documents' bucket (uploadBatch(), a plain anon-key + user-JWT
-- client shipped to the browser by design, RLS being the only real
-- boundary - app/lib/supabase/client.ts) before any row is ever inserted
-- into onboarding_uploads, and actions.ts's registerOnboardingUploads()/
-- copyBetweenBuckets() both call the identical RLS-bound createClient()
-- (@/lib/supabase/server) to download/upload/remove objects in this same
-- bucket directly. The Document Scan screen (app/app/company/
-- document-scan) is reachable by any signed-in company member - this
-- review family's own 0119/systematic-sweep finding already established
-- AppShell.tsx's isEmployee only swaps the nav list, never gates page
-- content. An employee's own real company id is trivially known to them
-- (their own session's company), and storage.objects has no foreign key
-- into onboarding_uploads, so a made-up filename segment under their own
-- company prefix works exactly as well as a real one for INSERT.
-- Compliance documents dropped here before classification - CIDB/B-BBEE
-- certificates, SARS tax clearance, ID documents, even a CV captured
-- during onboarding (0063's own document_kind list) - were fully
-- readable, plantable, tamperable and deletable straight through the
-- Storage API, bypassing both table-level RESTRICTIVE blocks entirely.
--
-- Verified live in a scratch Postgres (engine/security/replay_schema.sh,
-- 113 migrations through 0123, then migration 0132, then this file) - full
-- transcript in docs/specs/QA-Edge-Case-Findings.md Finding 212 / docs/
-- specs/System-Status.md. Seeded one company, one 'owner' and one
-- 'employee' member, one real onboarding_uploads row with a real storage
-- object inserted the legitimate way (as the owner). As the employee
-- (`begin; set local role authenticated; select set_config('test.uid',
-- '<uuid>', true); ...; rollback;`):
--   Confirmed the table-level control already holds, as a control:
--   `select count(*) from onboarding_uploads where company_id =
--   '<company>'` as the employee - 0 rows (0077's own block is airtight at
--   the table level, exactly as designed).
--   RED (migrations through 0123 only, no fix): SELECT on the real object
--   - returned the row (readable/downloadable). INSERT a brand-new
--   planted object under the company's own prefix - `INSERT 0 1`
--   (plantable). UPDATE the real object's own metadata - `UPDATE 1`
--   (tamperable). DELETE the real object - `DELETE 1` (destroyable).
--   GREEN (with this migration applied, re-run from a fresh replay): the
--   identical SELECT returned 0 rows; the identical INSERT failed with
--   "new row violates row-level security policy \"onboarding-documents:
--   employee excluded, insert\""; the identical UPDATE matched 0 rows; the
--   identical DELETE matched 0 rows. A separate control confirmed the
--   owner's own full access to the bucket (select/insert/update/delete) is
--   completely unaffected by this fix.
--
-- Fix: four new, additive RESTRICTIVE policies on storage.objects, scoped
-- to just bucket_id = 'onboarding-documents', excluding 'employee'
-- entirely - the same "full block" shape PR #188/#190/#191/#192's own
-- fixes (and this review's own migration 0132, narrative-documents) already
-- used. Nothing existing is dropped or edited - the pre-existing
-- PERMISSIVE policy from 0063 is untouched; these four narrow what it
-- grants. is_employee_in_company() is false for owner/admin/member, so
-- every check below ANDs away to "true" (a no-op) for them - their access
-- is completely unchanged.
--
-- This closes the last of the original 7-bucket storage-authorization-
-- bypass catalog PR #188's own `pg_policies where schemaname = 'storage'`
-- query first surfaced (tender-documents, cv-documents, company-documents,
-- experience-documents, submission-packs, narrative-documents,
-- onboarding-documents) - see docs/specs/System-Status.md for the
-- explicit "angle exhausted" declaration.
create policy "onboarding-documents: employee excluded, select" on storage.objects
  as restrictive for select to authenticated
  using (
    not (
      bucket_id = 'onboarding-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "onboarding-documents: employee excluded, insert" on storage.objects
  as restrictive for insert to authenticated
  with check (
    not (
      bucket_id = 'onboarding-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "onboarding-documents: employee excluded, update" on storage.objects
  as restrictive for update to authenticated
  using (
    not (
      bucket_id = 'onboarding-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  )
  with check (
    not (
      bucket_id = 'onboarding-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "onboarding-documents: employee excluded, delete" on storage.objects
  as restrictive for delete to authenticated
  using (
    not (
      bucket_id = 'onboarding-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );
