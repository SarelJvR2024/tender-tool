-- Field-level provenance tracking (spec item 29, docs/specs/Tender-Tool-Competitor-
-- Feature-Deep-Dive.md "Admin maintenance console and tender readiness reporting").
--
-- Every value this product writes into a document already comes from one of a small
-- number of sources, and the engine scripts already distinguish them internally -
-- fingerprint.py's blocking-vs-warning split, fill_financial_hours.py's refusal to
-- fill a null, the SBD4 assumed-"No" answers fill_a_forms.py writes alongside a
-- matching ACTIONS_TO_SIGN.md line. This table makes that ONE consistent, queryable
-- structure instead of four scripts each inventing their own way to say "I'm not
-- sure about this" - the foundation both the admin review console (item 31) and the
-- user-facing readiness report (item 32) read from.
--
-- One row per (tender_pack, field). A field is anything the pipeline writes or
-- decides not to write - a cell in a workbook, a paragraph in a docx, an hours entry,
-- a yes/no declaration. field_key is a human-readable dotted path scoped to whichever
-- script owns it (e.g. "a_forms.A8.litigation", "financial_hours.Roadworks.A.PL",
-- "contract_data.henning_email") - deliberately text, not a foreign key into any one
-- document table, because provenance applies across every document type this
-- pipeline touches, not just one.

create table field_provenance (
  id uuid primary key default gen_random_uuid(),
  tender_pack_id uuid not null references tender_packs(id) on delete cascade,
  field_key text not null,
  status text not null check (status in ('confirmed', 'computed', 'assumed_default', 'missing')),
  value text, -- the actual value written into the document; null when status = 'missing'
  reason text, -- why this status, in plain language a non-technical user can read -
  -- e.g. "no debt to SANRAL on file, not independently re-verified today" or
  -- "Henning's email address is not on file" - never left blank for assumed_default
  -- or missing (a status without a stated reason is exactly the silent-guess problem
  -- this table exists to fix)
  source text not null, -- which script/process set this, e.g. "fill_a_forms.py", "fill_financial_hours.py"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tender_pack_id, field_key)
);
comment on table field_provenance is
  'One row per generated field per tender pack: confirmed (a human entered/approved it), computed (derived mechanically from confirmed values, no judgment call), assumed_default (best available answer, not independently re-verified for this submission), or missing (genuinely not available). Read by the admin review console and the user-facing tender readiness report - see spec items 29-32.';
comment on column field_provenance.reason is
  'Required in practice for assumed_default and missing (enforced by the application layer, not a DB constraint, since the right wording is part of the judgment call item 29''s own open questions describe) - never surface a status to a user without saying why.';

create index field_provenance_tender_pack_id_idx on field_provenance(tender_pack_id);
create index field_provenance_status_idx on field_provenance(status);

alter table field_provenance enable row level security;

create policy "field_provenance: tenant isolation via parent pack" on field_provenance
  for all to authenticated using (
    exists (select 1 from tender_packs tp where tp.id = tender_pack_id and is_company_member(tp.company_id))
  ) with check (
    exists (select 1 from tender_packs tp where tp.id = tender_pack_id and is_company_member(tp.company_id))
  );

create trigger field_provenance_set_updated_at before update on field_provenance
  for each row execute function set_updated_at();
