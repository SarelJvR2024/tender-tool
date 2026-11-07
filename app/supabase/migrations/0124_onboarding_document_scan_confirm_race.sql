-- Standing review finding (2026-11-07, Finding 185): the Finding-184 TOCTOU
-- shape, the SAME pass that fixed applyCvExtraction()/applyMyCvExtraction()
-- explicitly named this file (app/app/company/document-scan/actions.ts) as
-- its own next, deliberately-not-yet-fixed instance of the identical bug -
-- read loadPendingResult() below.
--
-- Correction on the count: that pass's own writeup said "up to 5 separate
-- locked RPCs ... experience_items, and 4 others". Reading the real file:
-- only FOUR functions share both loadPendingResult()'s gate-read AND
-- markApplied()'s un-gated final write - confirmVaultDocument() (->
-- companies), confirmExperienceReferenceLetter() (-> experience_items),
-- confirmIdDocument() (-> company_principals), confirmCvHandoff() (->
-- cv_uploads). Two more functions in the same file, skipOnboardingDocument()
-- and discardOnboardingDocument(), share loadPendingResult()'s gate-read but
-- write straight back to onboarding_document_results itself (no markApplied,
-- no second table) - a related but cheaper-to-fix instance (see the plain
-- TypeScript fix in the same commit as this migration: adding
-- .eq("review_status", "pending_review") to each one's own single UPDATE
-- statement, the exact fix discardCvExtraction()/discardMyCvExtraction()
-- already got, 2026-11-06 - no RPC needed, since a single UPDATE with the
-- right WHERE predicate is already atomic).
--
-- Severity read per path, not assumed uniform:
--   - confirmExperienceReferenceLetter() (-> experience_items INSERT) and
--     confirmCvHandoff() (-> cv_uploads INSERT) are the real, severe,
--     Finding-184-identical duplicate-ROW risk: two concurrent confirms of
--     the SAME pending onboarding document both pass the gate and both
--     INSERT, with no unique constraint on either table to catch it
--     (neither experience_items (0012) nor cv_uploads (0008) has one keyed
--     on anything this insert controls) - a silently duplicated experience
--     record, or a silently duplicated CV handed to
--     engine/cv/extract_cv_fields.py twice, with no error to either caller.
--   - confirmVaultDocument() (-> companies UPDATE) and confirmIdDocument()
--     (-> company_principals UPDATE) are a real but LOWER-severity instance
--     of the same gate-bypass: both are single-row UPDATEs keyed by a fixed
--     id (companyId / principalId), so a second concurrent confirm cannot
--     duplicate a row - the real damage is an orphaned Storage blob (the
--     losing confirm's own freshly-copied file, from a THIRD randomUUID()
--     destination path, never referenced by anything once the other
--     confirm's write lands) plus a lost-update on the destination columns
--     (last write wins) and markApplied() firing twice (already documented,
--     by markApplied()'s own comment, as harmless). Still fixed here, same
--     methodology, because "already reviewed" should still mean "reviewed",
--     not "whichever commits last" - but this is not the
--     projects/experience_items/cv_uploads class of bug.
--
-- Fix, same pattern as 0121/0113/0107/0123: one locked, checked RPC per
-- destination table, each locking the onboarding_document_results row (for
-- update) before its own dependent write (not just before markApplied()'s
-- own final write, which alone would not have closed this - the FIRST
-- destination-table write is the one that needs to happen only once),
-- rechecking review_status = 'pending_review' under that lock, then writing
-- the destination table and marking the row applied, all in one transaction.
-- A second concurrent call for the SAME result blocks on the row lock until
-- the first commits, then sees review_status already 'applied' and raises
-- "This document was already reviewed." instead of silently re-processing.
--
-- Company membership + the 0077 employee-role restriction are both
-- re-checked explicitly inside every function below (is_company_member() +
-- not is_employee_in_company()), mirroring onboarding_document_results' own
-- real RLS exactly (its one permissive "members read"/"members review"
-- policy plus 0077's RESTRICTIVE "employee has no access" policy) - a
-- security definer function bypasses RLS entirely, so it must reproduce the
-- access rule it stands in for itself, not just the review_status gate. The
-- Storage file-copy step (copyBetweenBuckets(), an external call, not a SQL
-- statement) stays in TypeScript exactly where it was, same as 0123's own
-- precedent for the people-fields/projects write - only the DESTINATION-
-- TABLE writes moved into these functions. markApplied() itself (the
-- function, in actions.ts) is now unused and removed in the same commit as
-- this migration - every one of its 4 call sites is replaced by one of
-- these 4 RPCs, which writes the equivalent review_status='applied' update
-- as part of the same locked transaction instead.
--
-- Reproduced directly in a disposable scratch database (never this app's
-- live DB; dropped and the Postgres service stopped after use, same standing
-- guardrail 0107/0113/0121/0122/0123 all followed). Full write-up in
-- docs/specs/QA-Edge-Case-Findings.md Finding 185.

create or replace function apply_onboarding_vault_document_checked(
  p_result_id uuid, p_updates jsonb, p_applied_meta jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_kind text;
  v_status text;
begin
  -- for update: locks this one onboarding_document_results row for the rest
  -- of the transaction, so a second concurrent confirm for the SAME result
  -- blocks here until this one commits or rolls back.
  select company_id, document_kind, review_status into v_company_id, v_kind, v_status
  from onboarding_document_results where id = p_result_id for update;

  if not found or not is_company_member(v_company_id) or is_employee_in_company(v_company_id) then
    raise exception 'That document wasn''t found.';
  end if;
  if v_kind not in ('cidb_registration', 'bbbee_certificate', 'sars_tax_clearance',
                     'bank_confirmation_letter', 'pi_insurance_certificate', 'iso_9001_certificate') then
    raise exception 'This document type isn''t filed this way.';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'This document was already reviewed.';
  end if;

  -- Only ever sets a column whose key is present in p_updates, mirroring
  -- confirmVaultDocument()'s own `update` object exactly (built in
  -- TypeScript from VAULT_FIELD_COLUMNS/VAULT_DOCUMENT_COLUMN - a fixed,
  -- server-controlled column allow-list, never formData itself) - same
  -- "only ticked keys present" convention as 0123's _apply_cv_person_fields().
  update companies set
    cidb_grading = case when p_updates ? 'cidb_grading' then p_updates->>'cidb_grading' else cidb_grading end,
    cidb_expiry = case when p_updates ? 'cidb_expiry' then (p_updates->>'cidb_expiry')::date else cidb_expiry end,
    cidb_registration_number = case when p_updates ? 'cidb_registration_number' then p_updates->>'cidb_registration_number' else cidb_registration_number end,
    cidb_contractor_name = case when p_updates ? 'cidb_contractor_name' then p_updates->>'cidb_contractor_name' else cidb_contractor_name end,
    cidb_document_path = case when p_updates ? 'cidb_document_path' then p_updates->>'cidb_document_path' else cidb_document_path end,
    bee_proof_type = case when p_updates ? 'bee_proof_type' then p_updates->>'bee_proof_type' else bee_proof_type end,
    bee_proof_expiry = case when p_updates ? 'bee_proof_expiry' then (p_updates->>'bee_proof_expiry')::date else bee_proof_expiry end,
    bee_entity_name = case when p_updates ? 'bee_entity_name' then p_updates->>'bee_entity_name' else bee_entity_name end,
    bee_proof_document_path = case when p_updates ? 'bee_proof_document_path' then p_updates->>'bee_proof_document_path' else bee_proof_document_path end,
    bee_level = case when p_updates ? 'bee_level' then (p_updates->>'bee_level')::int else bee_level end,
    sars_tcs_pin = case when p_updates ? 'sars_tcs_pin' then p_updates->>'sars_tcs_pin' else sars_tcs_pin end,
    sars_tcs_pin_expiry = case when p_updates ? 'sars_tcs_pin_expiry' then (p_updates->>'sars_tcs_pin_expiry')::date else sars_tcs_pin_expiry end,
    sars_tcs_pin_document_path = case when p_updates ? 'sars_tcs_pin_document_path' then p_updates->>'sars_tcs_pin_document_path' else sars_tcs_pin_document_path end,
    bank_confirmation_letter_date = case when p_updates ? 'bank_confirmation_letter_date' then (p_updates->>'bank_confirmation_letter_date')::date else bank_confirmation_letter_date end,
    bank_confirmation_bank_name = case when p_updates ? 'bank_confirmation_bank_name' then p_updates->>'bank_confirmation_bank_name' else bank_confirmation_bank_name end,
    bank_confirmation_account_holder = case when p_updates ? 'bank_confirmation_account_holder' then p_updates->>'bank_confirmation_account_holder' else bank_confirmation_account_holder end,
    bank_confirmation_letter_path = case when p_updates ? 'bank_confirmation_letter_path' then p_updates->>'bank_confirmation_letter_path' else bank_confirmation_letter_path end,
    pi_insurance_insurer = case when p_updates ? 'pi_insurance_insurer' then p_updates->>'pi_insurance_insurer' else pi_insurance_insurer end,
    pi_insurance_policy_number = case when p_updates ? 'pi_insurance_policy_number' then p_updates->>'pi_insurance_policy_number' else pi_insurance_policy_number end,
    pi_insurance_cover_zar = case when p_updates ? 'pi_insurance_cover_zar' then (p_updates->>'pi_insurance_cover_zar')::numeric else pi_insurance_cover_zar end,
    pi_insurance_expiry = case when p_updates ? 'pi_insurance_expiry' then (p_updates->>'pi_insurance_expiry')::date else pi_insurance_expiry end,
    pi_insurance_document_path = case when p_updates ? 'pi_insurance_document_path' then p_updates->>'pi_insurance_document_path' else pi_insurance_document_path end,
    iso_9001_certificate_number = case when p_updates ? 'iso_9001_certificate_number' then p_updates->>'iso_9001_certificate_number' else iso_9001_certificate_number end,
    iso_9001_expiry = case when p_updates ? 'iso_9001_expiry' then (p_updates->>'iso_9001_expiry')::date else iso_9001_expiry end,
    iso_9001_certified_entity_name = case when p_updates ? 'iso_9001_certified_entity_name' then p_updates->>'iso_9001_certified_entity_name' else iso_9001_certified_entity_name end,
    iso_9001_document_path = case when p_updates ? 'iso_9001_document_path' then p_updates->>'iso_9001_document_path' else iso_9001_document_path end,
    iso_9001_certified = case when p_updates ? 'iso_9001_certified' then (p_updates->>'iso_9001_certified')::boolean else iso_9001_certified end
  where id = v_company_id;

  update onboarding_document_results set
    review_status = 'applied', applied = p_applied_meta, reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_result_id;
end;
$$;
revoke all on function apply_onboarding_vault_document_checked(uuid, jsonb, jsonb) from public, anon;
grant execute on function apply_onboarding_vault_document_checked(uuid, jsonb, jsonb) to authenticated;
comment on function apply_onboarding_vault_document_checked(uuid, jsonb, jsonb) is
  'Atomically files one onboarding-scan vault document (0063) onto companies (0014/0018/0069): locks the onboarding_document_results row (for update, 2026-11-07), checks company membership/not-employee and that review_status is still pending_review, then writes only the companies columns present in p_updates and marks the row applied - all in one transaction. A second concurrent confirm for the SAME result blocks on the row lock until the first commits, then raises instead of silently re-filing (Finding 185).';

create or replace function apply_onboarding_experience_letter_checked(p_result_id uuid, p_row jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_kind text;
  v_status text;
  v_new_id uuid;
begin
  select company_id, document_kind, review_status into v_company_id, v_kind, v_status
  from onboarding_document_results where id = p_result_id for update;

  if not found or not is_company_member(v_company_id) or is_employee_in_company(v_company_id) then
    raise exception 'That document wasn''t found.';
  end if;
  if v_kind <> 'experience_reference_letter' then
    raise exception 'Wrong document type for this action.';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'This document was already reviewed.';
  end if;

  insert into experience_items (
    company_id, project_name, document_type, storage_path, original_filename,
    client_name, contract_number, value_rm, completion_date,
    reference_contact_name, reference_contact_phone, reference_contact_email, uploaded_by
  ) values (
    v_company_id, p_row->>'project_name', 'reference_letter', p_row->>'storage_path', p_row->>'original_filename',
    p_row->>'client_name', p_row->>'contract_number', (p_row->>'value_rm')::numeric, (p_row->>'completion_date')::date,
    p_row->>'reference_contact_name', p_row->>'reference_contact_phone', p_row->>'reference_contact_email', auth.uid()
  ) returning id into v_new_id;

  update onboarding_document_results set
    review_status = 'applied', applied = jsonb_build_object('table', 'experience_items', 'id', v_new_id),
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_result_id;
end;
$$;
revoke all on function apply_onboarding_experience_letter_checked(uuid, jsonb) from public, anon;
grant execute on function apply_onboarding_experience_letter_checked(uuid, jsonb) to authenticated;
comment on function apply_onboarding_experience_letter_checked(uuid, jsonb) is
  'Atomically files one onboarding-scan experience reference letter (0063) into experience_items (0012): locks the onboarding_document_results row (for update, 2026-11-07), checks company membership/not-employee and that review_status is still pending_review, then inserts the one experience_items row and marks the result applied - all in one transaction. This is the real, severe duplicate-row instance of Finding 185 (no unique constraint on experience_items would otherwise catch a second concurrent confirm''s insert).';

create or replace function apply_onboarding_id_document_checked(
  p_result_id uuid, p_principal_id uuid, p_dest_path text, p_filename text, p_certified_on date
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_kind text;
  v_status text;
  v_updated uuid;
begin
  select company_id, document_kind, review_status into v_company_id, v_kind, v_status
  from onboarding_document_results where id = p_result_id for update;

  if not found or not is_company_member(v_company_id) or is_employee_in_company(v_company_id) then
    raise exception 'That document wasn''t found.';
  end if;
  if v_kind <> 'id_document' then
    raise exception 'Wrong document type for this action.';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'This document was already reviewed.';
  end if;

  update company_principals set
    certified_id_path = p_dest_path, certified_id_filename = p_filename, certified_id_on = p_certified_on
  where id = p_principal_id and company_id = v_company_id
  returning id into v_updated;

  if v_updated is null then
    raise exception 'That person is no longer on your directors/shareholders register - it may have been removed. Refresh and try again.';
  end if;

  -- Follow-up (standing review, 2026-11-07, after this PR's own original
  -- commit): this used to hardcode `reviewed_by = null` here, matching
  -- confirmIdDocument()'s own pre-existing call
  -- (markApplied(supabase, resultId!, null, ...)) - this comment used to say
  -- that was "not this finding's bug to fix; preserved as-is". That was
  -- written before main's own Finding 185 (956701f) fixed
  -- confirmIdDocument() to pass the real calling user's id into
  -- markApplied() instead of null, exactly matching
  -- confirmVaultDocument()/confirmExperienceReferenceLetter()/
  -- confirmCvHandoff()'s own pattern. Carrying the null forward into this
  -- RPC would have silently reintroduced the bug Finding 185 just fixed the
  -- moment this PR merges. Fixed the same way this file's other 3 sibling
  -- RPCs already stamp reviewed_by - auth.uid() directly, which still
  -- resolves to the calling user's id inside a SECURITY DEFINER function
  -- (it reads the session's request.jwt.claims GUC, not table context) - no
  -- new parameter needed, and no TypeScript call site change needed either,
  -- since none of this file's 4 RPCs take reviewed_by as a caller-supplied
  -- argument.
  update onboarding_document_results set
    review_status = 'applied',
    applied = jsonb_build_object('table', 'company_principals', 'id', p_principal_id, 'column', 'certified_id_path'),
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_result_id;
end;
$$;
revoke all on function apply_onboarding_id_document_checked(uuid, uuid, text, text, date) from public, anon;
grant execute on function apply_onboarding_id_document_checked(uuid, uuid, text, text, date) to authenticated;
comment on function apply_onboarding_id_document_checked(uuid, uuid, text, text, date) is
  'Atomically files one onboarding-scan ID document (0063) onto company_principals (0050): locks the onboarding_document_results row (for update, 2026-11-07), checks company membership/not-employee, that review_status is still pending_review and that the chosen principal still exists in this company, then writes certified_id_path/filename/on and marks the result applied (reviewed_by = auth.uid(), same as this file''s other 3 sibling RPCs - fixed 2026-11-07 after this PR''s own original commit, so it does not reintroduce the reviewed_by=NULL bug main''s Finding 185 fixed) - all in one transaction (Finding 185).';

create or replace function apply_onboarding_cv_handoff_checked(
  p_result_id uuid, p_person_id uuid, p_storage_path text, p_original_filename text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_kind text;
  v_status text;
  v_new_id uuid;
begin
  select company_id, document_kind, review_status into v_company_id, v_kind, v_status
  from onboarding_document_results where id = p_result_id for update;

  if not found or not is_company_member(v_company_id) or is_employee_in_company(v_company_id) then
    raise exception 'That document wasn''t found.';
  end if;
  if v_kind <> 'cv' then
    raise exception 'Wrong document type for this action.';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'This document was already reviewed.';
  end if;
  if not exists (select 1 from people where id = p_person_id and company_id = v_company_id) then
    raise exception 'That person isn''t on your People page.';
  end if;

  insert into cv_uploads (company_id, person_id, storage_path, original_filename, mode, status, uploaded_by)
  values (v_company_id, p_person_id, p_storage_path, p_original_filename, 'ai_extract', 'extraction_requested', auth.uid())
  returning id into v_new_id;

  update onboarding_document_results set
    review_status = 'applied', applied = jsonb_build_object('handed_off_to', 'cv_uploads', 'id', v_new_id),
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_result_id;
end;
$$;
revoke all on function apply_onboarding_cv_handoff_checked(uuid, uuid, text, text) from public, anon;
grant execute on function apply_onboarding_cv_handoff_checked(uuid, uuid, text, text) to authenticated;
comment on function apply_onboarding_cv_handoff_checked(uuid, uuid, text, text) is
  'Atomically hands off one onboarding-scan CV (0063) into the existing cv_uploads/extract_cv_fields.py pipeline (0008/0023): locks the onboarding_document_results row (for update, 2026-11-07), checks company membership/not-employee, that review_status is still pending_review and that the chosen person still exists in this company, then inserts the cv_uploads row and marks the result applied - all in one transaction. The real, severe duplicate-row instance of Finding 185 alongside apply_onboarding_experience_letter_checked() (no unique constraint on cv_uploads would otherwise catch a second concurrent confirm''s insert, which would also queue a second real CV extraction).';
