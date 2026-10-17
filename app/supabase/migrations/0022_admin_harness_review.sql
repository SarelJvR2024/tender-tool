-- Admin review console, the review half of spec item 31 (docs/specs/Tender-Tool-
-- Competitor-Feature-Deep-Dive.md, "Admin side: a test-company harness and
-- review console"): "Sarel clears a flagged run by marking it reviewed, which
-- is the record that this tender/template combination is now trusted for real
-- customers". Before this, admin_harness_runs (0005, renamed by 0006) only held
-- a status + a text detail; the console couldn't show the generated documents
-- or record a review.
--
-- Same NON-tenant-scoped, owner-only convention as 0005 - this is Sarel's
-- internal QA over FAKE test companies (config/test_companies/), so there is
-- still no company_id anywhere here.

-- 1. kind: the form-fill check (admin_harness.py) and the submission-pack check
--    (admin_harness.py --pack) both key their runs "<test_company>__<tender>",
--    so with the old unique (test_company, tender_ref) the pack result for
--    R.396 would overwrite the form-fill result for R.396. They are separate
--    checks producing separate documents, so they get separate rows.
alter table admin_harness_runs
  add column kind text not null default 'forms' check (kind in ('forms', 'pack'));
-- 0005 created this constraint while the column was still dummy_company; 0006's
-- column rename kept the constraint's original name.
alter table admin_harness_runs drop constraint admin_harness_runs_dummy_company_tender_ref_key;
alter table admin_harness_runs
  add constraint admin_harness_runs_test_company_tender_ref_kind_key unique (test_company, tender_ref, kind);

-- 2. artifacts: the generated documents for the run, in the private
--    'admin-harness-artifacts' bucket below. A list of
--    {"label": "...", "path": "<kind>/<test_company>/<tender_ref>/<file>", "content_type": "..."}
--    written by engine/write_admin_harness_results.py (service role). The
--    console renders each PDF inline from a short-lived signed URL.
alter table admin_harness_runs add column artifacts jsonb not null default '[]'::jsonb;

-- 3. Review: reviewed / not reviewed, nothing more (proportionate - one person,
--    one internal tool). reviewed_at null = not reviewed.
alter table admin_harness_runs
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users(id) on delete set null,
  add column review_note text;

comment on table admin_harness_runs is
  'One row per (test_company, tender_ref, kind), upserted after each run of engine/admin_harness.py (kind=forms) and admin_harness.py --pack (kind=pack) via engine/write_admin_harness_results.py. Internal diagnostic for Sarel only, not a tenant feature - no company_id. Read and reviewed at app/app/admin/page.tsx.';
comment on column admin_harness_runs.reviewed_at is
  'Set when Sarel marks this run reviewed in /admin. Cleared automatically (trigger below) when a later harness run produces a different result, so a review only ever vouches for the output that was actually looked at.';

-- A review vouches for one specific result. When the harness re-runs and the
-- result is the same (same status, same baseline summary, and for a flagged run
-- the same explanation of what changed), the review still holds - the harness
-- re-upserts every run on every invocation, and losing the review each time
-- would make it meaningless. When the result differs, the review is cleared.
-- `details` is deliberately not compared for clean runs: it goes from "first
-- run, baseline stored" to "matches baseline" without the output changing.
create or replace function admin_harness_runs_clear_stale_review()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     or new.summary is distinct from old.summary
     or (new.status = 'flagged' and new.details is distinct from old.details) then
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.review_note := null;
  end if;
  return new;
end;
$$;

create trigger admin_harness_runs_clear_stale_review
  before update on admin_harness_runs
  for each row execute function admin_harness_runs_clear_stale_review();

-- Owners (0005's "trusted admin" proxy) may write ONLY the three review
-- columns. The harness result itself (status, summary, details, artifacts)
-- stays service-role-only, as in 0005: column-level privileges, not just RLS,
-- because RLS can't restrict which columns an update touches.
revoke update on admin_harness_runs from authenticated, anon;
grant update (reviewed_at, reviewed_by, review_note) on admin_harness_runs to authenticated;

create policy "admin_harness_runs: owners can record a review" on admin_harness_runs
  for update to authenticated
  using (
    exists (select 1 from company_members where user_id = auth.uid() and role = 'owner')
  )
  with check (
    exists (select 1 from company_members where user_id = auth.uid() and role = 'owner')
    and (reviewed_by is null or reviewed_by = auth.uid())
  );

-- 4. Generated documents bucket: "<kind>/<test_company>/<tender_ref>/<file>".
--    Not tenant-prefixed (there is no tenant) - readable by owners, same rule as
--    the table's select policy; written only by the service role.
insert into storage.buckets (id, name, public)
values ('admin-harness-artifacts', 'admin-harness-artifacts', false)
on conflict (id) do nothing;

create policy "admin-harness-artifacts: owners can read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'admin-harness-artifacts'
    and exists (select 1 from company_members where user_id = auth.uid() and role = 'owner')
  );
