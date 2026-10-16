-- Terminology fix (Sarel, 2026-10-16): "dummy company" -> "test company"
-- throughout. The concept was always a company loaded in for the team to
-- test with, not a fake/placeholder concept, so the name should say that.
-- See docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md items 29-31.

alter table admin_harness_runs rename column dummy_company to test_company;

comment on table admin_harness_runs is
  'One row per (test_company, tender_ref), upserted after each run of engine/admin_harness.py via engine/write_admin_harness_results.py. Internal diagnostic for Sarel only, not a tenant feature - no company_id. Read by app/app/admin/page.tsx.';
