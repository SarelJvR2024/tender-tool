-- Two additive asks from Sarel (2026-10-19):
--
-- A. Submission deadline + bid opening reminders. SA public tenders often
--    have a separate, scheduled bid-opening event (the buyer reads out/
--    records who submitted and sometimes prices) that can land on the same
--    day as closing or days later - and a bid team wants to be reminded about
--    it independently of the closing deadline itself. tender_tasks.kind
--    (0009) already has 'submission' for "submit the tender" as a dated
--    reminder; there is nowhere to tag the opening. Adding 'opening' to the
--    existing kind list is the same shape 0048 already used to widen a check
--    constraint in place (drop by its auto-generated name, re-add with the
--    wider list) - no new table, no new column, same tender_tasks_standard_
--    kind_idx (0009/0048) upsert path the UI's other standard milestones use.
--
-- B. Won & completed projects syncing to each team member's CV-feeding
--    project history. tender_packs.pipeline_stage already reaches 'won'
--    (0021); there is nowhere yet to record what the actual completed
--    project looked like (completion date, final value, a note) once work is
--    done, nor any link from a `projects` row (0001 - the table the People
--    page's CV generation already reads) back to the tender_pack it came
--    from. Three columns on tender_packs (mirroring 0034's submitted_price_
--    zar precision/check style exactly, since that's this codebase's own
--    most recent precedent for "a deal fact on tender_packs"), one column +
--    one partial unique index on projects for idempotent re-sync, and that's
--    it - no new table either side.
--
-- Both are plain additive columns/constraints on existing tables; nothing
-- here is destructive and nothing needs NOT VALID (no new check is added
-- against a column that might already hold violating data - project_completed_
-- at/value/note and source_tender_pack_id are brand-new nullable columns with
-- no existing rows to violate them).

-- ---------------------------------------------------------------------------
-- A. 'opening' as a standard tender_tasks milestone kind
-- ---------------------------------------------------------------------------
alter table tender_tasks drop constraint if exists tender_tasks_kind_check;
alter table tender_tasks
  add constraint tender_tasks_kind_check
    check (kind in ('closing', 'briefing', 'clarification', 'submission', 'opening'));

comment on column tender_tasks.kind is
  'Standard-milestone tag (0009). closing/briefing are auto-seeded from tenders.closing_date/briefing_date; submission and opening are the two the bid team sets by hand from the Tender Workspace''s "Submission & opening" mini-section - submission is "get it in by this deadline", opening is the buyer''s own, sometimes separate, public bid-opening date/time (0065). kind stays null for genuinely free-text manual tasks - never a type the generic "Add a task" form picks from, see 0009''s header comment.';

-- ---------------------------------------------------------------------------
-- B.1 The completed project's own facts, on the WON tender_pack row
-- ---------------------------------------------------------------------------
alter table tender_packs
  add column project_completed_at date,
  add column project_completion_value_rm numeric(16, 2)
    check (project_completion_value_rm is null or project_completion_value_rm >= 0),
  add column project_completion_note text;

comment on column tender_packs.project_completed_at is
  'When the actual, WON project was completed - distinct from stage_changed_at/submitted_at (0021, when the bid itself moved stage) and from submitted_price_zar (0034, the bid price). Set by "Won - record the completed project" on the Tender Workspace; drives syncWonProjectToTeam''s projects.end_date.';
comment on column tender_packs.project_completion_value_rm is
  'The completed project''s actual/final contract value in rand millions (value_rm''s own unit on projects, 0001) - not necessarily submitted_price_zar (0034''s bid price, in rand, VAT treatment tracked separately): a contract can vary in value between bid and completion. Null until recorded.';
comment on column tender_packs.project_completion_note is
  'Free-text note on the completed project (e.g. scope change, variation order, handover detail) - shown alongside the completion summary and carried nowhere else.';

-- ---------------------------------------------------------------------------
-- B.2 Trace a synced projects row back to the tender_pack that generated it
-- ---------------------------------------------------------------------------
alter table projects
  add column source_tender_pack_id uuid references tender_packs(id) on delete set null;

comment on column projects.source_tender_pack_id is
  'Set only by syncWonProjectToTeam (the "Won" card''s auto-sync) - null for every manually-entered project-history row from the People page, which this never touches. Lets a correction (completion value, note) re-run the sync and update the same row instead of creating a duplicate - see projects_source_pack_position_idx.';

-- One synced row per (person, tender_pack, position) - re-running the sync
-- after correcting the completion value/date upserts in place. Manual rows
-- (source_tender_pack_id null) are completely unconstrained by this: NULL
-- is excluded by the WHERE clause, not just distinct-from-NULL semantics,
-- so the People page's own existing project-entry form is unaffected.
create unique index projects_source_pack_position_idx
  on projects (person_id, source_tender_pack_id, position_code)
  where source_tender_pack_id is not null;

-- Cross-tenant integrity (0043): projects already has a tt_check_same_company
-- trigger checking company_id/person_id match. source_tender_pack_id is new
-- surface for the same class of bug that trigger exists to close (a company
-- writing a guessed id belonging to another tenant), so it's checked the
-- same way rather than left to "the Server Action will always pass the right
-- one" - tt_pack_company() (0043) already exists for exactly this lookup.
create or replace function tt_check_same_company()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
begin
  if tg_table_name = 'tender_pack_assignments' then
    v_company := tt_pack_company(new.tender_pack_id);
    if tg_op = 'INSERT' or new.tender_pack_id is distinct from old.tender_pack_id
       or new.suggested_person_id is distinct from old.suggested_person_id then
      if not tt_person_in_company(new.suggested_person_id, v_company) then
        raise exception 'tender_pack_assignments: the person must belong to the same company as the tender pack'
          using errcode = '23514';
      end if;
    end if;
    if tg_op = 'INSERT' or new.tender_pack_id is distinct from old.tender_pack_id
       or new.confirmed_person_id is distinct from old.confirmed_person_id then
      if not tt_person_in_company(new.confirmed_person_id, v_company) then
        raise exception 'tender_pack_assignments: the person must belong to the same company as the tender pack'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  v_company := new.company_id;

  if tg_table_name in ('projects', 'cv_uploads', 'generated_cvs', 'cv_extraction_results', 'person_role_eligibility') then
    if not tt_person_in_company(new.person_id, v_company) then
      raise exception '%: person_id must be a person in the same company', tg_table_name using errcode = '23514';
    end if;
  end if;

  -- 0065: a synced project row's source_tender_pack_id must be this same
  -- company's pack - never another tenant's, guessed or otherwise.
  if tg_table_name = 'projects' and new.source_tender_pack_id is not null then
    if tt_pack_company(new.source_tender_pack_id) is distinct from v_company then
      raise exception 'projects: source_tender_pack_id must be a tender pack belonging to the same company'
        using errcode = '23514';
    end if;
  end if;

  if tg_table_name = 'tender_tasks' then
    if not tt_person_in_company(new.assigned_to, v_company) then
      raise exception 'tender_tasks: assigned_to must be a person in the same company' using errcode = '23514';
    end if;
  end if;

  if tg_table_name = 'cv_extraction_results' then
    if not exists (select 1 from cv_uploads u where u.id = new.cv_upload_id
                   and u.company_id = v_company and u.person_id = new.person_id) then
      raise exception 'cv_extraction_results: the CV upload must be this company''s upload for this person' using errcode = '23514';
    end if;
  end if;

  if tg_table_name in ('generated_cvs', 'pack_generation_jobs') then
    if new.tender_pack_id is not null then
      if not exists (select 1 from tender_packs tp where tp.id = new.tender_pack_id
                     and tp.company_id = v_company and tp.tender_id = new.tender_id) then
        raise exception '%: tender_pack_id must be this company''s pack for this tender', tg_table_name using errcode = '23514';
      end if;
    end if;
  end if;

  if tg_table_name in ('tender_packs', 'tender_tasks', 'tender_answers', 'financial_captures', 'generated_documents',
                       'generated_cvs', 'pack_generation_jobs', 'tender_comments', 'tender_private_documents') then
    if not tt_tender_visible_to(new.tender_id, v_company) then
      raise exception '%: this tender is another company''s private tender', tg_table_name using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tt_same_company on projects;
create trigger tt_same_company before insert or update of company_id, person_id, source_tender_pack_id on projects
  for each row execute function tt_check_same_company();
