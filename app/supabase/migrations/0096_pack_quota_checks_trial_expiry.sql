-- Fixes a real, reproducible usage-limit bypass in company_can_request_pack()
-- (0083, pack-count fix in 0084): the 'trialing' branch never checked
-- trial_ends_at at all, only whether the company's one lifetime trial pack
-- had already been used.
--
-- lib/billing.ts's own effectiveSubscriptionStatus() already documents that
-- a stored 'trialing' status does NOT flip to 'past_due' by itself the
-- moment trial_ends_at passes - "nothing in this app runs a clock-driven job
-- to rewrite it" - and treats a lapsed trial as effectively past_due for
-- every UI purpose (the banner, isSubscriptionLapsed()). This SQL gate never
-- made that same adjustment, so it disagreed with the UI: a company whose
-- 14-day trial ended weeks or months ago, who never paid and never used
-- their one free pack, could still request it - indefinitely, with no time
-- limit - simply because the stored status column never changes on its own.
--
-- Reproduced live against a real local Postgres running every migration
-- through 0095 (not a mock, not a hypothetical, same standard 0084's own
-- header comment set): a company with trial_ends_at 30 days in the past and
-- status still literally 'trialing' got company_can_request_pack() = true.
--
-- Fix: mirror effectiveSubscriptionStatus()'s own rule in SQL - a 'trialing'
-- company whose trial_ends_at has passed is treated as lapsed (no pack),
-- same as it already reads on screen. A still-current trial is unaffected.
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
  select status, max_packs_per_month, trial_ends_at into v_status, v_max_packs, v_trial_ends_at
    from company_subscriptions where company_id = p_company_id;
  if v_status is null then
    return false;
  end if;
  if v_status = 'trialing' then
    -- 0096: a trial whose own end date has already passed is effectively
    -- past_due (app/lib/billing.ts's effectiveSubscriptionStatus()) even
    -- though nothing ever rewrites the stored status column - this gate now
    -- agrees with what the UI already shows instead of granting a free pack
    -- with no time limit.
    if v_trial_ends_at is not null and v_trial_ends_at < now() then
      return false;
    end if;
    -- 0084: count in-flight (requested/generating) packs too, not only
    -- completed ones - see that migration's header comment.
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
  'The one source of truth for both the trial''s one-pack-total cap and an active plan''s monthly allowance (null max_packs_per_month = unlimited, the enterprise placeholder). A trialing company past its own trial_ends_at is treated as lapsed, same as app/lib/billing.ts''s effectiveSubscriptionStatus() already shows on screen (0096) - the stored status column itself never flips on its own. Counts in-flight (requested/generating) packs the same as completed ones (0084). Called by requestSubmissionPack() (app/tenders/[id]/actions.ts) and requestJob()''s generate_pack path (app/tenders/[id]/general-actions.ts) before inserting a new pack_generation_jobs row - never re-derived in TypeScript.';
