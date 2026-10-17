-- Hardcoded-assumptions audit (Sarel, 2026-10-17: "Dont base limitations and
-- specs only on klipcorps submissions ... there are other tenders and
-- companies which might differ."). Evidence for both changes:
-- docs/specs/Hardcoded-Assumptions-Audit.md.
--
-- 1. experience_items.disciplines (0012) was check-constrained to the 7 keys
--    of engine/discovery/assess_tender.py DISCIPLINE_KEYWORDS. Those 7 are
--    Tender Tool's own keyword buckets for sorting the national eTenders feed,
--    built from the sample of releases looked at - not a published, complete
--    classification of the work companies do. A company whose experience is
--    in, say, geotechnical investigation, environmental assessment or
--    transport planning could not tag it at all. The 7 stay as the suggested
--    set (they are what discovered tenders are categorised into); a company
--    may now add its own discipline tags. Only the format is checked
--    (lower-case slug), so a tag stays usable as a filter key.
--
-- 2. people.employment_status - Form B1's "employment" dropdown (SANRAL's own
--    workbook, all 7 on hand, Conventional and RRM) offers exactly: "No Key
--    Person offered", "Key Person is NOT a full time employee of the
--    tenderer", "Key Person is a full time employee of the tenderer". The pack
--    used to declare EVERY key person a full-time employee (true for
--    Klipcorp's signatory, assumed for everyone else). The two person-level
--    answers are SANRAL's complete list ("No Key Person offered" is a slot
--    state, not a property of a person). Null = not recorded: the pack keeps
--    the old answer and says on its contents page that it is an assumption.

alter table experience_items drop constraint if exists experience_items_disciplines_check;

create or replace function tt_all_slugs(tags text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(t ~ '^[a-z][a-z0-9_]{0,62}$'), true) from unnest(tags) as t;
$$;

alter table experience_items
  add constraint experience_items_disciplines_format check (tt_all_slugs(disciplines));

comment on column experience_items.disciplines is
  'Discipline tags. Suggested set = engine/discovery/assess_tender.py DISCIPLINE_KEYWORDS keys (what discovered tenders are categorised into); companies may add their own lower-case slug tags (0036). Not a closed list.';

alter table people
  add column employment_status text
  check (employment_status in ('full_time_employee', 'not_full_time_employee'));

comment on column people.employment_status is
  'SANRAL Form B1 "employment": full-time employee of the tenderer or not (the workbook''s own two person-level options). Null = not recorded - the pack then keeps "full time employee" and flags it as an assumption.';
