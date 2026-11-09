-- Standing solution-architect review, 2026-11-09 (Finding 241's own explicitly-
-- flagged open item, this pass's own task brief). Widens
-- platform_admin_company_readiness_data() (0098) to also return the 3
-- vault document-path columns lib/readiness.ts's computeBidReadiness() now
-- takes (taxPinDocumentPath/beeProofDocumentPath/cidbDocumentPath -
-- 2026-11-09, Finding 241, already live for every other caller of this
-- function: dashboard, Company vault page, the discovery page's readiness
-- chip). Without them, /admin/customers (lib/customerRowData.ts's
-- buildCustomerRow(), the only caller of THIS rpc) is the one surface still
-- scored by the OLD, stricter "text/level/grading presence only" rule - a
-- company that genuinely uploaded its SARS TCS PIN letter, B-BBEE
-- certificate, or CIDB certificate but hasn't ALSO typed in the matching
-- text field reads as "missing" here while every other page the SAME
-- platform admin could look at (the Company vault page, for that exact
-- company) already correctly says "on file".
--
-- CREATE OR REPLACE can't change a function's OUT columns (same constraint
-- 0098's own header comment documents, from 0095) - drop and recreate, same
-- grants.
drop function if exists platform_admin_company_readiness_data(uuid);

create or replace function platform_admin_company_readiness_data(p_company_id uuid)
returns table (
  legal_name text,
  csd_supplier_number text,
  sars_tcs_pin text,
  sars_tcs_pin_expiry date,
  sars_tcs_pin_document_path text,
  bee_level int,
  bee_proof_expiry date,
  bee_proof_document_path text,
  cidb_grading text,
  cidb_expiry date,
  cidb_document_path text,
  bank_confirmation_letter_valid_until date,
  principal_count bigint,
  people_with_cv_count bigint,
  experience_project_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.legal_name, c.csd_supplier_number,
    c.sars_tcs_pin, c.sars_tcs_pin_expiry, c.sars_tcs_pin_document_path,
    c.bee_level, c.bee_proof_expiry, c.bee_proof_document_path,
    c.cidb_grading, c.cidb_expiry, c.cidb_document_path,
    c.bank_confirmation_letter_valid_until,
    (select count(*) from company_principals cp where cp.company_id = c.id),
    (select count(distinct cu.person_id) from cv_uploads cu where cu.company_id = c.id),
    (select count(*) from experience_items ei where ei.company_id = c.id)
  from companies c
  where is_platform_admin() and c.id = p_company_id;
$$;
comment on function platform_admin_company_readiness_data(uuid) is
  'The raw fields lib/readiness.ts computeBidReadiness() needs for one company, for /admin/customers - the cross-tenant counterpart to lib/companyReadinessData.ts fetchCompanyReadiness(), which only works for the signed-in user''s own company via RLS. Includes the 3 vault document-path columns (0125) so this admin-only score uses the exact same document-aware rule every other caller already does, not a stricter, independently-drifted one. Returns nothing unless the caller is a platform admin.';
revoke all on function platform_admin_company_readiness_data(uuid) from public;
grant execute on function platform_admin_company_readiness_data(uuid) to authenticated;
