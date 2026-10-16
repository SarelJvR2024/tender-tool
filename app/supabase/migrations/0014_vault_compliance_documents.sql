-- Document Vault: real tracked fields for the compliance documents the
-- per-tender compliance check (app/lib/tenderCompliance.ts) previously had to
-- show as "Confirm by hand" because no column existed for them.
--
-- Sarel's answers to the Tender-Evaluation-Engine-Audit open questions
-- (2026-10-16), verbatim:
--   "8. They have iso 9001."
--   "9. Yes it is a standard acceptable template."  (SANRAL accepts the QSE
--      sworn affidavit in place of a B-BBEE verification certificate)
--   "10. Yes."  (add real fields for SARS TCS PIN, insurance, ISO certificate,
--      bank-letter date and B-BBEE proof expiry)
--
-- Follows the existing COID pattern exactly: plain columns on `companies`
-- (identifying number + expiry date), so the existing RLS policies
-- ("companies: members can select/update", is_company_member(id), 0001) cover
-- them with no new policy. The one addition is the document itself: a private
-- 'company-documents' bucket with the same path-prefix storage RLS as
-- 'cv-documents' (0008) and 'experience-documents' (0012), objects keyed
-- "<company_id>/vault/<doc>/<uuid>-<filename>", path stored on the row (never
-- the file), same as experience_items.storage_path.

insert into storage.buckets (id, name, public)
values ('company-documents', 'company-documents', false)
on conflict (id) do nothing;

create policy "company-documents: tenant isolation by path prefix" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'company-documents'
    and is_company_member((storage.foldername(name))[1]::uuid)
  )
  with check (
    bucket_id = 'company-documents'
    and is_company_member((storage.foldername(name))[1]::uuid)
  );

alter table companies
  -- COID already has number + expiry (0001); only the uploaded copy is new.
  add column coid_letter_document_path text,

  -- SANRAL Form A9: SARS Tax Compliance Status PIN. The PIN letter carries an
  -- expiry date (Klipcorp's: issued 2026-06-24, expires 2027-06-24).
  add column sars_tcs_pin text,
  add column sars_tcs_pin_expiry date,
  add column sars_tcs_pin_document_path text,

  -- SANRAL Form A17: professional indemnity insurance. period_to of the
  -- policy schedule is the expiry.
  add column pi_insurance_insurer text,
  add column pi_insurance_policy_number text,
  add column pi_insurance_cover_zar numeric,
  add column pi_insurance_expiry date,
  add column pi_insurance_document_path text,

  -- SANRAL Form B4 (quality system, 10 functionality points: ISO certified 10,
  -- submitted for ISO 7, in-house 5, none 0). Nullable on purpose: null =
  -- "not stated", which the compliance check must not read as "not certified".
  add column iso_9001_certified boolean,
  add column iso_9001_certificate_number text,
  add column iso_9001_expiry date,
  add column iso_9001_document_path text,

  -- SANRAL Form A18: bank confirmation letter. The letter has an issue date,
  -- not an expiry. The FNB letter's own electronic-stamp reference "is valid
  -- for 3 months" (real Klipcorp letter, 2026-09-09), and buyers commonly ask
  -- for a letter not older than 3 months, so the usable-until date is derived
  -- here once, as a real column the vault, compliance check and expiry
  -- reminder all read, rather than three copies of "+ 3 months".
  add column bank_confirmation_letter_date date,
  add column bank_confirmation_letter_valid_until date
    generated always as ((bank_confirmation_letter_date + interval '3 months')::date) stored,
  add column bank_confirmation_letter_path text,

  -- SBD 6.1 / SANRAL specific goals: which proof backs bee_level (0001). A
  -- QSE or EME sworn affidavit is the standard DTIC template and is accepted
  -- as equivalent evidence to a SANAS verification certificate (Sarel, answer
  -- 9). Affidavits are valid 12 months from the date sworn; certificates 12
  -- months from issue - either way bee_proof_expiry holds the date.
  add column bee_proof_type text check (bee_proof_type in ('certificate', 'qse_affidavit', 'eme_affidavit')),
  add column bee_proof_expiry date,
  add column bee_proof_document_path text;

comment on column companies.iso_9001_certified is
  'ISO 9001 certified (true), not certified (false), or not stated (null). Feeds SANRAL Form B4 quality-system points.';
comment on column companies.bank_confirmation_letter_valid_until is
  'Derived: bank_confirmation_letter_date + 3 months (FNB stamp validity / common buyer rule). Read by the vault, the compliance check and engine/compliance/watch_deadlines.py.';
comment on column companies.bee_proof_type is
  'Proof behind bee_level: certificate (SANAS verification certificate), qse_affidavit or eme_affidavit (DTIC sworn affidavit template). Affidavits are accepted as equivalent evidence (Sarel, 2026-10-16).';
