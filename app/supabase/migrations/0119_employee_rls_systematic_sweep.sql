-- Systematic employee-RLS sweep (Sarel's own review track, 2026-11-06),
-- following directly from 0117 (company_subscriptions/company_members) and
-- 0118 (company_tender_preferences) - both found by spot-checking tables
-- created after 0077's own sweep. This migration is the SYSTEMATIC version
-- that spot-checking was told to become.
--
-- Part A: the mechanical table-level check. Enumerated every table with RLS
-- enabled whose own PERMISSIVE policy grants on is_company_member(company_id)
-- (or an equivalent company-membership check), then subtracted every table
-- already covered by an is_employee_in_company()-style RESTRICTIVE policy.
-- Reproducible exactly:
--
--   select distinct tablename from pg_policies
--   where schemaname='public' and permissive='PERMISSIVE'
--     and (qual ilike '%is_company_member%' or with_check ilike '%is_company_member%')
--     and tablename not in (
--       select distinct tablename from pg_policies where schemaname='public' and permissive='RESTRICTIVE'
--     )
--   order by 1;
--
-- Result against all 108 migrations through 0118: exactly 3 tables -
-- savings_counted_steps, tender_documents, tender_requirements. All 3
-- checked individually, not assumed:
--   * savings_counted_steps: already investigated by 0118's own pass and
--     correctly left alone - it powers Home (/dashboard), one of an
--     employee's two allowed pages (EMPLOYEE_NAV_ITEMS). Re-confirmed, no
--     change.
--   * tender_documents / tender_requirements: both LOOK like the same gap
--     shape at first read (a bare is_company_member(company_id) branch,
--     added by 0045 for each company's own private template-copy/
--     requirement-override rows), and 0077's own Part D comment exempted
--     both with reasoning that turns out to be imprecise ("already readable
--     by authenticated users for EVERYONE... unaffected by any role") - but
--     checking the ACTUAL policy text (not the comment) shows both policies
--     also require `exists (select 1 from tenders t where t.id = ... and
--     (t.owner_company_id is null or is_company_member(t.owner_company_id)))`
--     - a plain, non-security-definer subquery against `tenders`, which
--     therefore runs under ITS OWN RLS, including `tenders`' own blanket
--     "employee has no access" RESTRICTIVE policy (0077 Part C) that hides
--     EVERY tenders row - shared or private - from anyone whose role is
--     'employee' in ANY company. That EXISTS clause can never be true for
--     an employee, so both tables transitively return zero rows regardless
--     of their own company_id - genuinely clean, confirmed live, not
--     reasoned from the text alone:
--
--   Scratch DB (service postgresql start; replay_schema.sh -d scratch_sweep,
--   all 108 migrations incl. 0118): one company, one owner, one employee,
--   one tender (owner_company_id = that company), one tender_packs row, one
--   tender_documents row (company_id = that company) and one
--   tender_requirements row (company_id = that company). As the employee
--   (set role authenticated; select set_config('test.uid', '<employee>', false)):
--     select ... from tenders where id = '<tender>'          -> 0 rows
--     select ... from tender_documents where tender_id = ...  -> 0 rows
--     select ... from tender_requirements where tender_id = ... -> 0 rows
--     select ... from tender_packs where tender_id = ...      -> 0 rows (already covered)
--   As owner: all four return the real row (unaffected). No fix needed for
--   any of the 3 candidate tables - the systematic check's own result is
--   "clean", and is now the mechanically-reproducible record of why.
--
-- Part B: while judging reachability/impact of the clean Part A candidates
-- (per the task's own "check the real app-layer callers" step), traced
-- which pages actually reach /tenders/[id] for an employee. nav-items.ts's
-- own isNavItemActive() treats "/tenders/*" as a drill-down FROM Home - and
-- Home (one of an employee's two allowed pages) genuinely links into
-- /tenders/[id] via its dispatch/command-center cards (components/tt/
-- command-center.tsx). AppShell.tsx's isEmployee only swaps the nav list and
-- the subscription banner - it never gates page content, so /tenders/[id]'s
-- own full page (compliance report, pack review, pricing, tasks, comments,
-- documents - everything 0077's own header says an employee should have
-- "nothing about") genuinely renders for an employee who follows that link,
-- same "nav hides it but nothing blocks the page" shape 0117/0118 already
-- found for /billing and /pipeline+/discovery.
--
-- That line of checking found a DIFFERENT, more serious class of the same
-- underlying problem: several SECURITY DEFINER RPCs re-implement the same
-- reads/writes 0077's RESTRICTIVE policies already cover on the underlying
-- tables, but check only is_company_member(...) (never role), and because
-- they are SECURITY DEFINER they run as the function owner and bypass ALL
-- table RLS, RESTRICTIVE policies included - the exact "a SELECT-side
-- RESTRICTIVE policy does nothing to stop a SECURITY DEFINER function's own
-- blind write" risk 0117's own header already named for start_payfast_checkout,
-- just never swept for siblings. Checked every client-reachable SECURITY
-- DEFINER function (every name this app's own `supabase.rpc(...)` calls
-- name) against the tables 0077/0117/0118 already made RESTRICTIVE-only for
-- 'employee', for a role check inside the function body. Found 12 with none,
-- reproduced every single one individually as the employee role in the same
-- scratch DB (company/owner/employee seeded as above; superuser reads confirm
-- the real row state after each, exactly like 0117/0118's own repro style):
--
--  1. bank_account_summaries(p_company) - bank_accounts' own RESTRICTIVE
--     policy (0077) exists specifically because 0077's header lists "bank
--     details" by name as off-limits to 'employee'. This function reads the
--     table directly with only is_company_member(), bypassing that policy
--     entirely. RED: as the employee, returned the real row - bank_name
--     'FNB', account_holder 'Test Co (Pty) Ltd', last4 '7890'.
--  2. company_member_labels() - company_members' own RESTRICTIVE policy
--     (0117) already narrows a plain table read to the caller's own row,
--     specifically because 0117 found an employee could otherwise read
--     every teammate's row. This function bypasses that fix entirely and
--     returns every member's real email address, called unconditionally
--     from app/tenders/[id]/activity-log.tsx and tender-updates.tsx (both on
--     the employee-reachable tender page). RED: as the employee, returned
--     BOTH company_members rows with their real emails
--     (owner@test.com, employee@test.com).
--  3. tender_document_uploads(p_tender_id) - re-implements the same
--     doc-upload-metadata read Part A proved is transitively blocked for a
--     direct table read, but as its own SECURITY DEFINER join against
--     `tenders`/`tender_documents` with no RLS and no role check. RED: as
--     the employee, returned the real row (doc_type 'technical_xlsm',
--     source 'own') for the company's own tender.
--  4. pursue_discovered_opportunity(p_opportunity_id) - "prepare this
--     tender" from a discovered opportunity (app/discovery/actions.ts). No
--     role check at all. RED: as the employee, succeeded and created a real
--     `tenders` row, a real `tender_packs` row for the whole company
--     (pipeline_stage 'found' - now in the company's shared Bid Pipeline
--     board for every member) and queued a real `extract_requirements`
--     engine job (requested_by = the employee's own uid) - confirmed by a
--     superuser read of all three tables after the call.
--  5. load_manual_tender(...) - "load a tender manually"
--     (app/tenders/new/actions.ts). Same shape as #4: creates `tenders` +
--     `tender_packs` + a queued engine job for the whole company. RED: as
--     the employee, succeeded, returning a new tender id; superuser read
--     confirmed the tender/pack/job rows were real.
--  6. add_manual_tender_documents(...) - adds documents to an EXISTING
--     manual tender and re-queues extract_requirements. RED: as the
--     employee, succeeded against the tender #5 had just created.
--  7. request_submission_pack_checked(...) - the SANRAL submission-pack
--     request RPC (app/tenders/[id]/actions.ts requestSubmissionPack()).
--     pack_generation_jobs' own RESTRICTIVE policy (0077) says 'employee'
--     has no access, but this function inserts into it directly with only
--     is_company_member(). RED: as the employee, succeeded, returning a
--     real job id, consuming the company's trial pack quota.
--  8. request_general_job_checked(...) - sibling of #7 for the general
--     (non-SANRAL) pack flow. Same shape, same fix. RED: as the employee,
--     succeeded, returning a real job id.
--  9. set_opportunity_interest(p_opportunity_id, p_marker) - RED: as the
--     employee, succeeded; superuser read confirmed interest_marker/
--     interest_marked_by were genuinely set to the employee's own choice/uid
--     for the whole company's discovered_opportunities row.
-- 10. set_opportunity_tag(p_opportunity_id, p_tag, p_action) - RED: as the
--     employee, succeeded; superuser read confirmed company_tags was
--     genuinely appended.
-- 11. acknowledge_discovery_downgrade(p_opportunity_id) - lower-severity
--     (a "mark as seen" flag) but same shape and same table. Verified by the
--     ERROR TYPE it raises rather than full business-state reproduction:
--     pre-fix, calling it as the employee against an opportunity with no
--     downgrade on file raises "This tender has not been re-assessed..." -
--     i.e. it gets past every check into the function's own business logic
--     with no role rejection anywhere. Post-fix (below), the same call for
--     an opportunity belonging to the employee's own company raises the new
--     role-specific error FIRST, before that business check is ever reached
--     - proving the new guard fires unconditionally for 'employee', not
--     only when the pre-existing business state happens to allow it.
-- 12. accept_tender_update_date(p_watched_document_id, p_change) - resolves
--     "the company working on this tender" (v_company) by joining
--     company_members to tender_packs with no role filter, then writes the
--     shared `tenders` row's closing_date/briefing_date and the company's
--     own tender_tasks - both already RESTRICTIVE-covered at the table
--     level (tenders: all roles via the role-based policy; tender_tasks:
--     0077 Part D) but bypassed here the same way as every function above.
--
-- Fixed all 12 the same additive, narrow-only way 0117 already did for
-- start_payfast_checkout ("checked here, not left to RLS alone, because this
-- function ... never read back a row RLS could have hidden first"): one
-- `is_employee_in_company(...)` guard added near the top of each function
-- body (or folded into the SQL-language ones' own WHERE clause), raising a
-- friendly 42501 error instead of proceeding. For owner/admin/member,
-- is_employee_in_company() is false, so every guard is unconditionally
-- skipped and their behaviour is completely unchanged - verified below,
-- individually, not assumed.
--
-- NOT touched by this migration (checked, not a gap): create_company_invite_checked,
-- remove_member_checked, set_member_role_checked (all use tt_is_company_admin(),
-- already admin-only, employee excluded); set_my_daily_digest_opt_in (writes
-- only `where user_id = auth.uid()` - the caller's own row, never another
-- member's); create_company_and_join (company/role creation itself - no
-- existing role to bypass); every platform_admin_* function (gated by
-- is_platform_admin(), unrelated to company role); the other tt_*_check
-- trigger-constraint helpers (not client-callable RPCs - they run inside a
-- trigger already firing under the write's own RLS).

-- ---------------------------------------------------------------------------
-- 1. bank_account_summaries
-- ---------------------------------------------------------------------------
create or replace function bank_account_summaries(p_company uuid)
returns table (id uuid, principal_id uuid, bank_name text, account_holder text, account_type text, last4 text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.principal_id, b.bank_name, b.account_holder, b.account_type, right(b.account_number, 4)
  from bank_accounts b
  where b.company_id = p_company and is_company_member(p_company) and not is_employee_in_company(p_company);
$$;

-- ---------------------------------------------------------------------------
-- 2. company_member_labels
-- ---------------------------------------------------------------------------
create or replace function company_member_labels()
returns table (user_id uuid, label text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct cm.user_id, coalesce(u.email::text, 'a team member')
  from company_members cm
  join auth.users u on u.id = cm.user_id
  where (is_company_member(cm.company_id) and not is_employee_in_company(cm.company_id))
     -- The engine (service-role key): every member, so its reports can name
     -- people. Same claim auth.role() reads on Supabase.
     or coalesce(current_setting('request.jwt.claim.role', true),
                 nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role'
$$;

-- ---------------------------------------------------------------------------
-- 3. tender_document_uploads
-- ---------------------------------------------------------------------------
create or replace function tender_document_uploads(p_tender_id uuid)
returns table (doc_type text, downloaded_at timestamptz, source text, uploaded_by uuid, original_filename text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Per type: the caller's own copy if it has one (that is what its pack
  -- uses), else the shared one from the buyer's published documents.
  select distinct on (d.doc_type)
         d.doc_type, d.downloaded_at,
         case when d.company_id is null then 'buyer' else 'own' end,
         d.uploaded_by, d.original_filename
  from tender_documents d
  join tenders t on t.id = d.tender_id
  where d.tender_id = p_tender_id
    and (t.owner_company_id is null or is_company_member(t.owner_company_id))
    and (d.company_id is null or is_company_member(d.company_id))
    and not exists (select 1 from company_members cm where cm.user_id = auth.uid() and cm.role = 'employee')
  order by d.doc_type, d.company_id nulls last;
$$;

-- ---------------------------------------------------------------------------
-- 4. pursue_discovered_opportunity
-- ---------------------------------------------------------------------------
create or replace function pursue_discovered_opportunity(p_opportunity_id uuid)
returns uuid
language plpgsql
security definer
-- 0043 hardened this function's search_path to (public, pg_temp); kept.
set search_path = public, pg_temp
as $$
declare
  opp discovered_opportunities%rowtype;
  t_id uuid;
  rules jsonb;
begin
  select * into opp from discovered_opportunities where id = p_opportunity_id;
  if not found or not is_company_member(opp.company_id) then
    raise exception 'opportunity not found' using errcode = 'P0002';
  end if;
  if is_employee_in_company(opp.company_id) then
    raise exception 'Preparing a tender is managed by your company''s owner, admin or member - not the employee role.' using errcode = '42501';
  end if;
  if opp.tender_id is not null and exists (select 1 from tenders where id = opp.tender_id) then
    return opp.tender_id;
  end if;

  if opp.score_outlook ? 'experience_evidence' then
    rules := jsonb_build_object(
      'experience_evidence', opp.score_outlook -> 'experience_evidence',
      'locality', jsonb_build_object(
        'rows', coalesce(opp.score_outlook -> 'locality' -> 'rows', '[]'::jsonb),
        'mandatory_local_office', opp.score_outlook -> 'locality' -> 'mandatory_local_office'),
      'source_document', 'discovery outlook (first readable document)',
      'extracted_at', now());
  end if;

  insert into tenders (slug, contract_no, title, description, closing_date, family, status,
                       buyer, ocid, source, document_urls, evaluation_rules)
  values (coalesce(opp.ocid, 'opportunity-' || opp.id::text),
          coalesce(opp.contract_number, opp.title),
          opp.title,
          coalesce(opp.description, opp.title),
          opp.closing_date,
          'General (non-SANRAL)',
          case when opp.closing_date is not null and opp.closing_date < now() then 'closed' else 'open' end,
          opp.buyer,
          case when opp.ocid like 'ocds-%' then opp.ocid end,
          'etenders_ocds', opp.document_urls, rules)
  on conflict (slug) do update set last_seen_at = now()
  returning id into t_id;

  update discovered_opportunities set tender_id = t_id where id = opp.id;

  insert into tender_packs (company_id, tender_id)
  values (opp.company_id, t_id)
  on conflict (company_id, tender_id) do nothing;

  if not exists (select 1 from tenders where id = t_id and document_requirements is not null) then
    insert into tender_engine_jobs (company_id, tender_id, tender_pack_id, kind, requested_by)
    select opp.company_id, t_id, tp.id, 'extract_requirements', auth.uid()
    from tender_packs tp where tp.company_id = opp.company_id and tp.tender_id = t_id
    on conflict (company_id, tender_id, engine, kind) where status in ('requested', 'generating') do nothing;
  end if;

  return t_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. load_manual_tender
-- ---------------------------------------------------------------------------
create or replace function load_manual_tender(
  p_company_id uuid, p_tender_id uuid, p_title text, p_buyer text, p_reference text,
  p_ocid text, p_closing_date timestamptz, p_documents jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  docs jsonb;
  existing uuid;
  pack_id uuid;
begin
  if not is_company_member(p_company_id) then
    raise exception 'not a member of this company' using errcode = '42501';
  end if;
  if is_employee_in_company(p_company_id) then
    raise exception 'Loading a tender is managed by your company''s owner, admin or member - not the employee role.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'Give the tender a title.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_buyer), '') = '' then
    raise exception 'Say who the buyer is.' using errcode = '22023';
  end if;
  docs := _manual_tender_documents(p_company_id, p_tender_id, p_documents);

  if nullif(btrim(p_ocid), '') is not null then
    select id into existing from tenders where ocid = btrim(p_ocid) and owner_company_id is null;
    if existing is not null then
      raise exception 'Tender % is already in Tender Tool (found by Discovery) - open it from Discovery or the Tenders list and add these documents under "Your private documents": only your company will see them.', btrim(p_ocid)
        using errcode = '23505';
    end if;
    select id into existing from tenders where ocid = btrim(p_ocid) and owner_company_id = p_company_id;
    if existing is not null then
      raise exception 'You already loaded tender % - open it from the Tenders list and use "Add documents and re-analyse".', btrim(p_ocid)
        using errcode = '23505';
    end if;
  end if;

  insert into tenders (id, slug, contract_no, title, description, closing_date, family, status,
                       buyer, ocid, source, document_urls, owner_company_id)
  values (p_tender_id, 'manual-' || p_tender_id::text,
          nullif(btrim(p_reference), ''),
          btrim(p_title), btrim(p_title),
          p_closing_date,
          null,
          case when p_closing_date is not null and p_closing_date < now() then 'closed' else 'open' end,
          btrim(p_buyer), nullif(btrim(p_ocid), ''), 'manual', docs, p_company_id);

  insert into tender_packs (company_id, tender_id) values (p_company_id, p_tender_id)
  returning id into pack_id;

  insert into tender_engine_jobs (company_id, tender_id, tender_pack_id, kind, requested_by)
  values (p_company_id, p_tender_id, pack_id, 'extract_requirements', auth.uid());

  return p_tender_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. add_manual_tender_documents
-- ---------------------------------------------------------------------------
create or replace function add_manual_tender_documents(p_tender_id uuid, p_documents jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t tenders%rowtype;
  docs jsonb;
  pack_id uuid;
begin
  select * into t from tenders where id = p_tender_id;
  if not found or t.source <> 'manual' or not is_company_member(t.owner_company_id) then
    raise exception 'tender not found' using errcode = 'P0002';
  end if;
  if is_employee_in_company(t.owner_company_id) then
    raise exception 'Adding tender documents is managed by your company''s owner, admin or member - not the employee role.' using errcode = '42501';
  end if;
  docs := _manual_tender_documents(t.owner_company_id, p_tender_id, p_documents);
  update tenders set document_urls = document_urls || docs, last_seen_at = now() where id = p_tender_id;
  select id into pack_id from tender_packs where company_id = t.owner_company_id and tender_id = p_tender_id;
  insert into tender_engine_jobs (company_id, tender_id, tender_pack_id, kind, requested_by)
  values (t.owner_company_id, p_tender_id, pack_id, 'extract_requirements', auth.uid())
  on conflict (company_id, tender_id, engine, kind) where status in ('requested', 'generating') do nothing;
  return p_tender_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. request_submission_pack_checked
-- ---------------------------------------------------------------------------
create or replace function request_submission_pack_checked(
  p_company_id uuid, p_tender_id uuid, p_tender_pack_id uuid,
  p_readiness_snapshot jsonb, p_acknowledged_gaps boolean,
  p_reviewed_at timestamptz, p_reviewed_by uuid
) returns uuid
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
  if is_employee_in_company(p_company_id) then
    raise exception 'Requesting a submission pack is managed by your company''s owner, admin or member - not the employee role.' using errcode = '42501';
  end if;

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

-- ---------------------------------------------------------------------------
-- 8. request_general_job_checked
-- ---------------------------------------------------------------------------
create or replace function request_general_job_checked(
  p_company_id uuid, p_tender_id uuid, p_tender_pack_id uuid, p_kind text
) returns uuid
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
  if is_employee_in_company(p_company_id) then
    raise exception 'Requesting a pack job is managed by your company''s owner, admin or member - not the employee role.' using errcode = '42501';
  end if;
  if p_kind not in ('generate_pack', 'extract_requirements') then
    raise exception 'unknown job kind %', p_kind using errcode = '22023';
  end if;

  if p_kind = 'generate_pack' then
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

-- ---------------------------------------------------------------------------
-- 9. set_opportunity_interest
-- ---------------------------------------------------------------------------
create or replace function set_opportunity_interest(p_opportunity_id uuid, p_marker text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  opp discovered_opportunities%rowtype;
begin
  select * into opp from discovered_opportunities where id = p_opportunity_id;
  if not found or not is_company_member(opp.company_id) then
    raise exception 'Discovery entry not found.';
  end if;
  if is_employee_in_company(opp.company_id) then
    raise exception 'Marking a discovery entry is managed by your company''s owner, admin or member - not the employee role.' using errcode = '42501';
  end if;
  if p_marker is not null and p_marker not in ('interested', 'declined') then
    raise exception 'Invalid interest marker - must be interested, declined, or null.';
  end if;

  update discovered_opportunities
     set interest_marker = p_marker,
         interest_marked_at = case when p_marker is null then null else now() end,
         interest_marked_by = case when p_marker is null then null else auth.uid() end
   where id = p_opportunity_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. set_opportunity_tag
-- ---------------------------------------------------------------------------
create or replace function set_opportunity_tag(p_opportunity_id uuid, p_tag text, p_action text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  opp discovered_opportunities%rowtype;
  tag text;
begin
  select * into opp from discovered_opportunities where id = p_opportunity_id;
  if not found or not is_company_member(opp.company_id) then
    raise exception 'Discovery entry not found.';
  end if;
  if is_employee_in_company(opp.company_id) then
    raise exception 'Tagging a discovery entry is managed by your company''s owner, admin or member - not the employee role.' using errcode = '42501';
  end if;
  if p_action not in ('add', 'remove') then
    raise exception 'Invalid action - must be add or remove.';
  end if;

  tag := regexp_replace(btrim(lower(p_tag)), '\s+', ' ', 'g');
  if tag = '' then
    raise exception 'Tag cannot be empty.';
  end if;

  if p_action = 'add' then
    if not (tag = any(opp.company_tags)) then
      update discovered_opportunities set company_tags = array_append(opp.company_tags, tag) where id = p_opportunity_id;
    end if;
  else
    update discovered_opportunities set company_tags = array_remove(opp.company_tags, tag) where id = p_opportunity_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. acknowledge_discovery_downgrade
-- ---------------------------------------------------------------------------
create or replace function acknowledge_discovery_downgrade(p_opportunity_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  opp discovered_opportunities%rowtype;
begin
  select * into opp from discovered_opportunities where id = p_opportunity_id;
  if not found or not is_company_member(opp.company_id) then
    raise exception 'Discovery entry not found.';
  end if;
  if is_employee_in_company(opp.company_id) then
    raise exception 'Acknowledging a discovery change is managed by your company''s owner, admin or member - not the employee role.' using errcode = '42501';
  end if;
  if opp.downgraded_from is null then
    raise exception 'This tender has not been re-assessed - nothing to mark as seen.';
  end if;
  update discovered_opportunities
     set downgrade_acknowledged_at = coalesce(downgrade_acknowledged_at, now()),
         downgrade_acknowledged_by = coalesce(downgrade_acknowledged_by, auth.uid())
   where id = p_opportunity_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. accept_tender_update_date
-- ---------------------------------------------------------------------------
create or replace function accept_tender_update_date(p_watched_document_id uuid, p_change text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_doc tender_watched_documents%rowtype;
  v_tender tenders%rowtype;
  v_company uuid;
  v_c jsonb;
  v_day date;
  v_time text;
  v_new timestamptz;
  v_desc text;
begin
  if v_uid is null then
    raise exception 'Sign in to accept a date' using errcode = '42501';
  end if;
  if p_change not in ('closing_date', 'briefing') then
    raise exception 'Unknown change %', p_change using errcode = '22023';
  end if;

  select * into v_doc from tender_watched_documents where id = p_watched_document_id for update;
  if not found or v_doc.baseline then
    raise exception 'No such tender update' using errcode = 'P0002';
  end if;
  select * into v_tender from tenders where id = v_doc.tender_id for update;
  if v_tender.owner_company_id is not null and not is_company_member(v_tender.owner_company_id) then
    raise exception 'No such tender update' using errcode = 'P0002';
  end if;

  select cm.company_id into v_company
  from company_members cm
  join tender_packs p on p.company_id = cm.company_id and p.tender_id = v_tender.id
  where cm.user_id = v_uid and p.pipeline_stage in ('found', 'assessing', 'building', 'bidding', 'submitted', 'briefing_shortlisted')
  order by cm.company_id
  limit 1;
  if v_company is null then
    raise exception 'Only a company working on this tender can accept a date from its documents'
      using errcode = '42501';
  end if;
  if is_employee_in_company(v_company) then
    raise exception 'Accepting a tender update date is managed by your company''s owner, admin or member - not the employee role.' using errcode = '42501';
  end if;

  v_c := v_doc.changes -> p_change;
  if v_c is null or v_c ->> 'date' is null then
    raise exception 'This update states no % date', replace(p_change, '_date', '') using errcode = '22023';
  end if;
  if coalesce((v_c ->> 'applied')::boolean, false) then
    raise exception 'This date has already been applied' using errcode = '22023';
  end if;
  v_day := (v_c ->> 'date')::date;

  if p_change = 'closing_date' then
    if v_tender.closing_date is not null and (v_tender.closing_date at time zone 'Africa/Johannesburg')::date = v_day then
      raise exception 'The closing date on file is already %', v_day using errcode = '22023';
    end if;
    v_time := coalesce(v_c ->> 'time',
                       to_char(v_tender.closing_date at time zone 'Africa/Johannesburg', 'HH24:MI'),
                       '12:00');
    v_new := (v_day::text || 'T' || v_time || ':00+02:00')::timestamptz;
    update tenders set closing_date = v_new where id = v_tender.id;
    update tender_tasks set due_date = v_day where tender_id = v_tender.id and kind = 'closing';
    if v_tender.ocid is not null then
      update discovered_opportunities set closing_date = v_new where ocid = v_tender.ocid;
    end if;
    v_c := v_c || jsonb_build_object('applied', true, 'applied_by', 'person', 'applied_value', v_new,
                                     'on_file_before_accept', v_tender.closing_date,
                                     'time_assumed', (v_c ->> 'time') is null);
  else
    if coalesce((v_c ->> 'cancelled')::boolean, false) then
      raise exception 'The briefing was cancelled, there is no date to accept' using errcode = '22023';
    end if;
    v_time := v_c ->> 'time';
    update tenders set briefing_date = v_day, briefing_time = v_time, briefing_source_document_id = v_doc.id
      where id = v_tender.id;
    v_desc := 'Briefing session' || coalesce(' at ' || v_time, '');
    update tender_tasks set due_date = v_day, description = v_desc where tender_id = v_tender.id and kind = 'briefing';
    insert into tender_tasks (company_id, tender_id, description, due_date, kind, is_standard)
      select distinct p.company_id, v_tender.id, v_desc, v_day, 'briefing', true
      from tender_packs p
      where p.tender_id = v_tender.id and p.pipeline_stage in ('found', 'assessing', 'building', 'bidding', 'submitted', 'briefing_shortlisted')
    on conflict (company_id, tender_id, kind) do nothing;
    v_c := v_c || jsonb_build_object('applied', true, 'applied_by', 'person',
                                     'on_file_before_accept', v_tender.briefing_date);
  end if;

  v_c := v_c || jsonb_build_object('accepted_by', v_uid, 'accepted_by_company', v_company, 'accepted_at', now());
  update tender_watched_documents set changes = jsonb_set(changes, array[p_change], v_c) where id = v_doc.id;
  return v_c;
end;
$$;
