-- Directors & shareholders register, shared registrations/accreditations
-- catalog, restricted bank accounts, and landlord property records.
-- Sarel's answers to Company-Master-Data-List.md §8 Q-MD1..Q-MD4
-- (2026-10-17). Evidence and reasoning: docs/specs/Company-Master-Data-List.md
-- §8 (closed out) and §9 (this build).
--
-- Personal information (POPIA). This migration adds the largest body of
-- personal information in the product: directors' and shareholders' ID
-- numbers, race, gender, disability, citizenship and bank accounts. Race and
-- disability (health) are SPECIAL personal information (POPIA s26). They are
-- processed here only for B-BBEE / specific-goals claims, which POPIA s29(a)
-- / s27(1)(b) allow for measures that advance people disadvantaged by unfair
-- discrimination, and each principal row records when that person's consent
-- was obtained (popia_consent_on). Discipline, same as the rest of the schema:
--   * every row is tenant-scoped by RLS (is_company_member, 0001);
--   * bank account numbers sit in their own table that only a company OWNER or
--     ADMIN can read or write (0001's own instruction: "If this is ever
--     needed, it goes in a separate, more tightly-restricted table"); other
--     members get a masked summary (last 4 digits) through a function;
--   * ID numbers are stored once, as text (0001 people.id_number rule), never
--     copied into another table, and the app masks them in every list view;
--   * uploaded copies live in the private company-documents bucket (0014)
--     under the row's own company folder, enforced by a CHECK (the 0043
--     "own folder" rule, written inline so this file doesn't depend on it);
--   * every reference to a person / principal / property is checked to be in
--     the SAME company by a trigger (the 0043 cross-company rule - RLS only
--     checks a row's own company_id, never what it points at);
--   * no engine or pack reads any of these tables yet: nothing here reaches a
--     generated document until a specific tender form asks for it.
--
-- 1. company_principals - directors / members / shareholders (gap #1).
--    Ownership percentages by group (black, black women, women, youth,
--    disabled, military veterans, HDI) are DERIVED by the
--    company_ownership_breakdown view, never stored twice
--    (Company-Master-Data-List.md §4 rank 1: "Derive the ownership
--    percentages; don't store them twice"). companies.director_name /
--    director_id_number (0001, one director) are copied in once as a first
--    register row; the columns stay because engines read director_name for
--    the signing director (company_documents.py, fill_docx_forms.py).
--
-- 2. registration_types + held_registrations - ONE shared catalog of
--    registration / licence / accreditation TYPES, each tagged company,
--    person or both (Sarel, Q-MD4: "It's either company or person specific
--    accreditations or registrations and can have multiple"), and the
--    many-to-many list of what a company, person (people) or principal
--    actually holds. Same spirit as discipline_categories (0040): a new type
--    is an INSERT, not a migration. Shared rows are written by the service
--    role; a company may add its own private types (owner_company_id).
--
--    ECSA / SACPCMP / SACNASP / SAGC are NOT migrated into this model in this
--    pass. Their catalog rows carry stored_in = 'people.<body>_*' and the
--    trigger refuses a held_registrations row for them, so there is exactly
--    one place each fact lives. Why (full reasoning in the findings doc):
--    ECSA / SACPCMP numbers and dates are written into fixed SANRAL workbook
--    cells by fill_tender.py / fill_conventional.py and read by the compliance
--    report's position checks; SACNASP / SAGC landed today with their own
--    tender-conditional UI, compliance and reminder paths. Moving only
--    SACNASP/SAGC would still leave ECSA/SACPCMP as columns, so it would not
--    make the model uniform - it would only add risk. They move together,
--    with the SANRAL fillers, in a later pass. CIDB (companies.cidb_grading,
--    read by Discovery and the SBD fill) and B-BBEE (vault, 0014) are
--    catalogued the same way, as stored_in.
--
-- 3. bank_accounts - restricted (Q-MD1: store account numbers - yes). A
--    company's own account (principal_id null) or a principal's.
--
-- 4. company_properties + property_documents - landlord / property tenders
--    (Q-MD3: yes). Per BUILDING, not per company. Only the facts five real
--    open eTenders lease tenders actually ask for (EC Agriculture
--    SCMU8-26/27-0143, NW Public Works PWR 39/26, Legal Aid SA 51/2026,
--    RAF PR10118955; quotes in the findings doc): address / erf, ownership
--    basis (owner, agent with the owner's mandate, bond / purchase), title
--    deed, lettable area, parking, SAPOA grade, and per-building compliance
--    documents. Rental, escalation, lease period and availability date are
--    priced or offered PER TENDER and are deliberately not stored; no tender
--    asked for a valuation, so none is stored.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function tt_is_company_admin(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from company_members
    where company_id = p_company and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;
comment on function tt_is_company_admin(uuid) is
  'True when the signed-in user is an owner or admin of the company (0050: bank account numbers).';

-- Storage path must sit under the row's own company folder (0043 rule).
create or replace function tt_path_in_company(p_path text, p_company uuid)
returns boolean
language sql
immutable
as $$
  select p_path is null
      or (p_path like p_company::text || '/%' and p_path not like '%..%' and p_path not like '%//%');
$$;

-- ---------------------------------------------------------------------------
-- 1. Directors / shareholders register
-- ---------------------------------------------------------------------------
create table company_principals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  -- Set when the principal is also one of the company's people (key staff
  -- with a CV) - then their professional registrations live on that person.
  person_id uuid references people(id) on delete set null,
  role text not null check (role in ('director', 'shareholder', 'both')),
  position text,               -- as on CIPC / the tender form: "Managing Director", "Member", "Trustee"
  executive boolean,           -- executive / non-executive (A7); null = not stated
  appointed_on date,
  holder_type text not null default 'natural_person' check (holder_type in ('natural_person', 'juristic_person')),
  full_name text not null check (length(trim(full_name)) > 0),
  -- Natural person identity. SA ID as text (leading zeros - 0001 rule);
  -- 13 digits only, the app checks the Luhn digit before saving.
  id_number text check (id_number is null or id_number ~ '^[0-9]{13}$'),
  passport_number text,
  nationality text,
  sa_citizen boolean,          -- B-BBEE "black" requires SA citizenship
  date_of_birth date,          -- only needed without an SA ID (youth is computed from the ID otherwise)
  gender text check (gender in ('female', 'male', 'other')),
  -- B-BBEE race groups (Codes of Good Practice; Chinese South Africans are
  -- included in "black people" per the 2008 High Court order).
  race text check (race in ('african', 'coloured', 'indian', 'chinese_sa', 'white', 'other')),
  disability boolean,          -- needs proof per owner (C4): disability_proof_path
  military_veteran boolean,
  -- Juristic shareholder (holding company, trust): its own registration no.
  entity_registration_number text,
  -- Shareholding. Null for a director who holds no shares.
  ownership_pct numeric(6, 3) check (ownership_pct is null or (ownership_pct >= 0 and ownership_pct <= 100)),
  -- Certified ID copy (A3) and when it was certified: tenders accept copies
  -- certified within 30 days / 3 / 6 months (§3.1), so the date is the fact.
  certified_id_path text,
  certified_id_filename text,
  certified_id_on date,
  disability_proof_path text,
  disability_proof_filename text,
  -- POPIA: when this person agreed to the company processing their personal
  -- information for tender submissions. Null = not recorded (shown as a gap).
  popia_consent_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (role <> 'director' or ownership_pct is null),
  check (holder_type = 'natural_person' or (id_number is null and gender is null and race is null and disability is null
                                              and certified_id_path is null and role <> 'director')),
  check (tt_path_in_company(certified_id_path, company_id) and tt_path_in_company(disability_proof_path, company_id))
);
create index company_principals_company on company_principals(company_id);
comment on table company_principals is
  'Directors / members / shareholders register (0050, Company-Master-Data-List gap #1). Personal information: RLS per company; ID numbers masked in list views; never read into a generated document yet.';
comment on column company_principals.id_number is
  'Real PII (SA ID number). Text, 13 digits. Masked in every list view; do not log or copy elsewhere.';
comment on column company_principals.race is
  'POPIA special personal information - processed only for B-BBEE / specific-goals ownership (s29). See popia_consent_on.';
comment on column company_principals.disability is
  'POPIA special personal information (health) - only the yes/no plus the proof document a tender asks for.';

alter table company_principals enable row level security;
create policy "company_principals: tenant isolation" on company_principals
  for all to authenticated
  using (is_company_member(company_id))
  with check (is_company_member(company_id));

create or replace function tt_principals_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total numeric;
begin
  if new.person_id is not null and not exists (
    select 1 from people where id = new.person_id and company_id = new.company_id
  ) then
    raise exception 'company_principals: person_id must be a person in the same company' using errcode = '23514';
  end if;
  select coalesce(sum(ownership_pct), 0) into v_total
  from company_principals
  where company_id = new.company_id and id <> new.id;
  if v_total + coalesce(new.ownership_pct, 0) > 100.0005 then
    raise exception 'company_principals: shareholdings would add up to % %% - more than 100 %%',
      round(v_total + coalesce(new.ownership_pct, 0), 3) using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger tt_principals_check before insert or update on company_principals
  for each row execute function tt_principals_check();

-- SA ID -> date of birth (YYMMDD). The century is the most recent one that
-- doesn't put the birthday in the future.
create or replace function tt_sa_id_birth_date(p_id text)
returns date
language plpgsql
stable
as $$
declare
  v_yy int;
  v_d date;
begin
  if p_id is null or p_id !~ '^[0-9]{13}$' then
    return null;
  end if;
  v_yy := substr(p_id, 1, 2)::int;
  begin
    v_d := make_date(2000 + v_yy, substr(p_id, 3, 2)::int, substr(p_id, 5, 2)::int);
    if v_d > current_date then
      v_d := make_date(1900 + v_yy, substr(p_id, 3, 2)::int, substr(p_id, 5, 2)::int);
    end if;
  exception when others then
    return null;
  end;
  return v_d;
end;
$$;

-- Ownership by group, derived from the register. security_invoker: the
-- caller's RLS applies, so a company only ever sees its own breakdown.
-- Youth = 18-35 on the day it is read (National Youth Policy; Elundini t038).
-- HDI = PPPFA 2001 sense: SA citizen who is black, a woman or disabled.
-- unclassified_pct = shares whose holder is a juristic person or has no race
-- / gender recorded - shown, never guessed into a group.
create view company_ownership_breakdown with (security_invoker = true) as
with p as (
  select
    cp.company_id,
    coalesce(cp.ownership_pct, 0) as pct,
    cp.holder_type,
    cp.race in ('african', 'coloured', 'indian', 'chinese_sa') and coalesce(cp.sa_citizen, true) as is_black,
    cp.gender = 'female' as is_female,
    coalesce(cp.disability, false) as is_disabled,
    coalesce(cp.military_veteran, false) as is_mv,
    date_part('year', age(current_date, coalesce(cp.date_of_birth, tt_sa_id_birth_date(cp.id_number)))) as age_years,
    cp.race is null or cp.gender is null as is_unclassified
  from company_principals cp
  where cp.role in ('shareholder', 'both') and coalesce(cp.ownership_pct, 0) > 0
)
select
  company_id,
  count(*)::int as shareholders,
  round(sum(pct), 3) as total_pct,
  round(sum(pct) filter (where holder_type = 'natural_person' and is_black), 3) as black_pct,
  round(sum(pct) filter (where holder_type = 'natural_person' and is_black and is_female), 3) as black_women_pct,
  round(sum(pct) filter (where holder_type = 'natural_person' and is_female), 3) as women_pct,
  round(sum(pct) filter (where holder_type = 'natural_person' and age_years between 18 and 35), 3) as youth_pct,
  round(sum(pct) filter (where holder_type = 'natural_person' and is_black and age_years between 18 and 35), 3) as black_youth_pct,
  round(sum(pct) filter (where holder_type = 'natural_person' and is_disabled), 3) as disabled_pct,
  round(sum(pct) filter (where holder_type = 'natural_person' and is_black and is_disabled), 3) as black_disabled_pct,
  round(sum(pct) filter (where holder_type = 'natural_person' and is_mv), 3) as military_veteran_pct,
  round(sum(pct) filter (where holder_type = 'natural_person' and (is_black or is_female or is_disabled)), 3) as hdi_pct,
  round(sum(pct) filter (where holder_type = 'juristic_person' or is_unclassified), 3) as unclassified_pct
from p
group by company_id;
comment on view company_ownership_breakdown is
  'Ownership % by specific-goals group, derived from company_principals (0050). Never stored; compare with companies.black_ownership_pct (the stated figure).';

-- One-time copy of the single director 0001 held. No ownership is assumed.
insert into company_principals (company_id, role, full_name, id_number, notes)
select c.id, 'director', trim(c.director_name),
       case when c.director_id_number ~ '^[0-9]{13}$' then c.director_id_number end,
       'Copied from the company profile''s director field (migration 0050). Complete the rest of this person''s details.'
from companies c
where coalesce(trim(c.director_name), '') <> '';

-- No second plaintext copy of an ID number: once it is in the register, the
-- 0001 column is cleared (nothing reads it - checked: only director_name is
-- read, by the letter / C.1.2.3 fillers). A value that isn't a valid 13-digit
-- ID wasn't copied and is left where it is, so nothing is lost.
update companies c set director_id_number = null
where c.director_id_number ~ '^[0-9]{13}$'
  and exists (select 1 from company_principals p where p.company_id = c.id and p.id_number = c.director_id_number);
comment on column companies.director_id_number is
  'Superseded by company_principals.id_number (0050) - do not write. Kept only for a legacy value that was not a valid 13-digit ID.';

-- ---------------------------------------------------------------------------
-- 2. Registrations / licences / accreditations: shared catalog + holdings
-- ---------------------------------------------------------------------------
create table registration_types (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z][a-z0-9_]{0,62}$'),
  label text not null check (length(trim(label)) > 0),
  issuing_body text,
  scope text not null check (scope in ('company', 'person', 'both')),
  kind text not null default 'registration'
    check (kind in ('professional_council', 'industry_association', 'licence_permit', 'accreditation', 'certification', 'clearance', 'registration')),
  -- Where the fact lives when it is NOT held through this catalog
  -- (dedicated columns from earlier migrations). A held_registrations row
  -- for such a type is refused - one home per fact.
  stored_in text,
  asked_for_by text,           -- the real tenders this type was read from
  owner_company_id uuid references companies(id) on delete cascade, -- null = shared catalog row
  active boolean not null default true,
  sort_order integer not null default 1000,
  created_at timestamptz not null default now()
);
create unique index registration_types_shared_slug on registration_types(slug) where owner_company_id is null;
create unique index registration_types_company_slug on registration_types(owner_company_id, slug) where owner_company_id is not null;
comment on table registration_types is
  'Shared catalog of registration / licence / accreditation TYPES (0050, Sarel Q-MD4), each scoped company / person / both. Add a type with an INSERT (service role), or a company adds its own (owner_company_id).';
comment on column registration_types.stored_in is
  'Set when this type is recorded in dedicated columns instead (people.ecsa_*, people.sacnasp_*, companies.cidb_grading, the B-BBEE vault). held_registrations refuses such a type.';

alter table registration_types enable row level security;
create policy "registration_types: shared and own" on registration_types
  for select to authenticated
  using (owner_company_id is null or is_company_member(owner_company_id));
create policy "registration_types: company adds its own" on registration_types
  for insert to authenticated
  with check (owner_company_id is not null and is_company_member(owner_company_id) and stored_in is null);
create policy "registration_types: company edits its own" on registration_types
  for update to authenticated
  using (owner_company_id is not null and is_company_member(owner_company_id))
  with check (owner_company_id is not null and is_company_member(owner_company_id) and stored_in is null);

create table held_registrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  registration_type_id uuid not null references registration_types(id) on delete restrict,
  -- Holder: both null = the company itself; else one person or one principal.
  person_id uuid references people(id) on delete cascade,
  principal_id uuid references company_principals(id) on delete cascade,
  registration_number text,
  category text,               -- grade / class / category as on the certificate (PSIRA "Grade A", SETA SAQA ID, "Pr.Sci.Nat")
  issued_by text,              -- the specific issuer when the type has several (which SETA, which municipality / province)
  issued_on date,
  expiry_date date,            -- as on the certificate; null = not recorded (never treated as expired)
  certified_on date,           -- date the stored copy was certified, when a tender wants a certified copy
  storage_path text,
  original_filename text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (person_id is null or principal_id is null),
  check (tt_path_in_company(storage_path, company_id))
);
create index held_registrations_company on held_registrations(company_id);
create index held_registrations_expiry on held_registrations(expiry_date) where expiry_date is not null;
comment on table held_registrations is
  'What a company, a person (people) or a principal actually holds from registration_types - many per holder (0050). expiry_date feeds engine/compliance/watch_deadlines.py find_due_registrations().';

alter table held_registrations enable row level security;
create policy "held_registrations: tenant isolation" on held_registrations
  for all to authenticated
  using (is_company_member(company_id))
  with check (is_company_member(company_id));

create or replace function tt_held_registrations_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  t registration_types%rowtype;
begin
  select * into t from registration_types where id = new.registration_type_id;
  if not found or (t.owner_company_id is not null and t.owner_company_id <> new.company_id) then
    raise exception 'held_registrations: unknown registration type for this company' using errcode = '23503';
  end if;
  if t.stored_in is not null then
    raise exception 'held_registrations: % is recorded in %, not here', t.label, t.stored_in using errcode = '23514';
  end if;
  if new.person_id is not null and not exists (
    select 1 from people where id = new.person_id and company_id = new.company_id
  ) then
    raise exception 'held_registrations: person_id must be a person in the same company' using errcode = '23514';
  end if;
  if new.principal_id is not null and not exists (
    select 1 from company_principals where id = new.principal_id and company_id = new.company_id
  ) then
    raise exception 'held_registrations: principal_id must be a principal of the same company' using errcode = '23514';
  end if;
  if new.person_id is null and new.principal_id is null and t.scope = 'person' then
    raise exception 'held_registrations: % is held by a person, not by the company', t.label using errcode = '23514';
  end if;
  if (new.person_id is not null or new.principal_id is not null) and t.scope = 'company' then
    raise exception 'held_registrations: % is held by the company, not by a person', t.label using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger tt_held_registrations_check before insert or update on held_registrations
  for each row execute function tt_held_registrations_check();

-- Seed: every body Company-Master-Data-List.md §3 E1-E15 / J3 and §4 rank 9
-- found in the 104 hand-read tenders (sample ids t000-t122, Appendix B).
insert into registration_types (slug, label, issuing_body, scope, kind, stored_in, asked_for_by, sort_order) values
  -- Dedicated columns already (one home per fact - see header)
  ('ecsa', 'ECSA professional registration', 'Engineering Council of South Africa', 'person', 'professional_council', 'people.ecsa_*', 'SANRAL Book 1 key persons; J1/J3', 10),
  ('sacpcmp', 'SACPCMP professional registration', 'SA Council for the Project and Construction Management Professions', 'person', 'professional_council', 'people.sacpcmp_*', 'SANRAL; safety officer roles (0016)', 11),
  ('sacnasp', 'SACNASP registration (Pr.Sci.Nat)', 'SA Council for Natural Scientific Professions', 'person', 'professional_council', 'people.sacnasp_*', 'SANRAL C3.1.11 Engineering Geologist (0040)', 12),
  ('sagc', 'SAGC registration (geomatics)', 'SA Geomatics Council', 'person', 'professional_council', 'people.sagc_*', 'SANRAL C3.1.11 Surveyor; KZN PW ZNTM01233W t054 (director''s SAGC)', 13),
  ('cidb', 'CIDB contractor registration / grading', 'Construction Industry Development Board', 'company', 'registration', 'companies.cidb_grading', 'E1: 22 tenders / 20 buyers', 14),
  ('bbbee', 'B-BBEE certificate / sworn affidavit', 'SANAS-accredited agency / commissioner of oaths / CIPC', 'company', 'certification', 'companies.bee_proof_* (vault)', 'C1: 47 tenders / 44 buyers', 15),
  -- Person professional councils and memberships (J3, E4)
  ('sacap', 'SACAP registration (architectural)', 'SA Council for the Architectural Profession', 'person', 'professional_council', null, 'J3; DPWI EC architect roles (0016)', 20),
  ('sacqsp', 'SACQSP registration (quantity surveying)', 'SA Council for the Quantity Surveying Profession', 'person', 'professional_council', null, 'J3', 21),
  ('sacplan', 'SACPLAN registration (town planning)', 'SA Council for Planners', 'person', 'professional_council', null, 'J3; E4 MEGA/2027/05 t070', 22),
  ('sacpvp', 'SACPVP registration (property valuer)', 'SA Council for the Property Valuers Profession', 'person', 'professional_council', null, 'J3; E4 Mossel Bay t068, Nkangala t082; LEDA valuer', 23),
  ('eapasa', 'EAPASA registration (environmental assessment practitioner)', 'Environmental Assessment Practitioners Association of SA', 'person', 'professional_council', null, 'J3', 24),
  ('hpcsa', 'HPCSA registration', 'Health Professions Council of SA', 'person', 'professional_council', null, 'E8 / J3: Correctional Services t022, SASSA KZN t103', 25),
  ('irba', 'IRBA registered auditor', 'Independent Regulatory Board for Auditors', 'both', 'professional_council', null, 'audit tenders (§6.2)', 26),
  ('saica', 'SAICA membership (CA(SA))', 'SA Institute of Chartered Accountants', 'person', 'professional_council', null, 'audit / accounting tenders (§6.2)', 27),
  ('saipa', 'SAIPA membership', 'SA Institute of Professional Accountants', 'person', 'professional_council', null, 'audit / accounting tenders (§6.2)', 28),
  ('iia_cia', 'IIA membership / Certified Internal Auditor', 'Institute of Internal Auditors SA', 'person', 'professional_council', null, 'E4 / J3: National Lotteries Commission t078', 29),
  ('isaca', 'ISACA certification (CISA / CISM ...)', 'ISACA', 'person', 'certification', null, 'E4 / J3 (audit firms)', 30),
  ('saqa_foreign_evaluation', 'SAQA evaluation of a foreign qualification', 'South African Qualifications Authority', 'person', 'certification', null, 'J3', 31),
  ('mediation_accreditation', 'Accredited mediator', 'accrediting mediation body', 'person', 'accreditation', null, 'J3: DALRRD RQ-016988 t028', 32),
  ('assessor_moderator', 'Assessor / moderator registration', 'SETA / QCTO', 'person', 'accreditation', null, 'E7 / J3: ETDP SETA t036', 33),
  ('wireman_licence', 'Wireman''s licence / registered person (electrical)', 'Dept of Employment and Labour', 'person', 'licence_permit', null, 'E14: CSIR RFQ 9548 t024', 34),
  -- Held by a company and/or its people
  ('psira', 'PSIRA registration + letter of good standing', 'Private Security Industry Regulatory Authority', 'both', 'registration', null, 'E3: CoCT 99S t016, EC Agriculture t032, KZN HS t053, Mpumalanga SD t073, RAF t089, SARS t102 (company and directors)', 40),
  ('saracca', 'SARACCA registration (refrigeration / air-conditioning)', 'SA Refrigeration and Air Conditioning Contractors Association', 'both', 'industry_association', null, 'E5: ESKOM LC SI-138 t029 ("company''s or director''s name")', 41),
  ('saqcc_gas', 'SAQCC Gas registration', 'SA Qualification and Certification Committee for Gas', 'both', 'registration', null, 'E5: CSIR RFQ 9548 t024', 42),
  ('pest_control_act36', 'Pest control operator registration (Act 36 of 1947)', 'Dept of Agriculture', 'both', 'registration', null, 'E15: Gauteng COGTA t042', 43),
  ('firearm_licence', 'Firearm licence / firearm range approval', 'SAPS Central Firearms Registry', 'both', 'licence_permit', null, 'E11: EC Agriculture t032, SARS t102 (company or owner name)', 44),
  ('security_vetting', 'Security vetting / clearance', 'State Security Agency / client vetting', 'both', 'clearance', null, 'E10: CEF t011, DOD t027, Transnet t115', 45),
  -- Company only
  ('ncca', 'NCCA membership (cleaning)', 'National Contract Cleaners Association', 'company', 'industry_association', null, 'E5: ATNS t001', 50),
  ('beeca', 'BEECA membership (cleaning)', 'Building and Environmental Cleaning Employers Association', 'company', 'industry_association', null, 'E5: ATNS t001', 51),
  ('ispa', 'ISPA membership', 'Internet Service Providers'' Association', 'company', 'industry_association', null, 'E5: CEF t011', 52),
  ('ethics_safeline', 'Ethics Institute Safeline-EX accreditation', 'The Ethics Institute', 'company', 'accreditation', null, 'E5: ERWAT ERW2605/01 t037 (mandatory, in the company''s name)', 53),
  ('icasa_licence', 'ICASA licence (ECS / ECNS / radio frequency)', 'Independent Communications Authority of SA', 'company', 'licence_permit', null, 'E12: Amatola Water t007, EC Agriculture t032', 54),
  ('electrical_contractor', 'Electrical contractor registration', 'Dept of Employment and Labour', 'company', 'registration', null, 'E14: CSIR RFQ 9548 t024', 55),
  ('hazardous_waste_permit', 'Hazardous waste transporter / disposal registration', 'DFFE / provincial environment department', 'company', 'licence_permit', null, 'E6: City Power t015, Gauteng COGTA t042', 56),
  ('waste_licence', 'Waste management licence (facility)', 'DFFE / provincial environment department', 'company', 'licence_permit', null, 'E6: City Power t015, NMISA t074, SANSA t100', 57),
  ('waste_information_system', 'Waste Information System registration', 'provincial / SA Waste Information System', 'company', 'registration', null, 'E6: Gauteng COGTA t042', 58),
  ('seta_accreditation', 'SETA accreditation (skills development provider)', 'the relevant SETA', 'company', 'accreditation', null, 'E7: CoJ t014, CATHSSETA t026, merSETA t061, Rand Water t088', 59),
  ('qcto_accreditation', 'QCTO accreditation (SDP / assessment centre)', 'Quality Council for Trades and Occupations', 'company', 'accreditation', null, 'E7: CATHSSETA t026, merSETA t061', 60),
  ('ambulance_licence', 'Ambulance / EMS licence (per district)', 'provincial Department of Health', 'company', 'licence_permit', null, 'E8: National Health t046', 61),
  ('sahpra_licence', 'SAHPRA licence (manufacture / wholesale)', 'SA Health Products Regulatory Authority', 'company', 'licence_permit', null, 'E8: National Health HP08-2026SSP/01 t046', 62),
  ('haccp', 'HACCP certification', 'accredited certification body', 'company', 'certification', null, 'E9: Tygerberg Hospital t116', 63),
  ('food_premises_coa', 'Certificate of acceptability for food premises (R638)', 'municipal environmental health', 'company', 'certification', null, 'E9: CoJ t014, Tygerberg t116', 64),
  ('halaal', 'Halaal certificate', 'recognised Halaal authority', 'company', 'certification', null, 'E9: Tygerberg Hospital t116 (in the bidder''s name)', 65),
  ('oem_authorisation', 'OEM / principal authorisation (partner, reseller, distributor)', 'the manufacturer / principal', 'company', 'accreditation', null, 'E2: MER t000, ATNS t001, Amatola t007, CEF t011, National Health t046, Limpopo Premier t058, Treasury t080, DWS t119', 66),
  ('banks_act_registration', 'Banks Act registration', 'Prudential Authority', 'company', 'registration', null, 'E13: Mossel Bay TDR31 t067', 67),
  ('diamond_dealer_licence', 'Diamond dealer licence (s32) / authorised representative (s54)', 'SA Diamond and Precious Metals Regulator', 'company', 'licence_permit', null, 'E13: SIU t107', 68);

-- ---------------------------------------------------------------------------
-- 3. Bank accounts - restricted to company owners / admins
-- ---------------------------------------------------------------------------
create table bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  principal_id uuid references company_principals(id) on delete cascade, -- null = the company's own account
  bank_name text not null,
  branch_name text,
  branch_code text,
  account_holder text not null,
  account_type text check (account_type in ('cheque', 'current', 'savings', 'transmission', 'other')),
  account_number text not null check (account_number ~ '^[0-9]{6,16}$'),
  opened_on date,              -- "account age" (SAA vendor form, Nkangala Form H)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index bank_accounts_one_company_account on bank_accounts(company_id) where principal_id is null;
create unique index bank_accounts_one_per_principal on bank_accounts(principal_id) where principal_id is not null;
comment on table bank_accounts is
  'Bank account numbers (0050, Sarel Q-MD1). Readable and writable ONLY by company owners/admins (RLS); other members use bank_account_summaries() (last 4 digits). Not written into any generated document (fill_docx_forms.py still prints WITHHELD).';
comment on column bank_accounts.account_number is 'Restricted. Digits only. Never log, never put in a URL or an error message.';

alter table bank_accounts enable row level security;
create policy "bank_accounts: owners and admins only" on bank_accounts
  for all to authenticated
  using (tt_is_company_admin(company_id))
  with check (tt_is_company_admin(company_id));

create or replace function tt_bank_accounts_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.principal_id is not null and not exists (
    select 1 from company_principals where id = new.principal_id and company_id = new.company_id
  ) then
    raise exception 'bank_accounts: principal_id must be a principal of the same company' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger tt_bank_accounts_check before insert or update on bank_accounts
  for each row execute function tt_bank_accounts_check();

-- Masked view for any member: which accounts exist, never the number.
create or replace function bank_account_summaries(p_company uuid)
returns table (id uuid, principal_id uuid, bank_name text, account_holder text, account_type text, last4 text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.id, b.principal_id, b.bank_name, b.account_holder, b.account_type, right(b.account_number, 4)
  from bank_accounts b
  where b.company_id = p_company and is_company_member(p_company);
$$;
revoke all on function bank_account_summaries(uuid) from public;
grant execute on function bank_account_summaries(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Landlord / property tenders - per building
-- ---------------------------------------------------------------------------
create table company_properties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  physical_address text,
  erf_number text,             -- "stand/ERF number" (EC Agriculture SCMU8-0143)
  town text,
  local_municipality text,
  province text,
  -- Basis on which the company may offer the building: registered owner
  -- (title deed), agent with the owner's mandate / letter of authority, or
  -- buying it (offer to purchase / sale agreement + bond) - Legal Aid 51/2026
  -- 2.2.1-2.2.2, NW PW PWR 39/26, RAF PR10118955 1.4.
  ownership_basis text check (ownership_basis in ('registered_owner', 'agent_with_mandate', 'purchase_or_bond')),
  registered_owner text,
  title_deed_number text,
  gross_lettable_area_m2 numeric(10, 2) check (gross_lettable_area_m2 is null or gross_lettable_area_m2 > 0),
  parking_bays_covered integer check (parking_bays_covered is null or parking_bays_covered >= 0),
  parking_bays_open integer check (parking_bays_open is null or parking_bays_open >= 0),
  sapoa_grade text check (sapoa_grade in ('P', 'A', 'B', 'C')), -- SAPOA office grading (NW PW: min C; RAF: B)
  ground_floor_space boolean,  -- RAF PR10118955: "on the ground floor"
  wheelchair_accessible boolean, -- EC Agriculture / Legal Aid accessibility rows
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index company_properties_company on company_properties(company_id);
comment on table company_properties is
  'A building the company offers to lease to a buyer (0050, Sarel Q-MD3). Facts limited to what real lease tenders ask; rent / escalation / lease period are per tender.';

alter table company_properties enable row level security;
create policy "company_properties: tenant isolation" on company_properties
  for all to authenticated
  using (is_company_member(company_id))
  with check (is_company_member(company_id));

create table property_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  property_id uuid not null references company_properties(id) on delete cascade,
  -- Open slug (same rule as 0037 company_document_templates.document_type);
  -- the known types and their evidence are app/lib/properties.ts.
  document_type text not null check (document_type ~ '^[a-z][a-z0-9_]{0,62}$'),
  reference_number text,       -- title deed no., certificate no.
  issued_on date,              -- several tenders want <= 12 months old (pest control, SAPOA grading)
  valid_until date,            -- where the document carries one (building insurance, a rates clearance)
  storage_path text,
  original_filename text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (tt_path_in_company(storage_path, company_id))
);
create unique index property_documents_one_per_type on property_documents(property_id, document_type);
comment on table property_documents is
  'Per-building documents a lease tender asks for: title deed, owner mandate, occupancy / zoning / fire / electrical CoC / pest control / SAPOA grading / rates clearance ... (0050). valid_until feeds watch_deadlines.py.';

alter table property_documents enable row level security;
create policy "property_documents: tenant isolation" on property_documents
  for all to authenticated
  using (is_company_member(company_id))
  with check (is_company_member(company_id));

create or replace function tt_property_rows_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'property_documents' then
    if not exists (select 1 from company_properties where id = new.property_id and company_id = new.company_id) then
      raise exception 'property_documents: property_id must be a property of the same company' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger tt_property_rows_check before insert or update on company_properties
  for each row execute function tt_property_rows_check();
create trigger tt_property_rows_check before insert or update on property_documents
  for each row execute function tt_property_rows_check();
