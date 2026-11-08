-- Standing review finding, 2026-11-08 (continuing the orthogonal "is the RLS
-- PREDICATE itself correct" sweep the immediately preceding pass named,
-- angle 3: a RESTRICTIVE policy an earlier-or-later-created SECURITY
-- DEFINER RPC was never checked against - same underlying class 0119/PR #176
-- found and fixed for 12 OTHER functions, just in two that did not exist yet
-- at the time of that sweep).
--
-- apply_cv_extraction_checked() and apply_my_cv_extraction_checked() (both
-- 0123, added AFTER 0119's own systematic "every client-reachable SECURITY
-- DEFINER function checked against 0077/0117/0118's RESTRICTIVE policies"
-- sweep - so neither was, or could have been, in that sweep's own list of
-- 12) each read/write `people`, `projects` and `cv_extraction_results` -
-- every one of them covered by an 0077 "employee restricted to own
-- record/person" RESTRICTIVE policy - but because both functions are
-- SECURITY DEFINER, they bypass those RESTRICTIVE policies entirely, the
-- identical risk 0119's own header already named for its 12 functions, just
-- never swept against these two because they did not exist at the time.
--
-- apply_cv_extraction_checked() is the full People-page RPC
-- (app/app/people/actions.ts applyCvExtraction()) - NOT one of an
-- employee's two allowed pages at all (EMPLOYEE_NAV_ITEMS is only Home and
-- My CV). It checked only `is_company_member(v_company_id)`, never role, so
-- any employee-role member could call it directly (supabase.rpc(), no
-- Server Action needed) against a COLLEAGUE's own cv_extraction_results row
-- and person_id - bypassing "people: employee restricted to own record",
-- "projects: employee restricted to own person" and "cv_extraction_results:
-- employee restricted to own person" (all 0077) in one call: overwrite the
-- colleague's own people columns (name, ID number, phone, email, ECSA/
-- SACPCMP numbers, qualifications) AND insert fabricated `projects` rows
-- for them, then mark their cv_extraction_results row 'applied'.
--
-- apply_my_cv_extraction_checked() is the self-service My CV twin
-- (app/app/my-cv/actions.ts applyMyCvExtraction()) - My CV IS one of an
-- employee's two allowed pages, and its own Server Action always resolves
-- p_person_id server-side from people.linked_user_id = auth.uid() (never a
-- client-supplied value) - but the RPC itself is still directly callable by
-- anyone with a session, and it never checks that p_person_id is the
-- CALLER's own linked person when the caller is an employee. It checked
-- only `is_company_member(v_company_id)` and that the row's own person_id
-- matches the p_person_id argument - both satisfied by ANY person_id in the
-- caller's own company, colleague included. Same bypass as above, just
-- reached through the "self-service" RPC instead of the full one.
--
-- Reproduced directly in a disposable scratch Postgres
-- (engine/security/replay_schema.sh against all 123 prior migrations, never
-- the live DB - dropped and the service stopped immediately after use).
-- One company, one owner, one employee (linked to their own person row),
-- one SEPARATE "colleague" person (not linked to any account), one
-- cv_uploads + pending_review cv_extraction_results row for the colleague.
-- Acting as the employee (set role authenticated; select
-- set_config('test.uid', '<employee uuid>', true)), pre-fix:
--   * apply_my_cv_extraction_checked(<colleague's extraction>, <colleague's
--     person_id>, {"phone": "9999999999"}, {}) -> SUCCEEDED. A follow-up
--     superuser read confirmed the colleague's real `people.phone` was
--     overwritten to '9999999999' and their cv_extraction_results row was
--     marked 'applied', reviewed_by = the EMPLOYEE's own uid.
--   * apply_cv_extraction_checked(<colleague's extraction>, <colleague's
--     person_id>, {"phone": "8888888888", "role": "Hacked by employee"},
--     [{"client_and_number": "Fabricated Project 1"}], {}) -> SUCCEEDED
--     (on a freshly reset pending_review row). A follow-up superuser read
--     confirmed the colleague's `people.phone`/`people.role` were
--     overwritten AND a fabricated `projects` row for the colleague was
--     genuinely inserted - a full read/write bypass of the colleague's own
--     restricted record by an employee who was never granted any access to
--     it at all.
--
-- Fix, the identical additive, narrow-only shape 0117/0118/0119 established
-- (one new guard near the top of each function body, before any write;
-- owner/admin/member completely unaffected since is_employee_in_company()
-- is false for them):
--   * apply_cv_extraction_checked(): an employee gets the full People-page
--     RPC blocked outright, same as 10 of 0119's own 12 functions treat a
--     feature that isn't one of their two allowed pages at all.
--   * apply_my_cv_extraction_checked(): an employee is still allowed to use
--     it (My CV IS their own allowed page) but ONLY when p_person_id is
--     their OWN linked person (own_linked_person_id(v_company_id)) - the
--     exact boundary the RESTRICTIVE policies this function bypasses were
--     always meant to enforce. Owner/admin/member callers are unaffected
--     either way (the guard only ever fires when is_employee_in_company()
--     is true).
--
-- Verified green myself, same scratch database, re-running the exact same
-- two calls after this migration: apply_cv_extraction_checked() as the
-- employee against the colleague's row now raises "Reviewing CV extractions
-- from the People page is managed by your company's owner, admin or
-- member - not the employee role. Use My CV for your own record." (42501),
-- with the colleague's people/projects rows confirmed unchanged by a
-- follow-up superuser read. apply_my_cv_extraction_checked() as the
-- employee against the colleague's row now raises "That extraction result
-- wasn't found for you." (42501), with the colleague's people.phone and
-- cv_extraction_results.review_status confirmed unchanged. The employee
-- calling apply_my_cv_extraction_checked() for THEIR OWN extraction/person
-- still succeeds, unchanged. The owner calling apply_cv_extraction_checked()
-- for the colleague still succeeds, unchanged (owner/admin/member have, and
-- keep, full access to every person in their own company).
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
  if is_employee_in_company(v_company_id) then
    raise exception 'Reviewing CV extractions from the People page is managed by your company''s owner, admin or member - not the employee role. Use My CV for your own record.' using errcode = '42501';
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
  'Atomically applies a reviewed cv_extraction_results row (0023): locks the row (for update, 2026-11-07), checks the caller''s company membership and that the role is not employee (2026-11-08 - the People page is not one of an employee''s two allowed pages, and this SECURITY DEFINER function would otherwise bypass every "employee restricted to own record/person" RESTRICTIVE policy on people/projects/cv_extraction_results), that person_id matches, and that review_status is still pending_review, then writes the ticked people fields, inserts any ticked projects, and marks the row applied - all in one transaction.';

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
  -- An employee may only ever apply their OWN linked person's extraction
  -- through this self-service RPC - own_linked_person_id() is exactly the
  -- boundary the "people/projects/cv_extraction_results: employee
  -- restricted to own record/person" RESTRICTIVE policies (0077) already
  -- enforce on a plain table write; this SECURITY DEFINER function bypassed
  -- all three of them until now (2026-11-08). No-op for owner/admin/member
  -- (is_employee_in_company() is false for them), so their own use of this
  -- same page for their own linked person is completely unaffected.
  if is_employee_in_company(v_company_id) and p_person_id <> own_linked_person_id(v_company_id) then
    raise exception 'That extraction result wasn''t found for you.' using errcode = '42501';
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
  'Self-service twin of apply_cv_extraction_checked() for /my-cv (0065) - same atomic lock-check-write shape, no projects table (my-cv never adds projects). An employee caller is restricted to their OWN linked person (own_linked_person_id(), 2026-11-08 - this SECURITY DEFINER function otherwise bypassed the "employee restricted to own record/person" RESTRICTIVE policies on people/cv_extraction_results entirely); owner/admin/member are unaffected. A second concurrent call for the SAME extraction blocks on the row lock instead of silently re-applying.';
