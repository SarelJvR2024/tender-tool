-- Hygiene fix, found during this session's enterprise-readiness audit
-- (Sarel, 2026-10-20: a full adversarial pass across every engine and the
-- schema before onboarding a real company). NOT a live exploit - queried
-- pg_proc directly on a replayed database and confirmed every one of this
-- schema's 37 SECURITY DEFINER functions pins `search_path`, which is what
-- actually matters (it closes the classic search_path-hijacking vector this
-- project's own migrations have deliberately guarded against since early on,
-- e.g. is_company_member()'s own ALTER FUNCTION in 0043). 35 of the 37 pin
-- `search_path = public, pg_temp`; these two were created with
-- `search_path = public` only, missing `pg_temp` - an inconsistency, not a
-- reopened hole, but worth closing so every function in this schema follows
-- the exact same convention rather than two silent exceptions.
--
-- discipline_category_suggestions_guard() - 0054
-- acknowledge_discovery_downgrade(uuid) - 0055
--
-- Both migrations are well before the confirmed-live `0062` cutoff
-- (Sarel's own commit a232e77), so per this project's standing rule an
-- already-possibly-live migration is never edited in place - this is a new
-- migration, not a change to 0054/0055 themselves.

alter function discipline_category_suggestions_guard() set search_path = public, pg_temp;
alter function acknowledge_discovery_downgrade(uuid) set search_path = public, pg_temp;
