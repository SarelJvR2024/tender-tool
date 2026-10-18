-- SANRAL Form B7 - "Subcontracting to Targeted Enterprises" - answered by the
-- company, per tender (Tender-Regulatory-Compliance-Review.md gap G3; Sarel
-- 2026-10-17: "B7 must be answered by the company").
--
-- SANRAL's Interim Preferential Procurement Policy (Annexure 3) makes 30%
-- subcontracting to Targeted Enterprises a contract condition by contract-value
-- category and the main tenderer's size (category 1 < R6m: QSE + Generic;
-- category 2 R6-25m: Generic only; category 3 > R25m: everyone). Until now the
-- fillers could write Form B7 but nothing supplied the data.
--
-- 1. tenders.sanral_b7_setup: what THIS tender's own Technical workbook says -
--    SETUP!L1 "App. D Category of Tender" (1/2/3), L2 "Subcontracting
--    Compulsary", and SANRAL's own matrix (SETUP!J27:L35) for that category
--    by tenderer size - read by engine/pack/process_pack_jobs.py
--    (sync_b7_setup, engine/sanral_b7.py read_setup) from the uploaded blank
--    workbook. Shared tender data, service-role written, like
--    tender_requirements (0001). The contract value itself is never captured:
--    SANRAL states the category in its own template instead.
--    {"category": 3, "compulsory": "YES",
--     "required_by_size": {"EME": true, "QSE": true, "GENERIC": true},
--     "source_key": "<hash of the copy read>", "read_at": "..."}
--
-- 2. tender_subcontracting_plans: the company's own answer for one tender -
--    either its plan (1-4 Targeted Enterprises: the exact fields Form B7
--    asks, TEND 1X rows 3906-3936) or a record that the tender's own Book 1
--    waives Form B7 (R.396-010-2025/1F: "No sub-contracting requirement for
--    all Entities and submission of form B7 is not required"), with the
--    quoted Book 1 text - never a default. Tenant-scoped; one row per
--    (company, tender).

alter table tenders add column sanral_b7_setup jsonb;
comment on column tenders.sanral_b7_setup is
  'SANRAL Form B7 inputs read from THIS tender''s uploaded Technical workbook SETUP sheet by engine/pack/process_pack_jobs.py (sync_b7_setup): {category 1|2|3 (contract-value band: <R6m, R6-25m, >R25m), compulsory, required_by_size {EME,QSE,GENERIC: bool} from SANRAL''s own matrix, source_key (hash of the workbook copy read), read_at}. Null = not read yet (Form B7 is then treated as required until the company answers).';

create table tender_subcontracting_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  mode text not null check (mode in ('subcontract', 'waived_by_tender')),
  -- waived_by_tender: the tender's own Book 1 Form B7 text, as quoted by the company
  waiver_quote text,
  -- subcontract: [{name, to_be_identified, size 'EME'|'QSE', pct_of_contract,
  --   pct_excl_provisional, black_ownership_pct, bee_level 1-8, head_office,
  --   in_project_province 'YES'|'NO'|null, consulting_engineering_firm
  --   'YES'|'NO'|null, tax_reference}] - percentages as 0-100 numbers.
  --   Field-level rules: app/lib/sanralB7.ts = engine/sanral_b7.py check_plan().
  targeted_enterprises jsonb not null default '[]'::jsonb,
  comments text, -- Form B7 "Comments:" (B3940)
  answered_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, tender_id),
  check (jsonb_typeof(targeted_enterprises) = 'array' and jsonb_array_length(targeted_enterprises) <= 4),
  check (mode <> 'subcontract' or jsonb_array_length(targeted_enterprises) >= 1),
  check (mode <> 'waived_by_tender' or (length(btrim(coalesce(waiver_quote, ''))) > 0
                                        and jsonb_array_length(targeted_enterprises) = 0))
);
comment on table tender_subcontracting_plans is
  'The company''s own answer to SANRAL Form B7 (Targeted Enterprise subcontracting) for one tender: its plan, or the tender''s own Book 1 waiver quoted. Written from the Tender Workspace; read by engine/pack/process_pack_jobs.py, which refuses a pack when Form B7 applies and there is no row.';

create index tender_subcontracting_plans_tender_idx on tender_subcontracting_plans (tender_id, company_id);

alter table tender_subcontracting_plans enable row level security;
create policy "tender_subcontracting_plans: tenant isolation" on tender_subcontracting_plans
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

create trigger tender_subcontracting_plans_set_updated_at before update on tender_subcontracting_plans
  for each row execute function set_updated_at();

-- Same rule 0043 applies to tender_answers: a per-company row may only sit on
-- a tender that company can see (shared, or its own private tender - 0024).
-- Own small trigger function rather than re-creating 0043's shared one.
create or replace function tt_subcontracting_plan_tender_visible()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not tt_tender_visible_to(new.tender_id, new.company_id) then
    raise exception 'tender_subcontracting_plans: this tender is another company''s private tender' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function tt_subcontracting_plan_tender_visible() from public;

create trigger tt_same_company before insert or update of company_id, tender_id on tender_subcontracting_plans
  for each row execute function tt_subcontracting_plan_tender_visible();
