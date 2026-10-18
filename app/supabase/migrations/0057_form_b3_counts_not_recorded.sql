-- Form-field audit (docs/specs/Form-Field-Audit.md, 2026-10-18).
--
-- 0001 gave three SANRAL Form B3 company counts a column DEFAULT 0:
--   other_offices, ecsa_registered_staff_count, sacpcmp_registered_staff_count.
-- No screen let a company enter them, so every company created in the app
-- went into Form B3 ("REGISTERED PROFESSIONALS: ECSA ... 0") with a 0 that
-- nobody had said - indistinguishable from a real 0. The Company page now has
-- the fields; from here a new company's counts start as NULL = not recorded,
-- which the pack leaves blank and lists (engine/sanral_fill.fill_company_front).
--
-- Existing rows are NOT changed: a stored 0 may be a real answer (e.g. a
-- seeded company's own figure). The filler treats the untouched pattern - all
-- three 0 with total_employees (which never had a default) still NULL - as
-- not recorded.

alter table companies alter column other_offices drop default;
alter table companies alter column ecsa_registered_staff_count drop default;
alter table companies alter column sacpcmp_registered_staff_count drop default;

comment on column companies.other_offices is
  'SANRAL Form B3 "OTHER OFFICES (only list number)". NULL = not recorded (no default since 0057).';
comment on column companies.ecsa_registered_staff_count is
  'SANRAL Form B3 "REGISTERED PROFESSIONALS: ECSA". NULL = not recorded (no default since 0057).';
comment on column companies.sacpcmp_registered_staff_count is
  'SANRAL Form B3 "REGISTERED PROFESSIONALS: SACPCMP". NULL = not recorded (no default since 0057).';
comment on column companies.typical_jv_share_pct is
  'SANRAL Form B3 "% SHARE OF JV AGREEMENT" as the company usually bids (100 = alone). Written into each pack as an assumed default - a JV is decided per tender.';
