-- Tender search tags, scope/pricing/BOQ record, estimated value band
-- (Sarel, 2026-10-18, verbatim: "Tenders need to be tags by industry sne by
-- discupline or type of seevice to easy search. We must also extract the
-- scope and pricing model and BOQ for record, and estimated project value
-- band"). Scope of this migration: (1) industry/discipline search tags on
-- tenders, (2) scope/pricing-model/BOQ record, (3) value band. The next
-- agent's pricing-engine/market-trend work (winning prices -> pricing
-- adjustments) is NOT touched here.
--
-- 1. Industry + discipline tags on `tenders` (the SHARED/PUBLIC table, 0001 -
--    one row per real tender, not per company - the right place for a
--    search tag, unlike discovered_opportunities which is per company).
--    This reuses discipline_categories (0040) as its vocabulary rather than
--    inventing a second taxonomy, per the audit note on that migration ("a
--    new category is an INSERT, no migration needed") - exactly what Sarel
--    asked for discipline tags, and it already has the right shape for an
--    "industry" tag too: discipline_categories is two levels, a GROUP
--    (parent_slug null - e.g. roads_civil, it_telecoms, professional_services,
--    security_facilities - these already read as "industries") and its
--    specific DISCIPLINES (the service types within it). So:
--      industry_tags   = matched group-level slugs (a tender's own text, plus
--                         the group of every matched discipline)
--      discipline_tags = matched discipline-level (child) slugs
--    Classifier: engine/discovery/tender_enrichment.py (industry-agnostic -
--    the same taxonomy.py matcher already proven across construction, IT,
--    professional-services, security/facilities, environmental, etc - see
--    that module's tests for examples from unrelated industries).
--    This is DIFFERENT from discovered_opportunities.categories (0004): that
--    is a per-company preview row, written by assess_tender.categorize()
--    for FIT SCORING against one company's own tags. These columns are on
--    the shared tender record, for cross-tenant search/filter - any
--    signed-in user can search by them regardless of their own company's
--    tags. (A given tender's industry_tags/discipline_tags will usually
--    agree with what categorize() computes from the same text, since both
--    call the same taxonomy matcher - that's intentional reuse of a single
--    proven classifier, not a second independent one.)
alter table tenders add column if not exists industry_tags text[] not null default '{}';
alter table tenders add column if not exists discipline_tags text[] not null default '{}';
alter table tenders add column if not exists tags_updated_at timestamptz;

comment on column tenders.industry_tags is
  'Group-level discipline_categories slugs (0040) this tender''s own title/description matched, for cross-tenant search/filter. Computed by engine/discovery/tender_enrichment.py (heuristic/keyword, industry-agnostic). Not company-specific - see discovered_opportunities.categories (0004) for the per-company fit-scoring equivalent.';
comment on column tenders.discipline_tags is
  'Specific discipline_categories slugs (0040, child rows) this tender''s own title/description matched. Same classifier/provenance as industry_tags.';
comment on column tenders.tags_updated_at is
  'When tender_enrichment.py last (re)computed industry_tags/discipline_tags for this tender. Null = not yet enriched.';

create index tenders_industry_tags_idx on tenders using gin (industry_tags);
create index tenders_discipline_tags_idx on tenders using gin (discipline_tags);

-- 2 + 3. Scope summary, pricing model, BOQ (for record), value band.
-- One row per tender (shared, like tender_requirements/tender_documents -
-- 0001 comment: "written only by the discovery pipeline (service role)").
--
-- Honesty about what each field really is (System-Status.md / confirm_pack.py
-- "we stop, we never guess" principle - carried into this table's own
-- columns rather than asserted only in a comment):
--   scope_summary   - the tender's own description text (title/description
--                      already captured at discovery time by gov_sources.py/
--                      etenders_national.py), lightly cleaned, NOT an AI or
--                      document summary - no document-summarisation pipeline
--                      exists in this repo (checked: engine/general/ and
--                      engine/pack_generator/ parse specific SANRAL/SBD/MBD
--                      form fields, never a free-text scope section). When a
--                      fetched document's text is available (the same
--                      pdftotext path assess_tender.py already uses) and
--                      contains a "SCOPE OF WORK" heading, the snippet after
--                      it is used instead and scope_source says so.
--   pricing_model    - keyword match only ("lump sum" / "schedule of rates" /
--                      "bill of quantities" / "cost reimbursable" / ...) in
--                      whatever text was available - null when the text
--                      doesn't state or imply one. Never inferred from the
--                      buyer/sector.
--   boq_summary      - {"referenced": bool, "items": [], "note": "..."}.
--                      `items` is ALWAYS empty: no BOQ/.xlsm spreadsheet
--                      parser exists anywhere in this repo (checked
--                      engine/discovery/, engine/pack_generator/, engine/ root
--                      - engine/fill_financial.py explicitly treats the BOQ
--                      price figures as the tenderer's own business decision,
--                      never read from a buyer document). `referenced` only
--                      records that the text/a document title MENTIONS a BOQ
--                      - not its contents. Real BOQ line-item extraction would
--                      need a new document-reading pipeline; out of scope for
--                      this pass (see engine/discovery/tender_enrichment.py
--                      module docstring and the agent report).
--   value_band       - one of the bands below, set ONLY when the source text
--                      explicitly states a contract/project/tender value or
--                      budget near an anchor phrase ("estimated value",
--                      "contract value", "engineer's estimate", "budget" ...)
--                      - never derived from a BOQ total (none is extracted)
--                      or guessed from sector/buyer. Null + value_band_basis
--                      'unknown' otherwise, which is the common case for most
--                      tenders (most adverts don't state a value) - an
--                      honest blank, not an invented number.
--   confidence        - 'heuristic' always for now (keyword/regex, no model);
--                      kept as its own column (not a free-text note) so a
--                      future real-extraction pass can mark rows
--                      'document_confirmed' without a schema change, the
--                      same confirmed/heuristic distinction assess_tender.py
--                      already uses for CIDB/BBEE signals.
create table tender_scope_records (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  scope_summary text,
  scope_source text check (scope_source in ('description_text', 'document_scope_snippet')),
  pricing_model text check (pricing_model in (
    'lump_sum', 'schedule_of_rates', 'boq_based', 'cost_reimbursable', 'remeasurement', 'time_based'
  )),
  boq_summary jsonb not null default '{"referenced": false, "items": [], "note": null}'::jsonb,
  value_band text check (value_band in ('R0-5m', 'R5-20m', 'R20-50m', 'R50m+')),
  value_band_basis text not null default 'unknown' check (value_band_basis in ('stated_in_text', 'unknown')),
  value_band_raw_amount numeric(16, 2), -- the rand amount parsed from the text, before banding (provenance)
  confidence text not null default 'heuristic' check (confidence in ('heuristic', 'document_confirmed')),
  source_note text, -- plain-language note on where each value came from (quote/anchor phrase), like data_notes on 0053
  extracted_at timestamptz not null default now(),
  unique (tender_id)
);

comment on table tender_scope_records is
  'Scope/pricing-model/BOQ extraction (heuristic, for record) and estimated value band per tender (Sarel, 2026-10-18). One row per tenders(id) - see column comments and engine/discovery/tender_enrichment.py for exactly what is real extraction vs. keyword heuristic. Shared reference data like discipline_categories/public_tender_outcomes: service-role written, readable by any signed-in user.';
comment on column tender_scope_records.boq_summary is
  'items is always [] in this pass - no BOQ/.xlsm line-item parser exists in this repo (checked engine/discovery/, engine/pack_generator/). referenced records only that a BOQ is MENTIONED (title/description/document filename), never its contents.';
comment on column tender_scope_records.value_band_basis is
  'stated_in_text = a rand amount was found near a value/budget anchor phrase in the available text; unknown = no such signal (the common case) - value_band is left null rather than guessed.';

create index tender_scope_records_tender_idx on tender_scope_records (tender_id);
create index tender_scope_records_value_band_idx on tender_scope_records (value_band) where value_band is not null;

alter table tender_scope_records enable row level security;
create policy "tender_scope_records readable by authenticated users" on tender_scope_records
  for select to authenticated using (true);
