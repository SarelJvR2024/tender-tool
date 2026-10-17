-- Tender Workspace: a plain internal note thread per tender, plus the one
-- lookup the activity log needs to say WHO did something.
--
-- Feature list item 15 ("Team roles, comments, version history"). Roles were
-- already built (company_members.tender_role, 0010; person_role_eligibility,
-- 0016). This adds comments, kept as small as the master spec's "Scope
-- discipline" section asks: author, time, plain text. No reactions, no
-- @mentions, no rich text, no edit (a wrong note is deleted by its author and
-- written again), no threading - a lightweight internal note thread, not a
-- chat product.
--
-- "Version history" is deliberately NOT a new versioning system. What changes
-- over a tender's life is already recorded with a timestamp, and mostly an
-- actor, on the rows that hold it: tender_tasks (created_by/created_at,
-- updated_at), tender_packs (created_at, confirmed_by/confirmed_at,
-- pipeline_stage/stage_changed_at/submitted_at - 0021), tender_documents
-- (uploaded_by/downloaded_at - 0025), pack_generation_jobs and generated_cvs
-- (requested_by/requested_at/completed_at), tender_answers
-- (answered_by/updated_at). The Tender Workspace's activity log
-- (app/lib/tenderActivity.ts) reads those rows and these comments into one
-- chronological feed; no new history table and no triggers.
--
-- What no table records today is a display name for a user: company_members
-- has only user_id, and auth.users is not readable by the client. So the
-- activity log could say "someone" for every actor. company_member_labels()
-- below returns the e-mail of each member of the caller's own companies,
-- and nothing about anyone else.

create table tender_comments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  -- Nullable only so a removed user's notes survive (shown as "a former
  -- member"); the insert policy pins it to the signed-in user.
  author_id uuid default auth.uid() references auth.users(id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

comment on table tender_comments is
  'Internal plain-text notes on a tender, one company''s own (Tender Workspace "Notes & activity" card). Author + time + body only, by design (spec "Scope discipline"). Read alongside the other tracked tables by app/lib/tenderActivity.ts.';

create index tender_comments_tender_idx on tender_comments (company_id, tender_id, created_at desc);

alter table tender_comments enable row level security;

create policy "tender_comments: members read their company's notes" on tender_comments
  for select to authenticated
  using (is_company_member(company_id));

-- Members write as themselves, on a tender they can see. The tenders
-- subquery runs under tenders' own RLS, so a private tender of another
-- company (0024) can't be commented on even with its id.
create policy "tender_comments: members add notes as themselves" on tender_comments
  for insert to authenticated
  with check (
    is_company_member(company_id)
    and author_id = auth.uid()
    and exists (select 1 from tenders t where t.id = tender_id)
  );

-- No update policy: notes are not edited. Only the author removes one.
create policy "tender_comments: authors delete their own notes" on tender_comments
  for delete to authenticated
  using (is_company_member(company_id) and author_id = auth.uid());

create or replace function company_member_labels()
returns table (user_id uuid, label text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct cm.user_id, coalesce(u.email::text, 'a team member')
  from company_members cm
  join auth.users u on u.id = cm.user_id
  where is_company_member(cm.company_id)
$$;

comment on function company_member_labels() is
  'E-mail address of every member of the signed-in user''s own companies, so the Tender Workspace activity log can name who did what (requested_by / uploaded_by / created_by / author_id). Returns nothing about users outside those companies.';

revoke all on function company_member_labels() from public;
grant execute on function company_member_labels() to authenticated;
