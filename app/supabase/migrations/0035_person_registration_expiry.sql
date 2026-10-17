-- Per-person professional registration expiry (Deep-Dive item 21,
-- "Credential and certificate expiry reminders per person").
--
-- What exists today, checked first (0001_init_schema.sql, no later migration
-- alters people's registration columns): people.ecsa_level / ecsa_number /
-- ecsa_date and people.sacpcmp_number / sacpcmp_date. Both *_date columns are
-- the date the person was REGISTERED - the People page labels them "ECSA/
-- SACPCMP registration date", the CV extractor's prompt defines ecsa_date as
-- "date registered" (engine/cv/extract_cv_fields.py), and the SANRAL fillers
-- write them into the workbook's registration-date cells (fill_tender.py /
-- fill_conventional.py P40/P41). Nothing records when a registration lapses
-- or is next due for renewal, so there was nothing a reminder could read.
--
-- Professional registrations do lapse in practice (renewal tied to a CPD
-- cycle and annual fees), and the cycle differs per body, so the date is
-- captured as entered from the person's certificate / renewal notice - never
-- computed from the registration date. Same shape as the company vault's
-- *_expiry columns (0014): a plain nullable date, null = not recorded (never
-- treated as expired).
--
-- Only ECSA and SACPCMP get a column because they are the only per-person
-- registrations the schema captures at all. The other bodies in the tender
-- role catalog (0016 registration_body: SACAP, SACPLAN, SACPVP, SACQSP,
-- PSIRA, ...) have no number/date columns on people yet (System-Status Gap
-- #3, Sarel's open "columns for other professional bodies" item) - adding an
-- expiry for a registration that isn't recorded would be a reminder with
-- nothing behind it.
--
-- Read by engine/compliance/watch_deadlines.py (TRACKED_PERSON_EXPIRY_FIELDS,
-- same seen-store and lead-time window as the company documents) and shown
-- as an expiry badge on the People pages. No new policy: covered by 0001's
-- "people: tenant isolation".

alter table people
  add column ecsa_expiry date,
  add column sacpcmp_expiry date;

comment on column people.ecsa_expiry is
  'Date the ECSA registration lapses / is next due for renewal, as on the person''s certificate or renewal notice. Not the registration date (that is ecsa_date). Null = not recorded.';
comment on column people.sacpcmp_expiry is
  'Date the SACPCMP registration lapses / is next due for renewal, as on the person''s certificate or renewal notice. Not the registration date (that is sacpcmp_date). Null = not recorded.';
