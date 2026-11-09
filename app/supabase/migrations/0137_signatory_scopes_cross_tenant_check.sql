-- Standing review finding, 2026-11-09: signatory_scopes (0061) is the one
-- "child row references a specific row owned by a specific company" table
-- in this schema that never got the cross-tenant integrity check every
-- other one of this exact shape already has - tt_same_company (0043) for
-- projects/cv_uploads/person_role_eligibility/tender_tasks(assigned_to)/
-- generated_cvs/cv_extraction_results, tt_property_rows_check (0050) for
-- property_documents.property_id, tt_bank_accounts_check (0050) for
-- bank_accounts.principal_id, and held_registrations' own inline check
-- (0050) for held_registrations.principal_id. signatory_scopes.person_id
-- was simply missed - it predates none of those (0061 landed well after
-- 0043 and 0050 both established the convention), so this isn't a stale
-- gap from before the pattern existed, just an overlooked one.
--
-- signatory_scopes' own RLS ("tenant isolation", 0061) only checks that the
-- CALLER is a member of company_id - the value being written - never that
-- person_id itself belongs to that same company. app/app/people/actions.ts's
-- addSignatoryScope() takes person_id straight from form data with no
-- separate server-side check either (its own file header comment says
-- outright this file relies on RLS alone for "a person can only be read or
-- written by someone who is a member of that person's company" - true for
-- people/projects, but never true for signatory_scopes, which checks only
-- company_id's own membership).
--
-- Net effect, confirmed live in a disposable scratch database (never the
-- live DB, dropped after): a real company A, signed in as its own real
-- 'authenticated' owner user (not service_role, not superuser), can
-- INSERT INTO signatory_scopes (company_id, person_id, region) VALUES
-- (<A's own company_id>, <ANY other company B's real person_id>, ...) and
-- have it succeed - RLS's own "is_company_member(company_id)" check passes
-- (company_id really is A's own), and nothing else was checking person_id
-- at all. Re-ran the identical insert after this migration: it now raises
-- `signatory_scopes: person_id must be a person of the same company`
-- instead of succeeding.
--
-- Impact is data-integrity / cross-tenant interference, not a direct read
-- of another company's secrets: signatory-logic.ts's own pickDefaultSignatory()
-- only scores scope rows whose person_id appears in the CALLER's own
-- `signers` list (itself queried separately, already scoped to the
-- caller's own company), so a planted row naming a stranger's person_id
-- never actually influences that caller's own signatory suggestion - but
-- it still lets any company silently attach a row to a stranger's real
-- person_id with no relationship to them at all (and, since
-- deleteSignatoryScope() filters by company_id, the planted row can only
-- ever be cleaned up by the SAME attacking company, not by the victim
-- company B it was attached to, whose own /people/[id] page would show it
-- as one of that person's own scopes). Same additive, narrow-only shape as
-- every trigger it mirrors: for every row whose person_id already belongs
-- to the same company_id (the entire existing table), this check is always
-- true and nothing about today's behaviour changes.
create or replace function tt_signatory_scopes_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from people where id = new.person_id and company_id = new.company_id
  ) then
    raise exception 'signatory_scopes: person_id must be a person of the same company' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger tt_signatory_scopes_check before insert or update on signatory_scopes
  for each row execute function tt_signatory_scopes_check();
