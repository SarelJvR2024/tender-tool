-- Tender task/deadline timeline (spec: "Document expiry reminders, and a tender
-- task/deadline timeline (Sarel, 2026-10-16)", item 8 in the feature list).
--
-- Lives at the tender level, alongside the readiness report on
-- app/app/tenders/[id]/page.tsx - not a separate page (explicit spec
-- requirement). Two kinds of row, same table, same shape:
--   - Standard milestones: closing/briefing/clarification/submission. Only
--     "closing" is auto-seeded today, because closing_date is the only one of
--     the four whose date is already captured anywhere (tenders.closing_date).
--     Briefing/clarification/submission dates are NOT captured elsewhere yet -
--     assess_tender.py's signal extraction currently only detects that a
--     compulsory briefing is *mentioned*, not its actual date (see spec) - so
--     those three stay available as plain manual entries (kind left null,
--     same free-text form as any other task) until that extraction is built.
--   - Manual tasks: free-text description + due date, genuinely unconstrained -
--     explicit spec requirement: "this must NOT be a fixed enum of anticipated
--     task types". `kind` is nullable and only ever set by the auto-seed path
--     for now; the UI's manual "add task" form never sets it.
--
-- Reminder delivery reuses the same one-way pattern as document-expiry
-- reminders (engine/compliance/watch_deadlines.py) and the existing
-- tender-watch email - see that script's docstring. No second notification
-- mechanism is built here.
create table tender_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  description text not null,
  due_date date,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'done')),
  -- Standard-milestone tag, kept deliberately small and closed (unlike the
  -- free-text description) because it only ever drives the auto-seed/badge
  -- logic, never a type the user picks from - see header comment.
  kind text check (kind in ('closing', 'briefing', 'clarification', 'submission')),
  is_standard boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table tender_tasks is
  'Per-company task/milestone list for a tender - standard milestones (kind set, is_standard true) plus genuinely free-text manual tasks (kind null). Tenant-scoped like tender_packs, not shared like tenders itself.';

-- One auto-seeded row per (company, tender, kind) - lets the page safely
-- upsert-with-ignore-duplicates the closing milestone on every view instead of
-- select-then-insert (avoids a race between concurrent requests). Manual tasks
-- (kind null) are intentionally excluded from this constraint - NULL is never
-- equal to NULL in a unique index, so multiple manual tasks with no kind are
-- already unconstrained without a partial index; this one is for the kind-set
-- rows only, where "where kind is not null" would be redundant given that
-- behaviour but is kept for clarity and to guard against a future NOT NULL
-- default change.
create unique index tender_tasks_standard_kind_idx
  on tender_tasks (company_id, tender_id, kind)
  where kind is not null;

create index tender_tasks_tender_idx on tender_tasks (tender_id, due_date);
create index tender_tasks_due_idx on tender_tasks (due_date) where status <> 'done';

alter table tender_tasks enable row level security;

create policy "tender_tasks: tenant isolation" on tender_tasks
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

create trigger tender_tasks_set_updated_at before update on tender_tasks
  for each row execute function set_updated_at();
