-- Fix a severe bug introduced by 0065's edit to tt_check_same_company():
-- `if tg_table_name = 'projects' and new.source_tender_pack_id is not null`
-- combines a table-name check and a column-on-NEW check in one expression.
-- NEW is a dynamically-typed RECORD here - this same trigger function is
-- attached (via separate CREATE TRIGGER statements, 0043) to a dozen other
-- tables that have no source_tender_pack_id column at all (cv_uploads,
-- tender_tasks, tender_answers, financial_captures, ...). Postgres resolves
-- `new.source_tender_pack_id` against the row's actual composite type while
-- validating the combined expression, which throws "record \"new\" has no
-- field \"source_tender_pack_id\"" for every one of those tables, regardless
-- of the left-hand `tg_table_name = 'projects'` being false - confirmed by
-- running engine/security/test_tenant_isolation.py's Part 2 (DB-backed)
-- seed_db() against a scratch Postgres replay of 0001-0065, which crashed on
-- the very first INSERT into a non-projects table sharing this trigger.
--
-- Fix: the same nested-IF pattern this function already uses correctly for
-- every other table-specific field check (e.g. the generated_cvs/
-- pack_generation_jobs block just below it) - the inner `new.field` access
-- only ever executes once the outer tg_table_name check has already
-- selected 'projects', so it's never evaluated against another table's row.
--
-- 0065's own DDL (the new columns, the check constraint, the index, the
-- CREATE TRIGGER) applied cleanly - only this function's runtime behavior is
-- broken, so this is a new migration rather than an edit to 0065, per this
-- project's standing rule against editing an already-possibly-deployed
-- migration file in place.
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
  -- company's pack - never another tenant's, guessed or otherwise. Nested
  -- IF (0066), not a combined condition: see this file's header.
  if tg_table_name = 'projects' then
    if new.source_tender_pack_id is not null then
      if tt_pack_company(new.source_tender_pack_id) is distinct from v_company then
        raise exception 'projects: source_tender_pack_id must be a tender pack belonging to the same company'
          using errcode = '23514';
      end if;
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
