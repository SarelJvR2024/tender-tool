-- Security audit finding, 2026-10-31 (follow-up to 0108's lifecycle-token
-- leak, same "SECURITY DEFINER function takes a *_id param, granted to
-- authenticated, no ownership check" shape): company_can_request_pack(uuid)
-- and company_packs_this_period(uuid) (0083) never called
-- is_company_member(p_company_id) - any signed-in user who knew or guessed
-- another company's id could call either directly via
-- rpc("company_can_request_pack", { p_company_id: "<any company's uuid>" })
-- and learn that company's real billing state: whether its trial/plan can
-- still request a bid pack, and (via the second function) exactly how many
-- it has used this billing period - real, private, cross-tenant business
-- data about a competitor's usage. Every other function this session
-- audited with the same shape (bank_account_summaries, acknowledge_
-- discovery_downgrade, set_opportunity_interest/tag, pursue_discovered_
-- opportunity, record_tender_document, is_employee_in_company,
-- own_linked_person_id, tender_folder_readable, tt_has_own_requirements,
-- tt_template_object_readable, every platform_admin_* function sampled)
-- already gates correctly - these two were the one gap.
--
-- Reproduced in a disposable scratch database (not this app's live DB,
-- dropped after use): a second company's own signed-in member could read
-- the first company's real can-request-pack boolean and real monthly pack
-- count. Re-ran after adding the guard below - the same caller now gets
-- null from both, while the real company's own member still gets the
-- correct, unchanged answer (checked trialing-with-0, trialing-with-1,
-- active-under-quota, and active-over-quota - all four unaffected).
--
-- Fixed by returning null (not false/0, which would be indistinguishable
-- from a real, legitimate answer) for a caller who isn't a member of
-- p_company_id - same "give nothing, not a wrong-but-plausible value"
-- choice already made for the three real call sites (requestSubmissionPack/
-- requestJob/[id]/general-actions.ts, app/app/billing/page.tsx), which only
-- ever pass the caller's own companyId and so never see this new null path
-- in real use. create or replace function, same pattern 0105/0107/0108 used
-- to replace a 0083 function body whole.

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
      and status = 'ready'
      and requested_at >= (
        select coalesce(current_period_start, created_at) from company_subscriptions where company_id = p_company_id
      )
  ) else null end;
$$;

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
  if not is_company_member(p_company_id) then
    return null;
  end if;
  select status, max_packs_per_month into v_status, v_max_packs
    from company_subscriptions where company_id = p_company_id;
  if v_status is null then
    return false;
  end if;
  if v_status = 'trialing' then
    return (select count(*) from pack_generation_jobs where company_id = p_company_id and status = 'ready') < 1;
  end if;
  if v_status = 'active' then
    return v_max_packs is null or company_packs_this_period(p_company_id) < v_max_packs;
  end if;
  return false;
end;
$$;

comment on function company_packs_this_period(uuid) is
  'Count of ready bid packs (both pack_generation_jobs.engine values - sanral and general, Sarel''s pricing never gates by engine) requested since this company''s current billing period started. Used by company_can_request_pack() - never called to block anything by itself. Returns null for a caller who is not a member of p_company_id (0109) - was silently answerable for ANY company id before this.';
comment on function company_can_request_pack(uuid) is
  'The one gate requestSubmissionPack()/requestJob() (generate_pack) call before inserting a new pack_generation_jobs row, and the one app/app/billing/page.tsx reads for its own "packs used this period" display. Trialing gets exactly ONE pack total, ever; active gets the plan''s own max_packs_per_month (null = unlimited). Returns null for a caller who is not a member of p_company_id (0109) - was silently answerable for ANY company id before this, leaking another company''s real billing/quota state.';
