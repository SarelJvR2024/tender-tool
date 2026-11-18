-- QA pass (standing robustness review, 2026-11-18, worker/job-queue rotation,
-- 4th lap, Finding 493): pack_generation_jobs, generated_cvs and
-- narrative_documents each let any signed-in company member insert a row on
-- their OWN company's behalf while naming a DIFFERENT real user as
-- `requested_by` - the RLS INSERT check on all three only ever verified
-- `is_company_member(company_id)` (the value being written), never that
-- `requested_by` is the inserting session's own `auth.uid()`.
--
-- Confirmed live, real scratch Postgres (engine/security/replay_schema.sh),
-- not reasoned about: seeded two real company-A members (the attacker, and
-- "Bob", a real colleague who never touched this session), set role
-- authenticated with auth.uid() = the attacker's own id, and ran the exact
-- shape of insert each real Server Action sends - but with requested_by
-- forced to Bob's id instead of the attacker's own. Pre-fix: all three
-- inserts succeeded (`INSERT 0 1`, `requested_by` genuinely holding Bob's
-- id). pack_generation_jobs.requested_by and generated_cvs.requested_by both
-- feed app/lib/tenderActivity.ts's Tender Workspace "who did what, when"
-- activity log directly (`actor: user(j.requested_by)` /
-- `actor: user(cv.requested_by)`) - that file's own header states plainly
-- that every pack/CV request entry there "has both a time and ... who", so
-- this is a real, user-visible misattribution: any team member could make
-- the shared log falsely show a named colleague as having requested (and
-- so spent) a pack-generation or CV credit they never asked for.
-- narrative_documents.requested_by has no current UI reader (confirmed:
-- tenderActivity.ts has no "narrative"/cover-letter category today) - same
-- root cause, left latent rather than yet user-visible, fixed anyway for
-- consistency since it is the identical gap on the identical column shape.
--
-- Checked every real, legitimate writer of these three tables before
-- tightening (confirmed each already passes its own session's real
-- auth.uid(), so none of them is broken by this check):
--   pack_generation_jobs - app/app/tenders/new/actions.ts's raw insert
--     (extract_requirements on tender creation) passes requested_by: userId,
--     the Server Action's own session user. (request_submission_pack_checked()/
--     request_general_job_checked(), migration 0115, don't use this RLS path
--     at all - both are SECURITY DEFINER and always set requested_by to
--     auth.uid() internally, never a caller-supplied value, so they are
--     unaffected either way.)
--   generated_cvs - app/app/tenders/[id]/actions.ts's requestTenderCv() and
--     app/lib/standardCvQueue.ts's queueStandardCvs() (called from
--     app/app/my-cv/actions.ts and app/app/people/actions.ts) both pass
--     requested_by: user?.id / userId, each sourced from that same request's
--     own supabase.auth.getUser().
--   narrative_documents - app/app/tenders/[id]/narrative-actions.ts passes
--     requested_by: user?.id ?? null, same pattern.
--
-- Post-fix (verified in the same scratch database): the identical
-- Bob-impersonating insert on all three tables now raises
-- `new row violates row-level security policy`, while the unmodified
-- legitimate shape (requested_by = the inserting session's own auth.uid())
-- still succeeds unchanged on all three.
--
-- pack_generation_jobs already had its INSERT policy split out from its
-- other actions (0026) - this only widens that one policy's own check.
-- generated_cvs and narrative_documents never got that split (both still
-- carried one "tenant isolation" FOR ALL policy from their very first
-- migration) - split each into the same per-command shape pack_generation_jobs
-- already uses, so only INSERT gains the new check; SELECT/UPDATE/DELETE for
-- company members are untouched (still exactly is_company_member(company_id),
-- the same same-company-can-manage-its-own-data model this app uses
-- everywhere else - this migration only closes the "insert naming a different
-- real person" gap, not that broader model).

alter policy "pack_generation_jobs: members can request" on pack_generation_jobs
  with check (
    is_company_member(company_id) and status = 'requested' and storage_path_pdf is null and manifest is null
    and output_files = '{}'::jsonb and error_message is null and started_at is null and completed_at is null
    and (requested_by is null or requested_by = auth.uid())
  );

drop policy "generated_cvs: tenant isolation" on generated_cvs;
create policy "generated_cvs: members can select" on generated_cvs
  for select to authenticated using (is_company_member(company_id));
create policy "generated_cvs: members can insert" on generated_cvs
  for insert to authenticated with check (
    is_company_member(company_id) and (requested_by is null or requested_by = auth.uid())
  );
create policy "generated_cvs: members can update" on generated_cvs
  for update to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));
create policy "generated_cvs: members can delete" on generated_cvs
  for delete to authenticated using (is_company_member(company_id));

drop policy "narrative_documents: tenant isolation" on narrative_documents;
create policy "narrative_documents: members can select" on narrative_documents
  for select to authenticated using (is_company_member(company_id));
create policy "narrative_documents: members can insert" on narrative_documents
  for insert to authenticated with check (
    is_company_member(company_id) and (requested_by is null or requested_by = auth.uid())
  );
create policy "narrative_documents: members can update" on narrative_documents
  for update to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));
create policy "narrative_documents: members can delete" on narrative_documents
  for delete to authenticated using (is_company_member(company_id));
