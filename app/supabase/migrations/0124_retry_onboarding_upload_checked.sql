-- Confirmed, severe bug (standing solution-architect review, background
-- worker, 2026-11-07 - Finding 201): document-scan/actions.ts's
-- retryOnboardingUpload() has NEVER actually requeued anything in
-- production, for ANY user, on ANY click - not just under a double-click
-- race, which is the narrower (and wrong) conclusion the immediately
-- preceding pass in this same track reached for this exact function
-- (System-Status.md, "2026-11-07xxxviii" entry, "genuine negative... There
-- is no onboarding_uploads row-delete path... the toast's own copy
-- hedges..."). That pass traced only the WORKER side (process_onboarding_jobs.py
-- never touches a classification_failed row) and concluded the only way to
-- reach a zero-row match was two retries racing each other. It never
-- checked whether the signed-in user's own RLS-bound UPDATE can match the
-- row AT ALL - it cannot, for anyone, ever:
--
--   export async function retryOnboardingUpload(formData: FormData) {
--     const { supabase, companyId } = await requireCompanyId();   // RLS-bound client, NOT service role
--     ...
--     const { error } = await supabase
--       .from("onboarding_uploads")
--       .update({ status: "classification_requested", ... })
--       .eq("id", uploadId).eq("company_id", companyId).eq("status", "classification_failed");
--     if (error) { ... }                                          // never fires: PostgREST
--                                                                  // returns 2xx + error: null
--                                                                  // on a zero-row RLS match
--     redirect(`${back}?saved=retrying`);                         // unconditional - runs anyway
--   }
--
-- onboarding_uploads' own RLS (0063, ~line 146) grants authenticated members
-- SELECT and INSERT only - its own comment says so outright: "No member
-- update/delete: status is worker-owned... The worker writes with the
-- service role (bypasses RLS)". Grepping all of app/supabase/migrations/*.sql
-- for onboarding_uploads confirms the only OTHER hit is 0077's RESTRICTIVE
-- "employee has no access" policy, which only narrows, never grants. There
-- is no PERMISSIVE UPDATE policy on this table for authenticated anywhere.
--
-- Independently reproduced in a disposable scratch database (never this
-- app's live DB; dropped and the Postgres service stopped after use, same
-- standing guardrail every prior scratch-DB finding in this doc follows):
-- 114 migrations replayed via engine/security/replay_schema.sh, a real
-- company/owner-member/onboarding_uploads row seeded (status
-- 'classification_failed'), no concurrency, no race - `set role
-- authenticated; select set_config('test.uid', '<owner uuid>', false);` then
-- the EXACT UPDATE statement above: `UPDATE 0`, every single time, for
-- every real user. The action then unconditionally redirects to
-- `?saved=retrying`, which page.tsx's own SAVED map renders as "Queued
-- again - this page updates itself as the result comes in." - the Retry
-- button has told every user it worked while writing nothing, always, not
-- only on a double-click.
--
-- Fix, same pattern as 0121/0122/0123 (and this file's own sibling PR #183,
-- not merged, referenced here only as a pattern, never touched or built on
-- directly): a security definer RPC that re-implements the access check
-- itself (RLS is bypassed entirely inside security definer, not inherited -
-- is_company_member()/is_employee_in_company() re-checked explicitly here,
-- mirroring onboarding_uploads' own real policy set: the one PERMISSIVE
-- "members read"/"members insert" pair plus 0077's RESTRICTIVE "employee
-- has no access"), locks the row for update, re-checks status =
-- 'classification_failed' under that lock and raises a friendly exception
-- rather than silently no-op'ing if it isn't, then writes. A non-member or
-- an employee-role member gets a clear refusal instead of a silently-wasted
-- click; a row not in classification_failed gets a clear "already"-style
-- message instead of the same false "retrying" toast.
--
-- Full write-up: docs/specs/QA-Edge-Case-Findings.md Finding 201.

create or replace function retry_onboarding_upload_checked(p_upload_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_status text;
begin
  -- for update: locks this one onboarding_uploads row for the rest of the
  -- transaction, so two concurrent retries of the SAME upload (double-click,
  -- two tabs) can't both pass the status check below - the second blocks on
  -- the lock, then re-reads the first's already-applied status change.
  select company_id, status into v_company_id, v_status
  from onboarding_uploads where id = p_upload_id for update;

  if not found or not is_company_member(v_company_id) or is_employee_in_company(v_company_id) then
    raise exception 'That document wasn''t found.';
  end if;
  if v_status <> 'classification_failed' then
    raise exception 'This document isn''t waiting on a retry.';
  end if;

  update onboarding_uploads set
    status = 'classification_requested',
    classification_error = null,
    classification_claimed_at = null,
    classification_completed_at = null
  where id = p_upload_id;
end;
$$;
revoke all on function retry_onboarding_upload_checked(uuid) from public, anon;
grant execute on function retry_onboarding_upload_checked(uuid) to authenticated;
comment on function retry_onboarding_upload_checked(uuid) is
  'Re-queues one onboarding_uploads row stuck on classification_failed for engine/onboarding/process_onboarding_jobs.py to pick up again. security definer because onboarding_uploads'' own RLS (0063) grants authenticated members SELECT/INSERT only, never UPDATE (status is worker-owned, written by the service role everywhere else) - document-scan/actions.ts''s retryOnboardingUpload() used to run a plain RLS-bound .update() that matched ZERO rows for every real user, every time, while unconditionally redirecting to a "Queued again" success toast (Finding 201, 2026-11-07). Re-implements the access check itself (is_company_member()/not is_employee_in_company(), since security definer bypasses RLS entirely rather than inheriting it), locks the row (for update) before re-checking status = classification_failed, and raises a friendly exception instead of silently no-op''ing on a non-member, an employee-role member, or a row that has already moved off classification_failed.';
