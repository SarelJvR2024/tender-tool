-- Discovery page (Stream 5): surfaces engine/discovery/watch_new_tenders.py's output
-- inside the app instead of it only existing as local JSON/CLI output (docs/specs).
--
-- discovered_opportunities is TENANT-SCOPED like tender_packs/financial_captures, not
-- SHARED/PUBLIC like tenders - unlike tenders (one shared SANRAL feed), the verdict and
-- reasons here are scored against one specific company's profile
-- (assess_tender.py's load_company_profile), so the same OCDS release can score
-- differently for a different tenant. Isolated by company_id + is_company_member(),
-- same pattern as every other tenant-scoped table in 0001.
--
-- Columns match engine/discovery/assess_tender.py's assess_release() return shape
-- and the extra fields watch_new_tenders.py's main() adds on top of it
-- ({**result, "ocid": ..., "documents": ...}) - see that script's new_releases list.
-- Written only by engine/discovery/seed_supabase_opportunities.py (service role),
-- never by a client directly - same reasoning as tenders/tender_documents in 0001,
-- so there is no client insert/update/delete policy here either.

create table discovered_opportunities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,

  -- Straight from assess_release()'s return dict:
  contract_number text,
  buyer text,
  title text,
  closing_date timestamptz,
  categories text[] not null default '{}', -- assess_release()'s categorize() always returns a list
  document_depth text, -- "metadata_only" | "no_extractable_text" | "advert_or_partial" | "full_document" | "not_fetched"
  verdict text not null check (
    verdict in ('strong_fit', 'possible', 'needs_review', 'not_a_fit', 'closed')
  ),
  reasons text[] not null default '{}', -- assess_fit()'s reasons list, one sentence per entry

  -- Added by watch_new_tenders.py on top of assess_release()'s own result
  -- (new_releases.append({**result, "ocid": ..., "documents": ...})):
  ocid text, -- OCDS release's own id; used as the seen-store key when present
  document_urls jsonb not null default '[]'::jsonb, -- watch_new_tenders.py's "documents" list, e.g.
  -- [{"url": "...", "title": "..."}] straight from etenders_national.py's normalize() - kept as
  -- jsonb (not text[]) because each document can carry its own title alongside the URL, and
  -- the page needs both to render a real link label, not just a bare URL.

  first_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);
comment on table discovered_opportunities is
  'One row per (company, OCDS release) the discovery watch has ever scored and reported. Mirrors engine/discovery/watch_new_tenders.py''s report-worthy output (strong_fit/possible/needs_review; not_a_fit and closed are kept for reference per assess_tender.py but were never report-worthy to begin with) into the app, instead of it only existing as CLI stdout / a local JSON file. Written by engine/discovery/seed_supabase_opportunities.py via the service role - never by a client.';
comment on column discovered_opportunities.ocid is
  'OCDS release id, same key watch_new_tenders.py''s seen-store uses (falling back to contract_number when a release has none) - kept here too so the upsert script can target the same row on a re-run.';
comment on column discovered_opportunities.document_urls is
  'The real document URL(s) from the buyer''s own OCDS release, so a human can click through and download - SANRAL''s own site still gates the actual file behind a form/CAPTCHA (see etenders_national.py), this table never stores a downloaded copy.';

-- Partial unique index, not a plain unique constraint: ocid is null for the rare
-- release with none (same case watch_new_tenders.py handles by falling back to
-- contract_number for its seen-store key), and a plain unique(company_id, ocid)
-- would let every null-ocid row collide under upsert's ON CONFLICT semantics.
create unique index discovered_opportunities_company_ocid_key
  on discovered_opportunities (company_id, ocid) where ocid is not null;

create index discovered_opportunities_company_verdict_idx
  on discovered_opportunities (company_id, verdict);
create index discovered_opportunities_company_first_seen_idx
  on discovered_opportunities (company_id, first_seen desc);

alter table discovered_opportunities enable row level security;

create policy "discovered_opportunities: members can select" on discovered_opportunities
  for select to authenticated using (is_company_member(company_id));
-- No insert/update/delete policy for authenticated clients: rows are written only by
-- seed_supabase_opportunities.py via the service role, same as tenders/tender_documents.
