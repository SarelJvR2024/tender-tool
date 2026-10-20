-- Duplicate-request protection for generated_cvs (enterprise-readiness
-- audit, Sarel, 2026-10-20: "make sure it is designed and build to catch
-- all ... scenarios" before onboarding a real company).
--
-- requestTenderCv() (app/app/tenders/[id]/actions.ts) had no uniqueness
-- constraint and no "already pending" check - a signed-in user could submit
-- the same CV request repeatedly (one click or scripted), queueing
-- unlimited generation jobs on a worker pool shared across every company.
-- The app-level fix (a SELECT before the INSERT) handles the ordinary case,
-- but has its own race window between that SELECT and the INSERT; this
-- index is the real backstop, enforced by Postgres itself regardless of
-- how many concurrent requests land at once.
--
-- Scoped to tender-specific CV requests only (tender_pack_id is not null) -
-- the exact shape requestTenderCv() always sets (it refuses to proceed
-- without tender_pack_id/position_code/person_id - that function's own
-- validation). A standard (non-tender) CV request has tender_pack_id null
-- and was never the finding this migration closes; left out of scope
-- deliberately rather than guessing at a different dedupe rule for it.
--
-- format/detail are real, intentional variations (generated_cvs' own
-- comment: "One row per requested generate_cv.py output (format x detail x
-- standard-or-tender-specific)") - a person can legitimately want both a
-- summary and a detailed CV, or both formats, for the same tender position.
-- The index only blocks a second request for the SAME (person, tender pack,
-- position, format, detail) combination while one is already pending -
-- never a genuinely different request.
create unique index generated_cvs_dedupe_pending_idx
  on generated_cvs (person_id, tender_pack_id, position_code, format, detail)
  where tender_pack_id is not null and status in ('requested', 'generating');
comment on index generated_cvs_dedupe_pending_idx is
  'Blocks a second generated_cvs row for the same (person, tender pack, position, format, detail) while one is already requested/generating - the database-level backstop for requestTenderCv()''s own app-level duplicate check. A ready/failed row never collides (status not in the WHERE clause), so a person can always ask again once the current one finishes.';
