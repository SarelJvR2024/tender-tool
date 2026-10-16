-- Adds the per-user WORKFLOW role for the tender process, distinct from
-- company_members.role (account permission: owner/admin/member). See
-- docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md's "Roles and the
-- role-based daily digest" section for the full reasoning - five roles,
-- specific to this one process, not a general RBAC system.
--
-- Deliberately a single nullable column on company_members, not a new table:
-- checked first (per this project's own scope-discipline rule) whether
-- company_members or any existing table already had a role-like column -
-- company_members.role does, but it answers a different question (account
-- permission), so this is a new column, not a repurposing of that one.
--
-- Global per-user, not per-tender-assignment - a flagged, not guessed,
-- decision (see the spec section): nothing in the schema today models
-- "assigned to tender X" for a person at all, and inventing that table
-- before Sarel asks for it would be exactly the scope creep this project's
-- own discipline section warns against. Revisit only if a real need for
-- per-tender roles shows up.
--
-- null means "not set" - treated as the full_cycle default everywhere this
-- is read (engine/notify/daily_digest.py, and any future UI), so existing
-- single-role-for-everyone behavior is unchanged until someone is
-- deliberately narrowed to a smaller role.

alter table company_members
  add column tender_role text check (
    tender_role in ('full_cycle', 'validator', 'cv_admin', 'finance', 'viewer')
  );

comment on column company_members.tender_role is
  'Workflow role for the tender process (full_cycle/validator/cv_admin/finance/viewer) - see docs/specs/Tender-Tool-Competitor-Feature-Deep-Dive.md. Distinct from company_members.role (account permission). Null = unset, treated as full_cycle by every reader. No UI sets this yet (see docs/specs/System-Status.md) - set directly via the Supabase dashboard or SQL until a team-members page exists.';
