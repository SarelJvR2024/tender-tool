-- Standing review finding, 2026-11-07 (new angle: the Finding-178/180
-- read-then-write/TOCTOU-gate shape, found in a Next.js Server Action
-- instead of a Postgres function).
--
-- applyCvExtraction() (app/app/people/actions.ts) and its self-service twin
-- applyMyCvExtraction() (app/app/my-cv/actions.ts) each read one
-- cv_extraction_results row once, gate on review_status = 'pending_review',
-- then perform the people update / projects insert / cv_extraction_results
-- mark-applied write as three separate, unlocked REST calls - and the LAST
-- of those three never re-checks review_status in its own .eq() chain. Their
-- own sibling, discardMyCvExtraction() (same file), already got exactly that
-- guard (.eq("review_status", "pending_review") on its own update, standing
-- review, 2026-11-06, with a comment naming the exact risk: "the row having
-- moved on from 'pending_review' already") - the two "apply" paths never did,
-- an oversight this pass's own systematic sweep of Server Actions caught by
-- applying the SQL-side angle-2/3 lesson ("a read-then-write/gate-check
-- window with no lock or re-check") to TypeScript instead of SQL.
--
-- Real, reachable race: two concurrent "Apply"/"Save selected fields"
-- submissions for the SAME extraction - a double-click before the page
-- navigates away, or the same pending-review card left open in two browser
-- tabs - both pass the initial read's review_status check before either
-- commits. For applyCvExtraction() specifically this duplicates real rows in
-- `projects` (not idempotent - every ticked project gets inserted twice,
-- silently, with no error to either caller) and queues a second full set of
-- standard-CV-generation jobs (queueStandardCvs(), itself already flagged by
-- its own comment as having no database-level backstop at all). Neither
-- caller sees any error either way - cv_extraction_results.applied is simply
-- overwritten a second time and both redirects report success.
--
-- Fix, same pattern as 0121/0113/0107: move the read-gate-write sequence
-- into one locked SQL transaction per caller. `for update` on the initial
-- SELECT means a second concurrent call for the SAME extraction blocks on
-- the row lock until the first commits, then sees review_status already
-- 'applied' and raises instead of silently re-applying - no second projects
-- insert, no second CV-job batch, no lost error. The people-fields write
-- (_apply_cv_person_fields, same shape as 0024's _manual_tender_documents()
-- private helper - plain plpgsql, not itself security definer, never
-- granted, only reachable from inside the two security-definer functions
-- below) only ever touches a column when its jsonb key is present, mirroring
-- exactly what applyCvExtraction()'s/applyMyCvExtraction()'s own
-- personUpdate object already builds in TypeScript (only ticked keys ever
-- present) - nothing new is validated here; validation (date format, select
-- options, required fields) stays in TypeScript exactly as before. This
-- migration only makes the WRITE atomic.
--
-- Reproduced directly in a disposable scratch database (never this app's
-- live DB, the standing guardrail on scratch Postgres use applies as
-- always): seeded one cv_extraction_results row (review_status
-- 'pending_review') naming one proposed project, ran two concurrent calls
-- against a copy of the OLD three-separate-query shape with a pg_sleep()
-- inserted right after the read (widening the race window for a
-- deterministic demo; no logic changed) - both calls returned successfully,
-- final `projects` row count: 2 (the same project duplicated),
-- cv_extraction_results.applied overwritten twice, no error either side.
-- Re-ran the identical two concurrent calls through
-- apply_cv_extraction_checked(): the first call committed normally (1
-- project row); the second call's `for update` blocked until the first
-- committed, then raised "These extracted fields were already saved or
-- discarded." - final `projects` row count: 1, exactly one extraction
-- applied, one clear error returned to the loser.
create or replace function _apply_cv_person_fields(p_person_id uuid, p_person_fields jsonb)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_person_fields is null or p_person_fields = '{}'::jsonb then
    return;
  end if;
  update people set
    name                 = case when p_person_fields ? 'name' then p_person_fields->>'name' else name end,
    id_number            = case when p_person_fields ? 'id_number' then p_person_fields->>'id_number' else id_number end,
    role                 = case when p_person_fields ? 'role' then p_person_fields->>'role' else role end,
    phone                = case when p_person_fields ? 'phone' then p_person_fields->>'phone' else phone end,
    email                = case when p_person_fields ? 'email' then p_person_fields->>'email' else email end,
    ecsa_level           = case when p_person_fields ? 'ecsa_level' then p_person_fields->>'ecsa_level' else ecsa_level end,
    ecsa_number          = case when p_person_fields ? 'ecsa_number' then p_person_fields->>'ecsa_number' else ecsa_number end,
    ecsa_date            = case when p_person_fields ? 'ecsa_date' then (p_person_fields->>'ecsa_date')::date else ecsa_date end,
    sacpcmp_number       = case when p_person_fields ? 'sacpcmp_number' then p_person_fields->>'sacpcmp_number' else sacpcmp_number end,
    sacpcmp_date         = case when p_person_fields ? 'sacpcmp_date' then (p_person_fields->>'sacpcmp_date')::date else sacpcmp_date end,
    highest_level        = case when p_person_fields ? 'highest_level' then p_person_fields->>'highest_level' else highest_level end,
    highest_description  = case when p_person_fields ? 'highest_description' then p_person_fields->>'highest_description' else highest_description end,
    highest_institution  = case when p_person_fields ? 'highest_institution' then p_person_fields->>'highest_institution' else highest_institution end,
    highest_graduated    = case when p_person_fields ? 'highest_graduated' then (p_person_fields->>'highest_graduated')::date else highest_graduated end,
    initial_description  = case when p_person_fields ? 'initial_description' then p_person_fields->>'initial_description' else initial_description end,
    initial_institution  = case when p_person_fields ? 'initial_institution' then p_person_fields->>'initial_institution' else initial_institution end,
    initial_graduated    = case when p_person_fields ? 'initial_graduated' then (p_person_fields->>'initial_graduated')::date else initial_graduated end,
    updated_at = now()
  where id = p_person_id;
end;
$$;
revoke all on function _apply_cv_person_fields(uuid, jsonb) from public;
comment on function _apply_cv_person_fields(uuid, jsonb) is
  'Private helper (never GRANTed - only reachable from inside apply_cv_extraction_checked()/apply_my_cv_extraction_checked()''s own security-definer execution, same shape as 0024''s _manual_tender_documents()). Updates only the people columns whose key is present in p_person_fields, mirroring applyCvExtraction()''s own personUpdate object exactly (only ticked keys are ever present).';

create or replace function apply_cv_extraction_checked(
  p_extraction_id uuid, p_person_id uuid, p_person_fields jsonb, p_project_rows jsonb, p_applied_meta jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_row_person_id uuid;
  v_status text;
begin
  -- for update: locks this one cv_extraction_results row for the rest of
  -- the transaction, so a second concurrent call for the SAME extraction
  -- blocks here until this one commits or rolls back, then its own select
  -- sees review_status already 'applied' instead of a pre-commit snapshot.
  select company_id, person_id, review_status into v_company_id, v_row_person_id, v_status
  from cv_extraction_results where id = p_extraction_id for update;

  if not found or not is_company_member(v_company_id) then
    raise exception 'That extraction result wasn''t found for this person.';
  end if;
  if v_row_person_id <> p_person_id then
    raise exception 'That extraction result wasn''t found for this person.';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'These extracted fields were already saved or discarded.';
  end if;

  perform _apply_cv_person_fields(p_person_id, p_person_fields);

  if jsonb_array_length(coalesce(p_project_rows, '[]'::jsonb)) > 0 then
    insert into projects (
      company_id, person_id, client_and_number, position_held, value_rm,
      start_date, end_date, contact_name, contact_phone, contact_email,
      contact_match_confidence, source_note
    )
    select
      v_company_id, p_person_id, x->>'client_and_number', x->>'position_held',
      (x->>'value_rm')::numeric, (x->>'start_date')::date, (x->>'end_date')::date,
      x->>'contact_name', x->>'contact_phone', x->>'contact_email',
      'unconfirmed', x->>'source_note'
    from jsonb_array_elements(p_project_rows) as x;
  end if;

  update cv_extraction_results set
    review_status = 'applied',
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    applied = p_applied_meta
  where id = p_extraction_id;
end;
$$;
revoke all on function apply_cv_extraction_checked(uuid, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function apply_cv_extraction_checked(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;
comment on function apply_cv_extraction_checked(uuid, uuid, jsonb, jsonb, jsonb) is
  'Atomically applies a reviewed cv_extraction_results row (0023): locks the row (for update, 2026-11-07), checks the caller''s company membership, that person_id matches, and that review_status is still pending_review, then writes the ticked people fields, inserts any ticked projects, and marks the row applied - all in one transaction. A second concurrent call for the SAME extraction (double-click, two tabs) blocks on the row lock until the first commits, then raises instead of silently re-applying and duplicating projects.';

create or replace function apply_my_cv_extraction_checked(
  p_extraction_id uuid, p_person_id uuid, p_person_fields jsonb, p_applied_meta jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_row_person_id uuid;
  v_status text;
begin
  select company_id, person_id, review_status into v_company_id, v_row_person_id, v_status
  from cv_extraction_results where id = p_extraction_id for update;

  if not found or not is_company_member(v_company_id) then
    raise exception 'That extraction result wasn''t found for you.';
  end if;
  if v_row_person_id <> p_person_id then
    raise exception 'That extraction result wasn''t found for you.';
  end if;
  if v_status <> 'pending_review' then
    raise exception 'These extracted fields were already saved or discarded.';
  end if;

  perform _apply_cv_person_fields(p_person_id, p_person_fields);

  update cv_extraction_results set
    review_status = 'applied',
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    applied = p_applied_meta
  where id = p_extraction_id;
end;
$$;
revoke all on function apply_my_cv_extraction_checked(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function apply_my_cv_extraction_checked(uuid, uuid, jsonb, jsonb) to authenticated;
comment on function apply_my_cv_extraction_checked(uuid, uuid, jsonb, jsonb) is
  'Self-service twin of apply_cv_extraction_checked() for /my-cv (0065) - same atomic lock-check-write shape, no projects table (my-cv never adds projects). A second concurrent call for the SAME extraction blocks on the row lock instead of silently re-applying.';
