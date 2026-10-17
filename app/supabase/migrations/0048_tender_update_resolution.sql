-- Tender updates (0039), three follow-ups decided by Sarel on 2026-10-17:
--
-- 1. A closing (or briefing) date an addendum states that the buyer's own
--    listing does not show is recorded but never applied automatically (0039's
--    safety rule, unchanged). It can now be ACCEPTED by a person, from the
--    Tender Workspace's "This tender has been updated" card:
--    accept_tender_update_date() below applies the document's date exactly
--    where the watch's automatic path applies it
--    (engine/discovery/watch_tender_updates.py apply_closing_date /
--    apply_briefing_date - same tables, same columns, same rows; the two are
--    kept in step and checked against each other by
--    engine/discovery/test_tender_updates.py Part 3) and records who accepted
--    it, for which company, and when, inside the update's own `changes`
--    (closing_date.accepted_by / accepted_by_company / accepted_at). The
--    Workspace activity log reads it from there.
--
-- 2. A tender's briefing date now has somewhere to live: tenders.briefing_date
--    (+ briefing_time, + the document it came from). Shared per tender like
--    closing_date. The watch writes a moved briefing date there and to every
--    company's own "Briefing session" milestone (tender_tasks kind 'briefing',
--    0009 - until now only ever a manual task, since no briefing date was
--    captured anywhere), creating the milestone for each company actively
--    pursuing the tender; the Workspace auto-seeds it on view from
--    tenders.briefing_date, like the closing milestone.
--
--    The briefing date is applied when the addendum's "original" briefing
--    date matches the one on file (or none is on file): there is no listing
--    field to corroborate it against (eTenders' OCDS release has no briefing
--    field - checked live 2026-10-17 on ocds-9t57fa-174359). When the
--    document's "original" date contradicts the date on file, it is recorded,
--    not applied, and can be accepted by a person like a closing date.
--
--    Also fixes the auto-seed itself: tender_tasks_standard_kind_idx (0009)
--    was a PARTIAL unique index, and Postgres can't use a partial index for
--    `on conflict (company_id, tender_id, kind)` without the predicate, which
--    PostgREST's ?on_conflict= never sends - so ensureClosingMilestone()'s
--    upsert failed with "there is no unique or exclusion constraint matching
--    the ON CONFLICT specification" (its error was not checked, so nothing
--    showed). A full unique index is the same constraint (NULL kinds - manual
--    tasks - are distinct from each other under the default NULLS DISTINCT, as
--    0009's own comment says) and can be inferred.
--
-- 3. company_member_labels() (0033) also answers the service role, so the
--    engine's reports (the tender-update alert report, the daily digest's
--    live roster) name people by e-mail instead of by user id. Signed-in
--    users still get only the members of their own companies.

-- ---------------------------------------------------------------------------
-- 2. Briefing date on the tender
-- ---------------------------------------------------------------------------

alter table tenders
  add column briefing_date date,
  add column briefing_time text check (briefing_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  add column briefing_source_document_id uuid references tender_watched_documents(id) on delete set null;

comment on column tenders.briefing_date is
  'Briefing / site-meeting date as last stated by a buyer''s addendum (engine/discovery/watch_tender_updates.py) or accepted by a person (accept_tender_update_date). Shared per tender like closing_date; copied to each company''s tender_tasks kind ''briefing'' milestone. Null = no briefing date captured (the original tender document''s briefing is not extracted yet).';
comment on column tenders.briefing_source_document_id is
  'The tender_watched_documents row (addendum) the briefing date was read from.';

drop index if exists tender_tasks_standard_kind_idx;
create unique index tender_tasks_standard_kind_idx on tender_tasks (company_id, tender_id, kind);

-- ---------------------------------------------------------------------------
-- 3. Member labels for the service role too
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
  where is_company_member(cm.company_id)
     -- The engine (service-role key): every member, so its reports can name
     -- people. Same claim auth.role() reads on Supabase.
     or coalesce(current_setting('request.jwt.claim.role', true),
                 nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role'
$$;

comment on function company_member_labels() is
  'E-mail address of every member of the signed-in user''s own companies, so the Tender Workspace activity log can name who did what (requested_by / uploaded_by / created_by / author_id). Returns nothing about users outside those companies. Called with the service-role key (engine reports: tender-update alerts, daily digest), it returns every member (0048).';

revoke all on function company_member_labels() from public;
grant execute on function company_member_labels() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. A person accepts a document's date
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

  -- Only a company working on this tender (the same companies the watch
  -- alerts: tender_packs at found / bidding / submitted) can move its dates.
  select cm.company_id into v_company
  from company_members cm
  join tender_packs p on p.company_id = cm.company_id and p.tender_id = v_tender.id
  where cm.user_id = v_uid and p.pipeline_stage in ('found', 'bidding', 'submitted')
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
      where p.tender_id = v_tender.id and p.pipeline_stage in ('found', 'bidding', 'submitted')
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
  'Tender Workspace "Accept the document''s date": applies the closing date (p_change ''closing_date'') or briefing date (''briefing'') a tender update states, where the watch''s automatic path would (tenders, every company''s milestone, Discovery rows), and records accepted_by / accepted_by_company / accepted_at in the update''s changes. Callers: a member of a company actively pursuing the tender (tender_packs found/bidding/submitted).';

revoke all on function accept_tender_update_date(uuid, text) from public;
grant execute on function accept_tender_update_date(uuid, text) to authenticated;
