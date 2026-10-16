-- Company office locations, structured for locality scoring.
--
-- Sarel, 2026-10-16 (answer 11 to the Tender-Evaluation-Engine-Audit open
-- questions): "Yes office location sometimes counts for scoring."
--
-- Evidence (docs/specs/Tender-Evaluation-Engine-Audit.md, "Round 2"): of the
-- non-SANRAL tenders read, six score or require locality, at three levels of
-- government geography, and each says what proves it:
--   - DPWI Eastern Cape (SCMU5-26/27-0007SB): "Locality: (a) Within Eastern
--     Cape 4 (b) Outside Eastern Cape 0" - PROVINCE.
--   - Cape Winelands DM (Q 2026/034): "enterprise head office or primary
--     place of business or regional or satellite office is located within the
--     boundaries of the Cape Winelands District Municipal Area" 5, "...Western
--     Cape Province" 5 - DISTRICT or PROVINCE, and ANY office counts (head,
--     regional or satellite). Proof: municipal account <= 90 days, lease, or a
--     bank letter confirming the business address.
--   - Overberg DM: "Within the boundaries of Overberg District 6 / Western
--     Cape 4", verified from the CIPC registered-office address.
--   - uMlalazi LM (KZN ULM 15/26/27): local municipality 4 / King Cetshwayo
--     District 2 / province 1 (specific goals) AND as a functionality
--     criterion (10 / 5 / 2). Proof: utilities, affidavit or lease.
--   - LEDA (Limpopo): "Enterprises located within Limpopo 3".
--   - Dawid Kruiper LM (TN051/2026): 20 points "within the boundaries of
--     Dawid Kruiper", and separately MANDATORY: "must have a local office in
--     the Dawid Kruiper Municipal Jurisdiction ... non-responsive" otherwise.
--
-- So a free-text address isn't enough: the match is against province,
-- district municipality and local municipality, a company can have several
-- offices (any one can satisfy a row), and the kind of office and the proof
-- held matter (Overberg only accepts the CIPC registered office). The
-- registered/postal address text on `companies` is left as-is for forms.
--
-- Tenant-scoped like every company-owned table: is_company_member(company_id).

create table company_offices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  label text, -- e.g. "Head office", "East London site office"
  office_kind text not null default 'branch' check (office_kind in (
    'registered_office', -- CIPC registered address (Overberg verifies locality from this)
    'head_office',
    'branch',            -- regional / satellite office (Cape Winelands counts these)
    'site_office'
  )),
  province text not null check (province in (
    'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
    'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape'
  )),
  -- District or metropolitan municipality, as tenders name it, e.g.
  -- "Cape Winelands District", "King Cetshwayo District", "City of Ekurhuleni".
  district_municipality text,
  -- Local municipality, e.g. "Stellenbosch", "uMlalazi", "Dawid Kruiper".
  local_municipality text,
  town text,
  street_address text,
  -- What the company holds to prove the address - tenders name exactly these.
  proof_type text check (proof_type in (
    'municipal_account', 'lease_agreement', 'bank_letter', 'cipc_registration',
    'title_deed', 'utility_bill', 'affidavit', 'other'
  )),
  proof_date date, -- municipal accounts must be <= 3 months / 90 days old at closing
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table company_offices is
  'Structured office locations for locality specific-goals / functionality scoring (engine/discovery/score_outlook.py match_locality, app/lib/locality.ts). One row per office; any office can satisfy a tender''s locality row. Evidence: docs/specs/Tender-Evaluation-Engine-Audit.md "Round 2".';
comment on column company_offices.proof_date is
  'Date on the proof document (e.g. municipal account). Cape Winelands: not older than 90 days; Dawid Kruiper: not older than 3 months.';

create index company_offices_company_idx on company_offices (company_id);

alter table company_offices enable row level security;
create policy "company_offices: tenant isolation" on company_offices
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

create trigger company_offices_set_updated_at before update on company_offices
  for each row execute function set_updated_at();
