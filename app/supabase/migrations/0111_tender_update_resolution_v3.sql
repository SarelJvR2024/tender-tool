-- Second companion to 0105/0106: Finding 111/112 (a sibling standing QA pass,
-- 2026-10-31) found accept_tender_update_date()'s own IN clauses (0106)
-- never widened for 'briefing_shortlisted' - the same stage-split gap 0106
-- itself was written to close for 'assessing'/'building', just the one
-- stage 0106 was written one pass too early to include. A tender at
-- briefing_shortlisted is awaiting an outcome exactly like 'submitted'
-- already is (which these two checks correctly keep) - without this, a
-- company whose pack reached briefing_shortlisted silently lost the
-- ability to accept a buyer's date change or get an auto-seeded briefing
-- task, the identical symptom 0106 fixed for assessing/building.
--
-- Paired with the app-side fix in the same commit: app/app/tenders/[id]/
-- tender-updates.tsx's own ACTIVE_STAGES (gates whether the "Accept"
-- button even renders) is widened for briefing_shortlisted in that same
-- commit, not a separate one - landing either side alone would be worse
-- than the current gap: the button showing with no server-side acceptance
-- (TS alone) is a visible failure, worse than today's silent omission.
--
-- Applying this migration needs the same SQL-Editor path as 0105/0106 - no
-- DDL execution exists from this session.
begin;

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

  -- Only a company working on this tender (the same companies the watch
  -- alerts: tender_packs at found / assessing / building / submitted /
  -- briefing_shortlisted - plus the pre-0105 legacy 'bidding', see 0106's
  -- own header) can move its dates.
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
    -- The document's own time; else the time of day already on file (a
    -- deadline's hour rarely moves with its day); else 12:00.
    v_time := coalesce(v_c ->> 'time',
                       to_char(v_tender.closing_date at time zone 'Africa/Johannesburg', 'HH24:MI'),
                       '12:00');
    v_new := (v_day::text || 'T' || v_time || ':00+02:00')::timestamptz;
    -- = watch_tender_updates.apply_closing_date()
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
    -- = watch_tender_updates.apply_briefing_date()
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

comment on function accept_tender_update_date(uuid, text) is
  'Accepts a tender-update-watch date change onto the live tender (0048; pipeline_stage set widened by 0106 for the 0105 stage split, then by 0111 to add briefing_shortlisted).';

commit;
