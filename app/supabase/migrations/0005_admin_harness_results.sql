-- Admin harness results (spec item 31's data side - see docs/specs/Tender-Tool-
-- Competitor-Feature-Deep-Dive.md "Admin maintenance console").
--
-- engine/admin_harness.py (spec item 30) already runs every dummy test company
-- through the real tender-filling pipeline and compares the result against a
-- stored baseline, but today that only prints to a terminal. This table is the
-- one new thing needed to make that visible in the web app: one row per
-- (dummy_company, tender) combination, upserted by engine/write_admin_harness_results.py
-- after each harness run.
--
-- Deliberately NOT tenant-scoped like the rest of the schema (see 0001's own
-- comment distinguishing shared/public vs tenant-scoped tables) - this is Sarel's
-- own internal diagnostic over FAKE dummy-company fixtures (config/dummy_companies/),
-- not a per-company tenant feature, so it has no company_id at all.

create table admin_harness_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  dummy_company text not null,
  tender_ref text not null,
  status text not null check (status in ('ok', 'flagged')),
  summary jsonb not null default '{}'::jsonb, -- the {counts, sig} shape admin_harness.py already computes
  details text, -- human-readable explanation (e.g. which fields changed status), same text the CLI prints
  unique (dummy_company, tender_ref)
);
comment on table admin_harness_runs is
  'One row per (dummy_company, tender_ref), upserted after each run of engine/admin_harness.py via engine/write_admin_harness_results.py. Internal diagnostic for Sarel only, not a tenant feature - no company_id. Read by app/app/admin/page.tsx.';

alter table admin_harness_runs enable row level security;

-- Readable only by a company owner (any company - this tool predates and sits
-- outside the tenant model, but "owner" is the closest existing proxy for "trusted
-- admin" without inventing a whole separate auth concept for one internal page).
-- No insert/update/delete policy for authenticated users at all: every write comes
-- from write_admin_harness_results.py using the service role key, which bypasses
-- RLS entirely - same pattern as seed_supabase_company.py.
create policy "admin_harness_runs: owners can select" on admin_harness_runs
  for select to authenticated using (
    exists (select 1 from company_members where user_id = auth.uid() and role = 'owner')
  );
