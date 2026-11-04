-- Standing review finding, 2026-11-04. Two things, both in the same
-- company_can_request_pack()/company_packs_this_period() family, found
-- while re-examining this session's own backlog item ("company_can_
-- request_pack()'s TOCTOU race - two callers, left unfixed").
--
-- 1. A REAL REGRESSION, not yet live (0096 and 0109 are both still on the
--    pending-migrations list - neither has run against production yet, so
--    this has caused no live harm, but would the moment they're applied in
--    numeric order without this fix alongside them):
--
--    0084 found and fixed a real, reproduced quota-bypass - company_
--    packs_this_period() and company_can_request_pack()'s trialing branch
--    only counted status = 'ready' packs, so any number of packs could be
--    requested in parallel before the first one ever finished. The fix was
--    to count 'requested'/'generating' too, not only 'ready'.
--
--    0109 (membership-check hardening) did `create or replace function`
--    on BOTH functions wholesale, from scratch, to add the is_company_
--    member() guard - and in doing so silently reverted 0084's own fix:
--    0109's body for both functions is back to counting only
--    status = 'ready'. Confirmed by reading 0109's SQL directly, not
--    assumed from the migration's own title (which only mentions the
--    membership check, not this).
--
--    Reproduced directly in a disposable scratch database, against 0109's
--    exact current (pending) definitions: a trialing company with ONE
--    'requested' job already in flight - company_can_request_pack() still
--    returned true (should be false, 0084's own one-pack-total trial cap).
--    An active Professional company (15/month) with the same one
--    'requested' job in flight - company_packs_this_period() returned 0
--    (should be 1), so company_can_request_pack() also wrongly returned
--    true. Both axes of 0084's original fix, regressed.
--
--    Fixed by combining ALL three generations' real fixes in one body:
--    0084's in-flight counting, 0096's trial_ends_at lapse check, 0109's
--    is_company_member() guard. Nothing here changes any of those three
--    fixes' own intent - this only re-merges them correctly after one
--    rewrite accidentally dropped a different one's change.
--
-- 2. The TOCTOU race itself, now fixed the same proven way 0113/0114
--    already used (SECURITY DEFINER + `for update` on company_
--    subscriptions for the duration of check-then-write), closing the
--    backlog item left open specifically because this one has TWO
--    different callers inserting two structurally different rows
--    (requestSubmissionPack()'s SANRAL insert carries a large, TypeScript-
--    computed readiness_snapshot jsonb; requestJob()'s general-engine
--    insert is a different, simpler shape gated only for kind =
--    'generate_pack', and already relies on the existing unique partial
--    index + 23505-swallow for "already queued" instead of erroring) -
--    genuinely two checked-insert functions needed, not one, but the same
--    mechanical pattern either way: lock, check, insert, all in one
--    transaction, so a second concurrent request for the same company
--    blocks on the lock instead of racing the first to the quota count.
--
--    Reproduced directly: a trialing company (one pack total) with zero
--    existing jobs, two concurrent requestSubmissionPack()-shaped calls
--    for two DIFFERENT tenders (the existing per-tender "already queued"
--    guard only blocks a second request for the SAME tender, so this
--    needs two different tender_ids, not special timing) - both read
--    "0 in flight, cap is 1" before either committed, both inserted. Two
--    real pack_generation_jobs rows against a one-pack-total trial.
--
--    Re-ran the identical scenario against request_submission_pack_
--    checked() below: the first call's lock makes the second block until
--    the first commits, then the second correctly sees 1 job already
--    counted (not 0) and raises instead of inserting - exactly one job,
--    not two.

create or replace function company_packs_this_period(p_company_id uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select case when is_company_member(p_company_id) then (
    select count(*)::integer
    from pack_generation_jobs
    where company_id = p_company_id
      and status in ('requested', 'generating', 'ready')
      and requested_at >= (
        select coalesce(current_period_start, created_at) from company_subscriptions where company_id = p_company_id
      )
  ) else null end;
$$;
comment on function company_packs_this_period(uuid) is
  'Count of bid packs that count against this company''s monthly allowance - requested, generating OR ready, excluding only failed (0084) - across both pack_generation_jobs.engine values, since this company''s current billing period started. Returns null for a caller who is not a member of p_company_id (0109). Re-merged 2026-11-04 after 0109''s own rewrite silently dropped 0084''s in-flight counting while adding the membership guard - both fixes now combined.';

create or replace function company_can_request_pack(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_status text;
  v_max_packs integer;
  v_trial_ends_at timestamptz;
begin
  if not is_company_member(p_company_id) then
    return null;
  end if;
  select status, max_packs_per_month, trial_ends_at into v_status, v_max_packs, v_trial_ends_at
    from company_subscriptions where company_id = p_company_id;
  if v_status is null then
    return false;
  end if;
  if v_status = 'trialing' then
    if v_trial_ends_at is not null and v_trial_ends_at < now() then
      return false;
    end if;
    return (select count(*) from pack_generation_jobs
             where company_id = p_company_id and status in ('requested', 'generating', 'ready')) < 1;
  end if;
  if v_status = 'active' then
    return v_max_packs is null or company_packs_this_period(p_company_id) < v_max_packs;
  end if;
  return false;
end;
$$;
comment on function company_can_request_pack(uuid) is
  'The one gate requestSubmissionPack()/requestJob() (generate_pack) call before inserting a new pack_generation_jobs row, and the one app/app/billing/page.tsx reads for its own "packs used this period" display. Trialing gets exactly ONE pack total, ever, and lapses to false once trial_ends_at passes (0096); active gets the plan''s own max_packs_per_month (null = unlimited). Counts in-flight (requested/generating) packs the same as ready (0084). Returns null for a caller who is not a member of p_company_id (0109). Re-merged 2026-11-04 - see this migration''s header comment for why all three prior fixes needed combining again. Superseded as the sole gate for the two real call sites by request_submission_pack_checked()/request_general_job_checked() below, which call this same logic under a row lock so the check and the insert can no longer race.';

-- ---------------------------------------------------------------------------
-- Checked, atomic request-and-insert for requestSubmissionPack() (SANRAL).
-- ---------------------------------------------------------------------------
create or replace function request_submission_pack_checked(
  p_company_id uuid, p_tender_id uuid, p_tender_pack_id uuid,
  p_readiness_snapshot jsonb, p_acknowledged_gaps boolean,
  p_reviewed_at timestamptz, p_reviewed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_max_packs integer;
  v_trial_ends_at timestamptz;
  v_job_id uuid;
begin
  if not is_company_member(p_company_id) then
    raise exception 'not a member of this company' using errcode = 'P0001';
  end if;

  -- for update: locks this company's subscription row for the rest of the
  -- transaction (same row 0113/0114 already lock for their own checks), so
  -- a second concurrent pack request for the SAME company blocks here
  -- until this one commits, instead of racing it to the in-flight count.
  select status, max_packs_per_month, trial_ends_at into v_status, v_max_packs, v_trial_ends_at
    from company_subscriptions where company_id = p_company_id for update;

  if v_status is null then
    raise exception 'no subscription row for this company' using errcode = 'P0002';
  end if;
  if v_status = 'trialing' then
    if v_trial_ends_at is not null and v_trial_ends_at < now() then
      raise exception 'Your trial has ended - upgrade on the Billing page to generate more bid packs.' using errcode = 'P0004';
    end if;
    if (select count(*) from pack_generation_jobs
         where company_id = p_company_id and status in ('requested', 'generating', 'ready')) >= 1 then
      raise exception 'You''ve reached your plan''s bid pack limit for this period - upgrade on the Billing page to generate more.' using errcode = 'P0004';
    end if;
  elsif v_status = 'active' then
    if v_max_packs is not null and company_packs_this_period(p_company_id) >= v_max_packs then
      raise exception 'You''ve reached your plan''s bid pack limit for this period - upgrade on the Billing page to generate more.' using errcode = 'P0004';
    end if;
  else
    raise exception 'You''ve reached your plan''s bid pack limit for this period - upgrade on the Billing page to generate more.' using errcode = 'P0004';
  end if;

  insert into pack_generation_jobs (
    company_id, tender_id, tender_pack_id, status, readiness_snapshot,
    acknowledged_gaps, reviewed_at, reviewed_by, requested_by
  ) values (
    p_company_id, p_tender_id, p_tender_pack_id, 'requested', coalesce(p_readiness_snapshot, '{}'::jsonb),
    coalesce(p_acknowledged_gaps, false), p_reviewed_at, p_reviewed_by, auth.uid()
  ) returning id into v_job_id;

  return v_job_id;
end;
$$;
revoke all on function request_submission_pack_checked(uuid, uuid, uuid, jsonb, boolean, timestamptz, uuid) from public;
grant execute on function request_submission_pack_checked(uuid, uuid, uuid, jsonb, boolean, timestamptz, uuid) to authenticated;
comment on function request_submission_pack_checked(uuid, uuid, uuid, jsonb, boolean, timestamptz, uuid) is
  'requestSubmissionPack()''s (app/tenders/[id]/actions.ts) one real write - checks company_can_request_pack()''s own quota logic and inserts the new pack_generation_jobs row in the same transaction, locking company_subscriptions (for update) for the duration so two concurrent requests for the same company can''t both slip past the quota, the same race 0113/0114 already closed for seat/owner checks. requested_by is always auth.uid(), never a parameter - this function is granted to authenticated and callable directly via supabase.rpc(), not only through this app''s own Server Action.';

-- ---------------------------------------------------------------------------
-- Checked, atomic request-and-insert for requestJob() (general engine).
-- Quota-gated only for kind = 'generate_pack', same as the existing
-- TypeScript - extract_requirements has never had a quota and still doesn't.
-- Mirrors the existing unique partial index's own "already queued, that's
-- fine" semantics with `on conflict do nothing` rather than raising, since
-- the current TypeScript explicitly treats a 23505 there as a non-error.
-- ---------------------------------------------------------------------------
create or replace function request_general_job_checked(
  p_company_id uuid, p_tender_id uuid, p_tender_pack_id uuid, p_kind text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
  v_max_packs integer;
  v_trial_ends_at timestamptz;
  v_job_id uuid;
begin
  if not is_company_member(p_company_id) then
    raise exception 'not a member of this company' using errcode = 'P0001';
  end if;
  if p_kind not in ('generate_pack', 'extract_requirements') then
    raise exception 'unknown job kind %', p_kind using errcode = '22023';
  end if;

  if p_kind = 'generate_pack' then
    -- Same per-company lock as request_submission_pack_checked() above -
    -- both functions lock the same row, so a SANRAL and a general request
    -- for the same company at the same moment also serialize correctly,
    -- not just two general requests against each other.
    select status, max_packs_per_month, trial_ends_at into v_status, v_max_packs, v_trial_ends_at
      from company_subscriptions where company_id = p_company_id for update;

    if v_status is null then
      raise exception 'no subscription row for this company' using errcode = 'P0002';
    end if;
    if v_status = 'trialing' then
      if v_trial_ends_at is not null and v_trial_ends_at < now() then
        raise exception 'Your trial has ended - upgrade on the Billing page to generate more bid packs.' using errcode = 'P0004';
      end if;
      if (select count(*) from pack_generation_jobs
           where company_id = p_company_id and status in ('requested', 'generating', 'ready')) >= 1 then
        raise exception 'You''ve reached your plan''s bid pack limit for this period - upgrade on the Billing page to generate more.' using errcode = 'P0004';
      end if;
    elsif v_status = 'active' then
      if v_max_packs is not null and company_packs_this_period(p_company_id) >= v_max_packs then
        raise exception 'You''ve reached your plan''s bid pack limit for this period - upgrade on the Billing page to generate more.' using errcode = 'P0004';
      end if;
    else
      raise exception 'You''ve reached your plan''s bid pack limit for this period - upgrade on the Billing page to generate more.' using errcode = 'P0004';
    end if;
  end if;

  insert into pack_generation_jobs (company_id, tender_id, tender_pack_id, engine, kind, requested_by)
  values (p_company_id, p_tender_id, p_tender_pack_id, 'general', p_kind, auth.uid())
  on conflict do nothing
  returning id into v_job_id;

  return v_job_id;
end;
$$;
revoke all on function request_general_job_checked(uuid, uuid, uuid, text) from public;
grant execute on function request_general_job_checked(uuid, uuid, uuid, text) to authenticated;
comment on function request_general_job_checked(uuid, uuid, uuid, text) is
  'requestJob()''s (app/tenders/[id]/general-actions.ts) one real write for both kinds - checks company_can_request_pack()''s own quota logic (only for kind=generate_pack, same as the existing TypeScript; extract_requirements has never been quota-gated) and inserts in the same transaction, locking company_subscriptions (for update, generate_pack only) so a concurrent SANRAL or general request for the same company can''t both slip past the quota. on conflict do nothing mirrors the existing pack_generation_jobs_one_open_key unique index''s own "already queued" semantics, which the calling TypeScript already treats as a non-error (23505), not a new behaviour. requested_by is always auth.uid(), never a parameter.';
