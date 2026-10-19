-- Closes out QA-Edge-Case-Findings.md's thirteenth run (commit 2d4c124):
-- the bulk onboarding document scan (migration 0063) asks the AI to read
-- six fields per document that `companies` had no column for, so
-- confirmVaultDocument() could never write them. 2d4c124 fixed the review
-- screen so it stopped claiming those fields would be saved; this migration
-- gives them real homes, following the exact Document Vault convention
-- (0014): a plain column on `companies`, named after the existing column
-- group for that document, no new table.
--
-- The six fields, each alongside its document's existing vault columns:
--   cidb_registration.registration_number -> cidb_registration_number
--   cidb_registration.contractor_name     -> cidb_contractor_name
--   bbbee_certificate.entity_name         -> bee_entity_name
--   bank_confirmation_letter.bank_name    -> bank_confirmation_bank_name
--   bank_confirmation_letter.account_holder -> bank_confirmation_account_holder
--   iso_9001_certificate.certified_entity_name -> iso_9001_certified_entity_name
--
-- Bank fields deliberately do NOT go in `bank_accounts` (0050), even though
-- that table is the more sensitive/restricted home for real account data:
-- bank_accounts.account_number is NOT NULL and the onboarding scan never
-- extracts an account number at all (classify_documents.py's KIND_FIELDS
-- for bank_confirmation_letter is only bank_name/account_holder/letter_date
-- - a bank confirmation letter does not expose the full account number).
-- Inserting a bank_accounts row from these two fields alone isn't possible
-- without changing that table's own invariant, which is a bigger, separate
-- decision than this fix. bank_name/account_holder carry no account number
-- and no more sensitivity than the letter itself (already in the
-- unrestricted companies vault via bank_confirmation_letter_path, 0014), so
-- the plain companies column is the genuinely correct, not just the easy,
-- answer here.
--
-- No RLS change needed: all six are plain columns on `companies`, already
-- covered by "companies: members can select/update" (is_company_member(id),
-- 0001).

alter table companies
  add column cidb_registration_number text,
  add column cidb_contractor_name text,
  add column bee_entity_name text,
  add column bank_confirmation_bank_name text,
  add column bank_confirmation_account_holder text,
  add column iso_9001_certified_entity_name text;

comment on column companies.cidb_contractor_name is
  'Contractor name as it appears on the uploaded CIDB certificate (from the onboarding document scan, 0063). Compared against companies.legal_name on the review screen (app/lib/onboardingScan.ts cidbNameMismatchWarning()) as a compliance-mismatch signal - a real mismatch is surfaced as a warning, never a blocker, since the company may have a valid reason (e.g. a trading name).';
comment on column companies.bee_entity_name is
  'Entity name as it appears on the uploaded B-BBEE certificate/affidavit (onboarding document scan, 0063). Informational only - not currently cross-checked against legal_name.';
comment on column companies.bank_confirmation_bank_name is
  'Bank name as it appears on the uploaded bank confirmation letter (onboarding document scan, 0063). No account number is ever stored here or extracted by the scan - see migration 0069''s header for why this is a companies column, not bank_accounts (0050).';
comment on column companies.bank_confirmation_account_holder is
  'Account holder name as it appears on the uploaded bank confirmation letter (onboarding document scan, 0063). See companies.bank_confirmation_bank_name''s comment.';
comment on column companies.iso_9001_certified_entity_name is
  'Certified entity name as it appears on the uploaded ISO 9001 certificate (onboarding document scan, 0063). Informational only - not currently cross-checked against legal_name.';
