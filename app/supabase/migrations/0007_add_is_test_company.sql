-- A "test company" (see 0006's rename) was never meant to be a disposable
-- fixture concept - the spec's own item-30 text already called for it to be
-- a real row in `companies`, onboarded the same way any real customer would
-- be (through create_company_and_join, 0003_onboarding.sql), just flagged so
-- it never surfaces in customer-facing UI or counts in a customer-facing
-- report. This migration brings the schema in line with that original intent
-- (see docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md's "test-company
-- harness" section) - it does not yet change anything that reads companies.

alter table companies add column is_test_company boolean not null default false;

comment on column companies.is_test_company is
  'True for an internal/non-paying company Sarel onboards himself (through the normal onboarding flow) to use for testing - never surfaced in any customer-facing UI, never counted in a customer-facing report or metric. No UI sets this yet - see docs/specs/System-Status.md for the open follow-up on where that toggle should live, and on engine/admin_harness.py still reading config/test_companies/*.json rather than a real company row.';
