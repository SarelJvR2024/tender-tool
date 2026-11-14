-- Standing solution-architect review, Finding 475 (2026-11-14).
--
-- accept_tender_update_date() (0048, widened by 0106/0111) is the ONE other
-- real writer of tenders.closing_date besides the automatic watch
-- (engine/discovery/watch_tender_updates.py apply_closing_date()) - this
-- function applies a closing-date change a buyer's addendum states but the
-- buyer's own listing does not show (0048's safety rule: never auto-applied,
-- only a person can accept it). When the addendum states a date but no
-- TIME (tender_updates.find_closing_change()'s own _time_from() returns
-- None whenever its regex match captured no time group - a real, common
-- case: many addenda just move "the closing date" without repeating a
-- time) AND there is no closing_date already on file to borrow the time of
-- day from (a brand-new tender, or a manually-loaded one whose own
-- closingDate was left blank - registerManualTender()'s own `closingDate`
-- is documented "may be empty"), this function fell back to a bare
-- literal '12:00'.
--
-- That is a THIRD, disagreeing "closing date with no stated time" default
-- for the identical real-world fact every other source in this engine
-- already agrees is 11:00 SAST, not noon:
--   - engine/discovery/source_http.py's iso_sast_closing() ("a bare date
--     defaults to 11:00 SAST, the standard closing time, same as the
--     General pack compiler's own placeholder") - the shared convention for
--     every date-only closing source (Rand Water, Kouga, Vaal Central
--     Water, Lephalale).
--   - engine/discovery/watch_tender_updates.py's own _sanral_closing()
--     (Finding, 2026-10-29 - its own header comment: "this previously
--     defaulted to noon (12:00) instead - a second, disagreeing 'unknown
--     time' convention for the identical real-world fact ... shown to the
--     customer as if it were a real stated time, never flagged").
--
-- This SQL function was never swept for that exact, already-once-found
-- shape: it still wrote 12:00 for the one case (accepted-from-an-addendum,
-- date-only, nothing on file yet) that fell through its own coalesce()'s
-- first two branches. A person accepting such an update sees a closing
-- deadline one hour later than SANRAL's/every other buyer's own real
-- convention - the exact same silent, unflagged wrongness the 2026-10-29
-- fix closed for the automatic listing-read path, reopened here on the
-- person-accepted path that same migration's own header (0048) says makes
-- "the same writes" as apply_closing_date().
--
-- Fixed by changing the one literal, matching iso_sast_closing()'s own
-- documented convention exactly. No other behaviour of this function
-- changes: a time the document DOES state, or the time already on file,
-- are both still preferred over this default, unchanged.
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
    -- deadline's hour rarely moves with its day); else 11:00 SAST - NOT
    -- 12:00 (Finding 475 above) - the same "no time stated" convention
    -- iso_sast_closing()/_sanral_closing() already use everywhere else.
    v_time := coalesce(v_c ->> 'time',
                       to_char(v_tender.closing_date at time zone 'Africa/Johannesburg', 'HH24:MI'),
                       '11:00');
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
  'Accepts a tender-update-watch date change onto the live tender (0048; pipeline_stage set widened by 0106 for the 0105 stage split, then by 0111 to add briefing_shortlisted; the unstated-time closing default corrected from 12:00 to 11:00 SAST by 0146, Finding 475, matching iso_sast_closing()).';

commit;
