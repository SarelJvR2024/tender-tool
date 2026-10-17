-- Deleting a person or a user account actually works, and leaves nothing of
-- them behind in the database (POPIA s 14 retention, s 24 deletion on
-- request - docs/specs/POPIA-Security-Audit.md, Sarel 2026-10-17).
--
-- Found by reproducing a deletion on a replay of every migration:
--
-- 1. A person ever suggested or confirmed for a key position could not be
--    deleted at all: tender_pack_assignments.suggested_person_id /
--    confirmed_person_id (0001) reference people with the default NO ACTION,
--    so the People page's delete failed with a foreign-key error (and the
--    page didn't say so - the person just stayed). Every pack bridge poll
--    writes suggestions for every person, so in practice this was "nobody on
--    a SANRAL tender can ever be deleted".
-- 2. A user (auth.users - a team member's login and e-mail address) could
--    not be deleted once they had done anything: 15 "who did this" columns
--    (uploaded_by, requested_by, created_by, ...) reference auth.users with
--    NO ACTION. They become null instead, exactly like 0022/0033 already do
--    for reviewed_by / author_id (the activity log shows "a former member").
-- 3. A deleted person's name, years of experience, ECSA level and match
--    rationale stayed in tender_pack_assignments.candidate_scores (0031,
--    jsonb - no foreign key can reach inside it), and their id stayed in
--    tender_answers 'signatory_person_id'. Both are removed by a trigger.
--
-- Files are not rows: a person's uploaded and generated CVs in Storage are
-- removed by the People page's delete action (app/app/people/actions.ts
-- deletePerson) before the row goes - the database cannot delete Storage
-- objects itself (Supabase removes the file only through the Storage API).

-- 1. people references from key-position assignments
alter table tender_pack_assignments
  drop constraint tender_pack_assignments_suggested_person_id_fkey,
  add constraint tender_pack_assignments_suggested_person_id_fkey
    foreign key (suggested_person_id) references people(id) on delete set null,
  drop constraint tender_pack_assignments_confirmed_person_id_fkey,
  add constraint tender_pack_assignments_confirmed_person_id_fkey
    foreign key (confirmed_person_id) references people(id) on delete set null;

-- 2. every NO ACTION reference to auth.users -> set null
do $$
declare
  r record;
begin
  for r in
    select c.conname, c.conrelid::regclass::text as tbl, a.attname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
      and c.confdeltype = 'a' and array_length(c.conkey, 1) = 1
      and c.connamespace = 'public'::regnamespace
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references auth.users(id) on delete set null',
                   r.tbl, r.conname, r.attname);
  end loop;
end $$;

-- 3. what no foreign key can reach
create or replace function tt_forget_person()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update tender_pack_assignments a
     set candidate_scores = (
           select coalesce(jsonb_agg(e order by o), '[]'::jsonb)
           from jsonb_array_elements(a.candidate_scores) with ordinality as x(e, o)
           where e ->> 'person_id' is distinct from old.id::text)
   where a.candidate_scores is not null
     and a.tender_pack_id in (select id from tender_packs where company_id = old.company_id)
     and a.candidate_scores @> jsonb_build_array(jsonb_build_object('person_id', old.id::text));
  delete from tender_answers
   where company_id = old.company_id and field_key = 'signatory_person_id' and value = old.id::text;
  return old;
end;
$$;
revoke all on function tt_forget_person() from public;

create trigger tt_forget_person after delete on people
  for each row execute function tt_forget_person();

-- 4. Data minimisation (POPIA s 10 / s 14): a CV extraction keeps the SA ID
--    number it found (cv_extraction_results.proposed.person.id_number - matched
--    locally, never sent to the AI) only until the review. Once the reviewer
--    saves (it is then on people.id_number, the one controlled place) or
--    discards, the copy in the proposal is dropped - the rest of the proposal
--    stays as the record of what was proposed.
create or replace function tt_drop_reviewed_id_number()
returns trigger
language plpgsql
as $$
begin
  if new.review_status <> 'pending_review' and new.proposed ? 'person'
     and (new.proposed -> 'person') ? 'id_number' then
    new.proposed := jsonb_set(new.proposed, '{person}', (new.proposed -> 'person') - 'id_number');
    new.applied := coalesce(new.applied, '{}'::jsonb) || jsonb_build_object('id_number_copy_removed', true);
  end if;
  return new;
end;
$$;

create trigger tt_drop_reviewed_id_number before update of review_status on cv_extraction_results
  for each row execute function tt_drop_reviewed_id_number();

-- and for rows already reviewed before this migration
update cv_extraction_results
   set proposed = jsonb_set(proposed, '{person}', (proposed -> 'person') - 'id_number')
 where review_status <> 'pending_review' and proposed ? 'person' and (proposed -> 'person') ? 'id_number';
