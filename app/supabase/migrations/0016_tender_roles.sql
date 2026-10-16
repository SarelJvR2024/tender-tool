-- Tender role catalog + which roles a person's CV qualifies them for (set by
-- the company, by hand) + each tender's own evaluation rules.
--
-- Sarel, 2026-10-16 (answers to the Tender-Evaluation-Engine-Audit questions):
--   5. "Yes, have a look at tenders what the categories are that they
--      normally ask for. Also the roles and disciplines."
--   6. "Not sure, companies need to specify which sanral roles a persons cv
--      fits."
--   3. "experience evidence is specific to each tender, need to assess each
--      tender what counts as evidence they normally specify in the
--      functional requirements."
--
-- 1. tender_roles - shared reference catalog (like `tenders`: readable by any
--    signed-in user, written only by migrations/service role). Every row cites
--    the real tender text it came from (docs/specs/Tender-Evaluation-Engine-
--    Audit.md "Round 2"):
--    - SANRAL: all 23 key-person codes defined in Book 1 (R.396-010-2025/1F,
--      p. T-18), with "DS" split per specialism because a Design Specialist
--      is tendered per discipline ("Design Specialist 1 - Pavement and
--      Materials", "Design Specialist 2 - Structures") and Book 1 publishes a
--      separate project-type matrix for each of 8 DS specialisms (T-19 to
--      T-23). sanral_matrix names the matrix in app/lib/sanralMatrices.ts.
--      default_managerial is the master position list in SANRAL's own
--      Consultant Technical Submission workbook ("WORKINGS MATRIX" sheet,
--      e.g. "PL1 Project Leader MANAGERIAL POSITION") - INFORMATION ONLY:
--      each tender's SETUP sheet overrides it (all six Conventional tenders
--      in this repo mark PL "Non-Man"; both RRM tenders mark CE1 "Man"), so
--      scoring uses tender_requirements.managerial, never this column.
--    - Other buyers: the key-personnel roles real non-SANRAL tenders name
--      (contract manager / site agent / foreman - uMlalazi LM road works;
--      safety officer - DRT, uMlalazi, TNPA; architect / architectural
--      technologist - DPWI EC; town planner - DLRRD; professional engineer -
--      Sentech; property valuer - LEDA; pest control operators - DRT;
--      artisans - Transnet, TNPA; security officers - Dawid Kruiper, BCMDA).
--
-- 2. person_role_eligibility - the company's own statement "this person's CV
--    fits role X". Tender Tool no longer infers role fit from years since
--    graduating or the ECSA level text; those heuristics are only shown as a
--    cross-check next to the human tag (app/lib/tenderRoles.ts).
--
-- 3. tenders.evaluation_rules - what the tender's OWN document says counts as
--    experience evidence (and its locality rows), extracted by
--    engine/discovery/score_outlook.py and written by
--    engine/seed_tender_evaluation_rules.py. Null = not read yet: the
--    compliance check then falls back to SANRAL's B6 pattern and labels it an
--    assumption.

create table tender_roles (
  code text primary key, -- e.g. 'sanral.PL', 'sanral.DS.pavement_materials', 'contractor.site_agent'
  family text not null check (family in (
    'sanral_consultant', 'construction_contractor', 'professional_services', 'health_safety', 'trades', 'services'
  )),
  title text not null,
  discipline text, -- engine/discovery/assess_tender.py DISCIPLINE_KEYWORDS key where one fits
  registration_body text, -- ECSA, SACAP, SACPLAN, SACPCMP, SACPVP, SACQSP, PSIRA, SAQA trade test...
  sanral_base_code text, -- SANRAL position-held code (Form B1 "POSITION HELD (coded)"), e.g. 'DS'
  sanral_matrix text, -- project-type relevance matrix key in app/lib/sanralMatrices.ts; null = not published in Book 1
  default_managerial boolean, -- SANRAL master list only; information, see header
  source text not null, -- the real tender text this role was read from
  sort_order int not null default 100
);
comment on table tender_roles is
  'Key-person roles real tenders ask for (SANRAL Book 1 position codes + roles named by other buyers). Shared reference data. Evidence per row in `source`; write-up in docs/specs/Tender-Evaluation-Engine-Audit.md "Round 2".';

insert into tender_roles (code, family, title, discipline, registration_body, sanral_base_code, sanral_matrix, default_managerial, source, sort_order) values
  ('sanral.PL', 'sanral_consultant', 'Project Leader (PL)', 'roads_civil', 'ECSA', 'PL', 'PL_CE_RE_CONVENTIONAL', true, 'SANRAL Book 1 T-18 key-person list; WORKINGS MATRIX "PL1 Project Leader MANAGERIAL POSITION"; all 6 Conventional SETUP sheets: PL "Non-Man"', 10),
  ('sanral.APL', 'sanral_consultant', 'Assistant Project Leader (APL)', 'roads_civil', 'ECSA', 'APL', null, false, 'SANRAL Book 1 T-18; WORKINGS MATRIX "APL1 Alternate Project Leader NON-MANAGERIAL"', 11),
  ('sanral.DS.pavement_materials', 'sanral_consultant', 'Design Specialist - Pavement and Materials (DS)', 'roads_civil', 'ECSA', 'DS', 'DS_PAVEMENT_MATERIALS', false, 'SANRAL Book 1 T-19 matrix "DS Pavement and Materials"; SETUP DS1 "Design Specialist 1 - Pavement and Materials"', 20),
  ('sanral.DS.structures', 'sanral_consultant', 'Design Specialist - Structures (DS)', 'roads_civil', 'ECSA', 'DS', 'DS_STRUCTURES', false, 'SANRAL Book 1 T-19/T-20 matrix "DS Structures"; WORKINGS MATRIX "DS2 Design Specialist 2 - Structures"', 21),
  ('sanral.DS.electrical', 'sanral_consultant', 'Design Specialist - Electrical (DS)', 'electrical_mechanical', 'ECSA', 'DS', 'DS_ELECTRICAL', false, 'SANRAL Book 1 T-20 matrix "DS Electrical"', 22),
  ('sanral.DS.geometrics', 'sanral_consultant', 'Design Specialist - Geometrics (DS)', 'roads_civil', 'ECSA', 'DS', 'DS_GEOMETRICS', false, 'SANRAL Book 1 T-20 matrix "DS Geometrics"; WORKINGS MATRIX "DS3 Design Specialist 3 - Geometrics"', 23),
  ('sanral.DS.traffic_transportation', 'sanral_consultant', 'Design Specialist - Traffic and Transportation (DS)', 'roads_civil', 'ECSA', 'DS', 'DS_TRAFFIC_TRANSPORTATION', false, 'SANRAL Book 1 T-21 matrix "DS Traffic and Transportation"', 24),
  ('sanral.DS.geotechnical', 'sanral_consultant', 'Design Specialist - Geotechnical (DS)', 'roads_civil', 'ECSA', 'DS', 'DS_GEOTECHNICAL', false, 'SANRAL Book 1 T-22 matrix "DS Geotechnical"', 25),
  ('sanral.DS.electronic_systems', 'sanral_consultant', 'Design Specialist - Electronic Systems (DS)', 'electrical_mechanical', 'ECSA', 'DS', 'DS_ELECTRONIC_SYSTEMS', false, 'SANRAL Book 1 T-22/T-23 matrix "DS Electronic Systems"', 26),
  ('sanral.DS.engineering_geologist', 'sanral_consultant', 'Design Specialist - Engineering Geologist (DS)', 'roads_civil', null, 'DS', 'DS_ENGINEERING_GEOLOGIST', false, 'SANRAL Book 1 T-23 matrix "DS Engineering Geologist"', 27),
  ('sanral.DA', 'sanral_consultant', 'Design Assistant (DA)', 'roads_civil', 'ECSA', 'DA', null, null, 'SANRAL Book 1 T-18 key-person list', 30),
  ('sanral.CE', 'sanral_consultant', 'Contracts Engineer (CE)', 'roads_civil', 'ECSA', 'CE', 'PL_CE_RE_CONVENTIONAL', true, 'SANRAL Book 1 T-18; WORKINGS MATRIX "CE1 Contracts Engineer MANAGERIAL"; RRM SETUP (NRA 2026/0084, NRA 2026/0019) CE1 "Man", matrix "CE - RRM - RRM"', 31),
  ('sanral.ACE', 'sanral_consultant', 'Assistant Contracts Engineer (ACE)', 'roads_civil', 'ECSA', 'ACE', null, false, 'SANRAL Book 1 T-18; WORKINGS MATRIX "ACE1 Alternate Contracts Engineer NON-MANAGERIAL"', 32),
  ('sanral.RE', 'sanral_consultant', 'Resident Engineer (RE)', 'roads_civil', 'ECSA', 'RE', 'PL_CE_RE_CONVENTIONAL', true, 'SANRAL Book 1 T-18; WORKINGS MATRIX "RE1 Resident Engineer MANAGERIAL"', 33),
  ('sanral.ARE', 'sanral_consultant', 'Assistant Resident Engineer (ARE)', 'roads_civil', 'ECSA', 'ARE', null, false, 'SANRAL Book 1 T-18; WORKINGS MATRIX "ARE1 NON-MANAGERIAL"', 34),
  ('sanral.RM', 'sanral_consultant', 'RRM Route Manager (RM)', 'roads_civil', null, 'RM', null, true, 'SANRAL Book 1 T-18; WORKINGS MATRIX "RM1 RRM Route Manager MANAGERIAL" (RRM matrix not published in Book 1)', 35),
  ('sanral.ARM', 'sanral_consultant', 'Assistant Route Manager (ARM)', 'roads_civil', null, 'ARM', null, false, 'SANRAL Book 1 T-18; WORKINGS MATRIX "ARM1 Assistant Route Manager - RRM NON-MANAGERIAL"', 36),
  ('sanral.SMT', 'sanral_consultant', 'Senior Materials Technician (SMT)', 'roads_civil', null, 'SMT', null, false, 'SANRAL Book 1 T-18; WORKINGS MATRIX "SMT1 NON-MANAGERIAL"', 37),
  ('sanral.CM', 'sanral_consultant', 'Contracts Manager (CM)', 'roads_civil', null, 'CM', null, null, 'SANRAL Book 1 T-18 key-person list', 38),
  ('sanral.SA', 'sanral_consultant', 'Site Agent (SA)', 'roads_civil', null, 'SA', null, null, 'SANRAL Book 1 T-18 key-person list', 39),
  ('sanral.MT', 'sanral_consultant', 'Materials Technician (MT)', 'roads_civil', null, 'MT', null, null, 'SANRAL Book 1 T-18 key-person list', 40),
  ('sanral.ETS', 'sanral_consultant', 'Electronics Systems Engineer (ETS)', 'electrical_mechanical', 'ECSA', 'ETS', null, false, 'SANRAL Book 1 T-18; WORKINGS MATRIX "ETS NON-MANAGERIAL"', 41),
  ('sanral.ES', 'sanral_consultant', 'Electrical Systems Engineer (ES)', 'electrical_mechanical', 'ECSA', 'ES', null, false, 'SANRAL Book 1 T-18; WORKINGS MATRIX "ES Electrical Systems Engineer (Toll) NON-MANAGERIAL"', 42),
  ('sanral.MS', 'sanral_consultant', 'Mechanical Systems Engineer (MS)', 'electrical_mechanical', 'ECSA', 'MS', null, false, 'SANRAL Book 1 T-18; WORKINGS MATRIX "MS Mechanical Systems Engineer (Toll) NON-MANAGERIAL"', 43),
  ('sanral.PL(T)', 'sanral_consultant', 'Project Leader - Toll (PL(T))', 'roads_civil', 'ECSA', 'PL(T)', null, true, 'SANRAL Book 1 T-18; WORKINGS MATRIX "PL(T) MANAGERIAL"', 50),
  ('sanral.DS(T)', 'sanral_consultant', 'Design Specialist - Toll (DS(T))', 'roads_civil', 'ECSA', 'DS(T)', null, false, 'SANRAL Book 1 T-18; WORKINGS MATRIX "DS(T) NON-MANAGERIAL"', 51),
  ('sanral.CE(T)', 'sanral_consultant', 'Contracts Engineer - Toll (CE(T))', 'roads_civil', 'ECSA', 'CE(T)', null, true, 'SANRAL Book 1 T-18; WORKINGS MATRIX "CE(T) MANAGERIAL"', 52),
  ('sanral.CM(T)', 'sanral_consultant', 'Contracts Manager - Toll (CM(T))', 'roads_civil', null, 'CM(T)', null, true, 'SANRAL Book 1 T-18; WORKINGS MATRIX "CM(T) MANAGERIAL"', 53),
  ('sanral.ETS(T)', 'sanral_consultant', 'Electronics Systems Engineer - Toll (ETS(T))', 'electrical_mechanical', 'ECSA', 'ETS(T)', null, false, 'SANRAL Book 1 T-18; WORKINGS MATRIX "ETS(T) NON-MANAGERIAL"', 54),
  ('sanral.PE(E)', 'sanral_consultant', 'Project Engineer - Client (PE(E))', 'roads_civil', 'ECSA', 'PE(E)', null, null, 'SANRAL Book 1 T-18 key-person list', 55),

  ('contractor.contract_manager', 'construction_contractor', 'Contract Manager', 'roads_civil', null, null, null, null, 'uMlalazi LM KZN ULM 15/26/27 functionality "2.1 CONTRACT MANAGER" (National Diploma + years of experience)', 100),
  ('contractor.site_agent', 'construction_contractor', 'Site Agent', 'roads_civil', null, null, null, null, 'uMlalazi LM KZN ULM 15/26/27 "2.2 SITE AGENT" (National Diploma in Civil Eng / Construction Mgmt / QS + road construction experience)', 101),
  ('contractor.foreman', 'construction_contractor', 'Foreman / Supervisor', null, null, null, null, null, 'uMlalazi LM "2.3 FOREMAN"; Gauteng DRT 09/09/2026 "PEST SUPERVISOR/ FOREMAN"; TNPA asbestos organogram "Supervisor"', 102),
  ('contractor.project_manager', 'construction_contractor', 'Project Manager (contractor)', null, null, null, null, null, 'TNPA asbestos removal tender, T2.2-04 "Project Manager/Site" key personnel', 103),
  ('hs.safety_officer', 'health_safety', 'Safety Officer (SACPCMP registered)', null, 'SACPCMP', null, null, null, 'Gauteng DRT 09/09/2026: "registered and active with SACPCMP as a Safety Officer or Safety Manager (Candidate registration is not acceptable)"; uMlalazi C3.1.18; TNPA organogram', 110),
  ('psp.professional_engineer', 'professional_services', 'Professional Engineer (ECSA Pr Eng)', null, 'ECSA', null, null, null, 'Sentech RFX 60000003737: "Registered Professional Engineer" / "Valid ECSA Certificate"', 120),
  ('psp.professional_architect', 'professional_services', 'Professional Architect (SACAP)', 'buildings', 'SACAP', null, null, null, 'DPWI EC SCMU5-26/27-0007SB 2.22 "Professional Architect"; "Registration will be verified through SACAP"', 121),
  ('psp.architectural_technologist', 'professional_services', 'Architectural Technologist (SACAP)', 'buildings', 'SACAP', null, null, null, 'DPWI EC SCMU5-26/27-0007SB 2.22 "Senior Architectural Technologist or Architectural Technologist"; rate table "Professional Architectural Technologist"', 122),
  ('psp.quantity_surveyor', 'professional_services', 'Quantity Surveyor (SACQSP)', 'buildings', 'SACQSP', null, null, null, 'DPWI EC SCMU5-26/27-0007SB abbreviations "QS: Quantity Surveyor" (named, not scored in that tender)', 123),
  ('psp.town_planner', 'professional_services', 'Town and Regional Planner (SACPLAN)', null, 'SACPLAN', null, null, null, 'DLRRD N14/Bestwood precinct plan: "The Town and Regional Planner designated as the Project Leader must ... be registered with SACPLAN"; scored on post-registration years', 124),
  ('psp.property_valuer', 'professional_services', 'Property Valuer (SACPVP)', null, 'SACPVP', null, null, null, 'LEDA panel of valuation service providers: "recognised qualification by SACPVP AND 5 or more years'' experience in property valuation"', 125),
  ('trades.mechanic', 'trades', 'Mechanic / Mechanical Engineering diploma (trade tested)', 'electrical_mechanical', 'SAQA / trade test', null, null, null, 'Transnet TPT/2026/06/0650/7337/RFP: "two (2) SAQA accredited Mechanical Engineering Diploma or Mechanic Trade Test Certificate"', 130),
  ('trades.auto_electrician', 'trades', 'Auto Electrician / Electromechanician / Millwright (trade tested)', 'electrical_mechanical', 'SAQA / trade test', null, null, null, 'Transnet TPT/2026/06/0650/7337/RFP: "Auto Electrician/ Electromechanics/ Millwright trade test certificate"', 131),
  ('trades.carpenter', 'trades', 'Carpenter (trade tested)', 'buildings', 'trade test', null, null, null, 'TNPA asbestos removal tender organogram: "Trade-tested Carpenter"', 132),
  ('services.pest_control_operator', 'services', 'Certified Pest Control Operator', null, null, null, null, null, 'Gauteng DRT 09/09/2026: "Certified Pest Control Operator" (experience bands scored)', 140),
  ('services.assistant_pest_control_operator', 'services', 'Assistant Pest Control Operator', null, null, null, null, null, 'Gauteng DRT 09/09/2026 Schedule B: "Assistant Pest Control Operator ... SAQA-accredited Pest Control Skill Programme certificate"', 141),
  ('services.security_officer', 'services', 'Security Officer (PSIRA registered)', 'security_facilities', 'PSIRA', null, null, null, 'Dawid Kruiper TN051/2026 5.3 "20 PSIRA registered Security Officers"; BCMDA "PSIRA-compliant security personnel"', 142);

alter table tender_roles enable row level security;
create policy "tender_roles readable by authenticated users" on tender_roles
  for select to authenticated using (true);

-- Which roles a person's CV fits - the company's own, manual statement.
create table person_role_eligibility (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  role_code text not null references tender_roles(code) on update cascade,
  notes text, -- e.g. "CE on ACSA taxiway rehab 2018-2026"
  tagged_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (person_id, role_code)
);
comment on table person_role_eligibility is
  'Company-set tags: "this person''s CV qualifies them for tender role X" (Sarel, 2026-10-16: "companies need to specify which sanral roles a persons cv fits"). The compliance check uses this tag directly; years-since-degree / ECSA-level heuristics are only shown beside it as a cross-check.';

create index person_role_eligibility_company_role_idx on person_role_eligibility (company_id, role_code);

alter table person_role_eligibility enable row level security;
-- Tenant isolation, and the person must belong to the same company.
create policy "person_role_eligibility: tenant isolation" on person_role_eligibility
  for all to authenticated
  using (is_company_member(company_id))
  with check (
    is_company_member(company_id)
    and exists (select 1 from people p where p.id = person_id and p.company_id = person_role_eligibility.company_id)
  );

-- The tender's own evaluation rules, read from its document.
alter table tenders add column evaluation_rules jsonb;
comment on column tenders.evaluation_rules is
  'What THIS tender''s own document says, extracted by engine/discovery/score_outlook.py (extract_experience_evidence, extract_locality) and written by engine/seed_tender_evaluation_rules.py: {experience_evidence: {source, rules[]}, locality: {rows[], mandatory_local_office}, source_document, extracted_at}. Null = not read yet - the compliance check then falls back to SANRAL''s B6 pattern and labels it an assumption.';
