-- Seeds the shared, public `tenders` table with the 6 real SANRAL tenders this
-- project has been working through (see docs/specs and the engine/ pipeline).
-- Safe to commit: contract numbers, titles and closing dates are SANRAL's own
-- public tender data, already shown openly in this repo's UI mockups and specs.
-- No company data, no people, no PII - that's seeded separately by
-- engine/seed_supabase_company.py, which reads the gitignored profile instead
-- of being committed with real data baked in.
--
-- Run via the Supabase SQL editor, or: supabase db execute -f seed_tenders.sql

insert into tenders (slug, contract_no, nra_reference, title, description, region, closing_date, family, status)
values
  ('r-334-030-2025-1f', 'R.334-030-2025/1F', 'NRA 2026/0073',
   'Routine ad-hoc maintenance of R334 Section 3',
   'Consulting engineering services for the routine ad-hoc maintenance of R334 Section 3 from Great Fish River (km 0.0) to Mpeko (km 13.2)',
   'Eastern Cape', '2026-10-22 12:00:00+02', 'Conventional Consultant Tender', 'open'),

  ('r-343-020-2025-1f', 'R.343-020-2025/1F', 'NRA 2026/0072',
   'Routine ad-hoc maintenance of R343 Section 2',
   'Consulting engineering services for the routine ad-hoc maintenance of R343 Section 2, Glen Melville Dam to Debe Nek',
   'Eastern Cape', '2026-10-22 12:00:00+02', 'Conventional Consultant Tender', 'open'),

  ('r-352-030-2025-1f', 'R.352-030-2025/1F', 'NRA 2025/0424',
   'Routine ad-hoc maintenance of R352 Section 3',
   'Consulting engineering services for the routine ad-hoc maintenance of R352 Section 3, Dohne ADI to Tsomo',
   'Eastern Cape', '2026-10-22 12:00:00+02', 'Conventional Consultant Tender', 'open'),

  ('r-352-020-2025-1f', 'R.352-020-2025/1F', 'NRA 2025/0425',
   'Routine ad-hoc maintenance of R352 Section 2',
   'Consulting engineering services for the routine ad-hoc maintenance of R352 Section 2, Keiskammahoek to Stutterheim',
   'Eastern Cape', '2026-10-22 12:00:00+02', 'Conventional Consultant Tender', 'open'),

  ('r-394-010-2025-1f', 'R.394-010-2025/1F', 'NRA 2025/0433',
   'Routine ad-hoc maintenance of R394 Section 1',
   'Consulting engineering services for the routine ad-hoc maintenance of R394 Section 1, Bizana to N2 Wildcoast alignment',
   'Eastern Cape', '2026-10-22 12:00:00+02', 'Conventional Consultant Tender', 'open'),

  ('r-396-010-2025-1f', 'R.396-010-2025/1F', 'NRA 2026/0071',
   'Routine ad-hoc maintenance of R396 Section 1',
   'Consulting engineering services for the routine ad-hoc maintenance of R396 Section 1 from R410 I/S near Hali No.2 (km 0.0) to R56 I/S at Indwe (km 23.91)',
   'Eastern Cape', '2026-10-22 12:00:00+02', 'Conventional Consultant Tender', 'open')

on conflict (slug) do update set
  contract_no = excluded.contract_no,
  nra_reference = excluded.nra_reference,
  title = excluded.title,
  description = excluded.description,
  region = excluded.region,
  closing_date = excluded.closing_date,
  family = excluded.family,
  last_seen_at = now();
