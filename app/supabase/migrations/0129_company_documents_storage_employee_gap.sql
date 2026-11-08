-- Finding 208 (standing solution-architect review, 2026-11-08): the
-- 'company-documents' bucket's OWN storage.objects RLS policy
-- ("company-documents: tenant isolation by path prefix", 0014_vault_
-- compliance_documents.sql) checks only is_company_member((storage.
-- foldername(name))[1]::uuid) - the COMPANY id - and never references
-- is_employee_in_company() at all, even though every real table this
-- bucket backs (company_principals, held_registrations, bank_accounts,
-- company_properties, property_documents, company_document_templates,
-- tender_answers, and companies itself, via its own vault columns) already
-- gives 'employee' a COMPLETE BLOCK at the table level (0077's own
-- "employee has no access" RESTRICTIVE policies) - the identical shape PR
-- #188 (migration 0127, tender-documents) already found and fixed on this
-- same storage schema, and the identical shape PR #189 (migration 0128,
-- cv-documents) just fixed for the finer-grained "own person only" case.
-- This is that same reproduction and fix for the widest-surface remaining
-- bucket: every path convention this bucket actually uses -
-- "<company_id>/vault/<doc>/<uuid>-<filename>" (0014), "<company_id>/
-- templates/<document_type>/..." (0037 company_document_templates), and
-- "<company_id>/tenders/<tender_id>/<uuid>-<filename>" (0018 tender_
-- answers / general tender preparation) - all key the company id as the
-- FIRST path segment and nothing finer, so a single bucket-wide employee
-- exclusion (no person-id parsing needed, unlike 0128) closes all three at
-- once.
--
-- Why this is reachable, not theoretical: every real upload/download site
-- for this bucket (app/lib/vaultDocuments.ts's VAULT_BUCKET constant,
-- app/app/company/actions.ts's vault document save/remove, app/app/people/
-- actions.ts's registration-document remove on person delete, and every
-- company_document_templates / tender_answers storage_path write) goes
-- through the identical RLS-bound createClient() (app/lib/supabase/server.ts)
-- a Server Action always uses - and, same as PR #188/#189 already
-- established for this family, storage.objects is also reachable directly
-- from the browser's own supabase.storage client (app/lib/supabase/
-- client.ts: a plain anon-key + user-JWT client shipped to the browser by
-- design, RLS being the only real boundary) with no RPC and no table
-- read/write involved at all - nothing stops a signed-in employee from
-- calling that client by hand against their own real company id (trivially
-- known to them) to reach every vault/template/tender-answer document the
-- company has ever stored, including a real B-BBEE certificate, SARS TCS
-- PIN letter, bank confirmation letter or ISO 9001 certificate.
--
-- Verified live in a scratch Postgres (engine/security/replay_schema.sh,
-- 113 migrations through 0123, then this file) - full transcript in
-- docs/specs/QA-Edge-Case-Findings.md Finding 208 / docs/specs/
-- System-Status.md. Seeded one company, one 'owner' and one 'employee'
-- member, one real vault document object inserted the legitimate way. As
-- the employee (confirmed first, as a control, that company_principals -
-- one of the tables this bucket backs - is already correctly and
-- completely invisible to this same employee at the table level):
--   RED (migrations through 0123 only): SELECT on the real vault object -
--   returned the row (readable/downloadable). INSERT a brand-new object
--   under the company's own vault/ prefix - succeeded (plantable). UPDATE
--   the real object's own metadata - succeeded (tamperable). DELETE the
--   real object - `DELETE 1`, confirmed gone by a superuser read
--   afterward.
--   GREEN (with this migration applied): the identical SELECT returned 0
--   rows; the identical INSERT failed with "new row violates row-level
--   security policy company-documents: employee excluded, insert"; the
--   identical UPDATE matched 0 rows; the identical DELETE matched 0 rows;
--   a final superuser read confirmed the real object was completely
--   untouched throughout. A separate control confirmed the owner's own
--   full access to the bucket (select/insert/update/delete) is completely
--   unaffected by this fix.
--
-- Fix: four new, additive RESTRICTIVE policies on storage.objects, scoped
-- to just this bucket, excluding 'employee' entirely - the same "full
-- block" shape PR #188's own fix already used for tender-documents' manual/
-- private prefixes (as opposed to PR #189's finer "own person only" shape
-- for cv-documents, which this bucket does not need: every table it backs
-- gives 'employee' zero access, not "own record only"). Nothing existing is
-- dropped or edited - the pre-existing PERMISSIVE policy from 0014 is
-- untouched; these four narrow what it grants. is_employee_in_company() is
-- false for owner/admin/member, so every check below ANDs away to "true"
-- (a no-op) for them - their access is completely unchanged.
create policy "company-documents: employee excluded, select" on storage.objects
  as restrictive for select to authenticated
  using (
    not (
      bucket_id = 'company-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "company-documents: employee excluded, insert" on storage.objects
  as restrictive for insert to authenticated
  with check (
    not (
      bucket_id = 'company-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "company-documents: employee excluded, update" on storage.objects
  as restrictive for update to authenticated
  using (
    not (
      bucket_id = 'company-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  )
  with check (
    not (
      bucket_id = 'company-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );

create policy "company-documents: employee excluded, delete" on storage.objects
  as restrictive for delete to authenticated
  using (
    not (
      bucket_id = 'company-documents'
      and is_employee_in_company((storage.foldername(name))[1]::uuid)
    )
  );
