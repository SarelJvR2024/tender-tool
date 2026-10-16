-- Assign a responsible person to a tender task/milestone row (Sarel, in his
-- own words: "we need to be able to assign specific people to each of the
-- steps in the flow, so that we know who's going to be responsible for each
-- of the steps").
--
-- References people(id), NOT company_members. Read both schemas before
-- deciding: company_members only links an auth.users account to a company
-- (id, company_id, user_id, role) - it has no display name, and
-- 0010_add_tender_workflow_role.sql's own check-in note confirms there is
-- still zero UI surface on company_members today, not even a list. people
-- (0001_init_schema.sql) is the table with an actual name/role per person,
-- and app/app/people/page.tsx is already titled "People / CV Library" and
-- described in this project's own build task as "how the company's
-- people/team members are listed" - i.e. the real roster of people who can
-- be made responsible for something, independent of whether that person has
-- a login. That page's existing list is reused as-is for the assignee
-- dropdown; no new roster page is built here.
--
-- Nullable (an un-assigned task is the default/common case, same as
-- due_date) and ON DELETE SET NULL, not CASCADE - deleting a person from the
-- People / CV Library should never silently delete a task/milestone that
-- happens to reference them.
alter table tender_tasks
  add column assigned_to uuid references people(id) on delete set null;

comment on column tender_tasks.assigned_to is
  'The company''s own person (people.id - see app/app/people/page.tsx) responsible for this task/milestone. Nullable - most tasks start unassigned. Deliberately NOT company_members: that table has no display name and no UI surface (see 0010''s own check-in note).';

create index tender_tasks_assigned_to_idx on tender_tasks (assigned_to) where assigned_to is not null;
