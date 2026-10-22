-- Fixes a real, reproducible usage-limit bypass in 0083's brand-new
-- company_can_request_pack()/company_packs_this_period() - the one gate
-- requestSubmissionPack() (app/tenders/[id]/actions.ts) and requestJob()'s
-- generate_pack path (app/tenders/[id]/general-actions.ts) rely on before
-- inserting a pack_generation_jobs row, for both the trial's one-pack-total
-- cap and a paid plan's monthly allowance.
--
-- Both functions only counted status = 'ready' (a completed pack) rows.
-- pack_generation_jobs.status also has 'requested' and 'generating' - the
-- two states a job sits in between being inserted and actually finishing
-- (asynchronous: the pack bridge workers poll every ~30s - poll_loop.py's
-- own default interval - and a SANRAL/general pack can take a good while
-- longer than that to actually merge). Neither gating function looked at
-- those states at all, so the gate kept answering "yes, you may request
-- another pack" for every single request made before the FIRST one ever
-- reached 'ready' - with no cap on how many could be in flight at once.
--
-- Reproduced live against a real local Postgres running 0083's exact
-- functions (not a mock, not a hypothetical): a company on a 'trialing'
-- subscription (one pack total, ever) requested packs for 5 DIFFERENT
-- tenders in a row (the existing per-tender "already queued" guard in
-- requestSubmissionPack() only blocks a SECOND request for the SAME
-- tender, so this needs no special timing, just tracking more than one
-- tender) - company_can_request_pack() returned true all 5 times, and all
-- 5 pack_generation_jobs rows were inserted. The same reproduction against
-- an 'active' Starter plan (5 packs/month) let 8 requests through. Each of
-- these jobs is real, chargeable work once a worker claims it (LibreOffice
-- merging, Anthropic API calls for CV generation) - this is a real cost-
-- control and quota-bypass gap, not a cosmetic one, reachable simply by a
-- company requesting several different tenders' packs before any of them
-- finishes, which given real pack generation times is an easy window to
-- land in without any special effort.
--
-- Fix: count every job that will become (or already is) a real, counted
-- pack - 'requested', 'generating' AND 'ready' - excluding only 'failed'
-- (a failed job produced nothing and shouldn't cost the company its quota;
-- same "never penalise the user for a system failure" rule this project
-- already applies elsewhere, e.g. fail_stale_jobs() across every engine
-- bridge never blames the company for a worker crash).
create or replace function company_packs_this_period(p_company_id uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select count(*)::integer
  from pack_generation_jobs
  where company_id = p_company_id
    and status in ('requested', 'generating', 'ready')
    and requested_at >= (
      select coalesce(current_period_start, created_at) from company_subscriptions where company_id = p_company_id
    )
$$;
comment on function company_packs_this_period(uuid) is
  'Count of bid packs that count against this company''s monthly allowance - requested, generating OR ready (everything but failed, 0084) - across both pack_generation_jobs.engine values (sanral and general), requested since this company''s current billing period started. Used by company_can_request_pack() - never called to block anything by itself.';

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
begin
  select status, max_packs_per_month into v_status, v_max_packs
    from company_subscriptions where company_id = p_company_id;
  if v_status is null then
    return false;
  end if;
  if v_status = 'trialing' then
    -- 0084: count in-flight (requested/generating) packs too, not only
    -- completed ones - see this migration's header comment.
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
  'The one source of truth for both the trial''s one-pack-total cap and an active plan''s monthly allowance (null max_packs_per_month = unlimited, the enterprise placeholder). Counts in-flight (requested/generating) packs the same as completed ones (0084), not just ready - otherwise the same company could have many packs generating at once, each one bypassing the cap, simply by requesting faster than a worker finishes the first. Called by requestSubmissionPack() (app/tenders/[id]/actions.ts) and requestJob()''s generate_pack path (app/tenders/[id]/general-actions.ts) before inserting a new pack_generation_jobs row - never re-derived in TypeScript.';
