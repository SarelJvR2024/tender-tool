-- Standing solution-architect review finding, 2026-11-06 (follow-up to 0119,
-- a different variant of the same angle): nearly every SECURITY DEFINER
-- function in this schema is written with `revoke all on function ... from
-- public;` followed by `grant execute on function ... to authenticated;` -
-- clearly INTENDING "authenticated only, not anon". That intent is not what
-- actually happens. This project's Postgres roles are set up the real
-- Supabase way (see engine/security/scratch_supabase_stub.sql's own header,
-- itself documenting lessons from 2026-10-17/18): `alter default privileges
-- in schema public grant all on functions to anon, authenticated,
-- service_role` runs ONCE, platform-side, before any migration ever runs,
-- so every NEW function this schema creates is already granted EXECUTE to
-- anon directly (a named-role grant) at the moment it's created - entirely
-- independent of the separate, pre-existing PUBLIC-pseudo-role default every
-- vanilla Postgres function also gets. `revoke all on function X from
-- public` only ever undoes the SECOND of those two grants. It does nothing
-- to the first, so `anon` keeps its own direct grant straight through the
-- revoke - the "authenticated only" comment above each of these functions
-- has never actually been true for `anon` specifically.
--
-- Proven, not assumed: replayed every migration verbatim against a real
-- scratch Postgres 16 instance seeded with this project's own Supabase-
-- accurate role/default-privilege stub, then queried
-- `has_function_privilege('anon', <oid>, 'EXECUTE')` directly against the
-- resulting catalog for every `security definer` function in `public`
-- (excluding trigger functions, which PostgREST can never expose as an RPC
-- call in the first place). Confirmed: 46 functions returned `anon_exec =
-- true` despite every one of them carrying a bare `revoke ... from public`
-- (not `from public, anon`) - this migration's own `revoke ... from anon`
-- list below is that exact query's own output, copied verbatim, not
-- hand-typed.
--
-- Why this is still only a hardening fix, not a live vulnerability on its
-- own (checked individually, not assumed): of those 46, 3
-- (`tt_pack_company`, `tt_person_in_company`, `tt_tender_visible_to`, 0043)
-- are bare id-to-id relationship booleans with no sensitive payload, used
-- only inside trigger/CHECK-constraint bodies and never inside an
-- anon-facing RLS policy (every real `create policy` in this schema is
-- scoped `to authenticated` - grepped the whole migrations directory to
-- confirm zero policies target `anon`/`public`, so `anon` calling these
-- directly learns nothing beyond "does this id pair exist", the same
-- trivial-existence-check calibration this doc's own Findings 109/110
-- already used for a sibling case). Every one of the other 43 was read and
-- confirmed to carry its OWN internal `auth.uid()`-derived gate
-- (`is_company_member()`/`is_platform_admin()`/`is_employee_in_company()`/
-- an explicit `if not is_platform_admin() then raise exception` guard, or
-- an equivalent WHERE-clause filter) that already independently blocks an
-- `anon` caller today (`auth.uid()` reads null with no JWT, so every such
-- gate already evaluates false/raises) - so revoking the redundant grant
-- changes no real caller's behaviour, `authenticated` included. This is
-- strictly a second, grant-table-level lock on doors whose application-level
-- lock was already engaged - defense in depth for if a future change ever
-- weakens or removes one of those internal checks without anyone noticing
-- the grant table was never actually doing its stated job.
--
-- Deliberately NOT touched here: the 4 functions 0119 already fixed for a
-- different, actually-live reason (anon pre-claiming a one-time token);
-- `apply_payfast_itn`, `invite_preview`, `signups_enabled`,
-- `unsubscribe_lifecycle_email` (each has a genuine, checked, unauthenticated
-- real caller - PayFast's webhook, a pre-login invite preview, the public
-- sign-up page, an unsubscribe-link click - same exclusions 0119's own entry
-- already named and did not re-litigate); and `start_payfast_checkout`,
-- deliberately left alone even though it matched this same grant-table
-- pattern, specifically so this purely-cosmetic-until-now grant cleanup
-- cannot be read as touching the standing, still-open revenue-integrity
-- judgment call on that function (its own payment-timing gap is untouched,
-- unresolved, and not this migration's concern).
--
-- Verified red-then-green against a real scratch Postgres 16 instance (not
-- assumed): RED - `set role anon; select is_platform_admin()` and
-- `select platform_admin_companies()` etc. all executed successfully (no
-- `insufficient_privilege`) pre-migration, confirming the `anon` grant was
-- real, not just theoretical. Applied this migration file itself (not a
-- hand-copied fragment) - GREEN - the identical calls now raise
-- `insufficient_privilege` for every one of the 46 functions below, while
-- `set role authenticated` still succeeds (or still correctly raises the
-- function's OWN internal 42501 "platform admin only" business-logic error,
-- for the ones that require a real admin session) exactly as before,
-- confirming zero regression for the one role that actually uses these.

revoke execute on function accept_tender_update_date(uuid, text) from anon;
revoke execute on function add_manual_tender_documents(uuid, jsonb) from anon;
revoke execute on function bank_account_summaries(uuid) from anon;
revoke execute on function company_can_request_pack(uuid) from anon;
revoke execute on function company_member_labels() from anon;
revoke execute on function company_packs_this_period(uuid) from anon;
revoke execute on function create_company_and_join(text) from anon;
revoke execute on function create_company_invite_checked(uuid, text, text, uuid) from anon;
-- is_company_member()/tt_is_company_admin() (below) are the two exceptions
-- to this migration's own "revoke from public already worked, just not from
-- anon" framing above: neither ever had ANY revoke/grant statement at all
-- (0001/0050, both pre-dating the convention), so each also still carries
-- the separate, plain-vanilla-Postgres default PUBLIC-pseudo-role EXECUTE
-- grant every newly created function gets unless revoked - caught the same
-- way, by the same scratch-Postgres query (`unnest(proacl)` showing a bare
-- `=X/<owner>` entry), not assumed from reading the SQL alone. `revoke all`
-- (not just `revoke execute ... from anon`) closes both gaps in one
-- statement. Confirmed inert for `anon` either way - both read only
-- `auth.uid()` (null with no JWT) against the passed id, so an `anon` call
-- already always returned `false` regardless of its argument - fixed anyway
-- for the same defense-in-depth reason as the other 44.
revoke all on function is_company_member(uuid) from public, anon;
revoke all on function is_employee_in_company(uuid) from anon;
revoke execute on function is_platform_admin() from anon;
revoke execute on function load_manual_tender(uuid, uuid, text, text, text, text, timestamptz, jsonb) from anon;
revoke execute on function own_linked_person_id(uuid) from anon;
revoke execute on function platform_admin_alert_counts_24h() from anon;
revoke execute on function platform_admin_billing_overview() from anon;
revoke execute on function platform_admin_companies() from anon;
revoke execute on function platform_admin_company_members(uuid) from anon;
revoke execute on function platform_admin_company_readiness_data(uuid) from anon;
revoke execute on function platform_admin_cv_document_stats() from anon;
revoke execute on function platform_admin_discovered_opportunities() from anon;
revoke execute on function platform_admin_end_impersonation(uuid) from anon;
revoke execute on function platform_admin_engine_telemetry() from anon;
revoke execute on function platform_admin_low_confidence_requirement_items(smallint, int) from anon;
revoke execute on function platform_admin_override_opportunity_confidence(uuid, smallint, text) from anon;
revoke execute on function platform_admin_reprocess_requirement_extraction(uuid, uuid) from anon;
revoke execute on function platform_admin_set_setting(text, jsonb) from anon;
revoke execute on function platform_admin_set_test_company(uuid, boolean) from anon;
revoke execute on function platform_admin_settings() from anon;
revoke execute on function platform_admin_start_impersonation(uuid, text) from anon;
revoke execute on function platform_admin_tender_catalog() from anon;
revoke execute on function pursue_discovered_opportunity(uuid) from anon;
revoke execute on function record_tender_document(uuid, text, text, text) from anon;
revoke execute on function redeem_company_invite(text) from anon;
revoke execute on function remove_member_checked(uuid, uuid) from anon;
revoke execute on function request_general_job_checked(uuid, uuid, uuid, text) from anon;
revoke execute on function request_submission_pack_checked(uuid, uuid, uuid, jsonb, boolean, timestamptz, uuid) from anon;
revoke execute on function set_member_role_checked(uuid, uuid, text) from anon;
revoke execute on function set_my_daily_digest_opt_in(boolean) from anon;
revoke execute on function submit_requirement_extraction_review(uuid, text, text, jsonb, text, jsonb, text) from anon;
revoke execute on function tender_document_uploads(uuid) from anon;
revoke execute on function tender_folder_readable(text) from anon;
revoke execute on function tt_has_own_requirements(uuid) from anon;
revoke all on function tt_is_company_admin(uuid) from public, anon;
revoke execute on function tt_pack_company(uuid) from anon;
revoke execute on function tt_person_in_company(uuid, uuid) from anon;
revoke execute on function tt_template_object_readable(text) from anon;
revoke execute on function tt_tender_visible_to(uuid, uuid) from anon;

comment on function is_platform_admin() is
  'True if the calling (authenticated) user is a platform admin (platform_admins, 0043). SECURITY DEFINER so RLS/other callers can check this without needing their own select grant on platform_admins. EXECUTE is authenticated-only (this migration, 0120) - anon held an unused, unintended direct grant from this schema''s own default-privilege setup (see this file''s own header) despite the pre-existing `revoke ... from public`, which never touched it; auth.uid() reads null for anon regardless, so this was a grant-table correction, not a behaviour change.';
