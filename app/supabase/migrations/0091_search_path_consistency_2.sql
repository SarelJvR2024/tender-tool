-- Hygiene fix, found by the 2026-10-24 multi-tenant security &
-- enterprise-readiness audit (docs/AUDIT_MULTI_TENANT_SECURITY.md, Finding
-- 1). NOT a live exploit - confirmed live against pg_proc on a replayed
-- database that of this schema's 51 SECURITY DEFINER functions, these are
-- the only 2 missing `pg_temp` from `search_path`. This is the exact gap
-- 0074_search_path_consistency.sql already closed once for two other,
-- earlier functions - 0089 (written after 0074) reintroduced the same
-- inconsistency in two new functions. Neither is currently exploitable
-- (both qualify every reference inside their own body and call no
-- unqualified helper a search-path hijack could plausibly shadow in this
-- schema today) - this closes the drift from the established convention,
-- same reasoning as 0074's own comment.
--
-- set_opportunity_tag(uuid, text, text) - 0089
-- set_opportunity_interest(uuid, text) - 0089
--
-- 0089 is well before the confirmed-live `0090` cutoff (this schema's own
-- latest migration at audit time), so per this project's standing rule an
-- already-possibly-live migration is never edited in place - this is a new
-- migration, not a change to 0089 itself.

alter function set_opportunity_tag(uuid, text, text) set search_path = public, pg_temp;
alter function set_opportunity_interest(uuid, text) set search_path = public, pg_temp;
