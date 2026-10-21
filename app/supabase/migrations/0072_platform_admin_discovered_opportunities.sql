-- Super admin review of every discovered opportunity (Sarel, 2026-10-19:
-- "In the admin panel I need to be able to review what came in and if our
-- engines understand and interpret and can compile each one").
--
-- discovered_opportunities (0004) is tenant-scoped (one row per company x
-- release, scored against that company's own profile - see 0004's header) -
-- there is no existing cross-tenant read of it anywhere in the app. This adds
-- one, same escape hatch as platform_admin_companies (0064): gated by
-- is_platform_admin() (0043), SECURITY DEFINER, set search_path = public,
-- pg_temp, no change to discovered_opportunities' own RLS (members still only
-- see their own company's rows for the ordinary /discovery page).
--
-- What "can our engine understand and interpret and compile this" means at
-- THIS table: a discovered opportunity has no uploaded documents yet - a
-- company only uploads/downloads real files once it "pursues" one
-- (pursue_discovered_opportunity, 0024/0051) and goes through intake
-- (engine/intake/classify_tender.py). classify_tender.py's actual
-- compile-readiness check (SANRAL workbook family fingerprint match via
-- engine/fingerprint.py detect_family, required-document detection) runs on
-- OPENED files, which do not exist at discovery stage. So this function does
-- not attempt that check - it returns the raw ingredients (document_urls,
-- categories, reasons, score_outlook, source) that the admin page's
-- lib/compileReadiness.ts classifies into "Flagged" / "Needs documents
-- downloaded" / "Looks ready" (a filename-pattern guess only, never a real
-- open-and-check). See that file for exactly what each status can and can't
-- tell a reviewer.
--
-- ---------------------------------------------------------------------------
-- Scope addition, same day (Sarel, relayed mid-build): "run our engines to
-- unpack the specs and requirements and make the list of everything that is
-- needed and make sure we have an engine that perfectly understands how to
-- complete, build and compile each one and indicate the confidence level, I
-- then need to review and help improve the confidence levels."
--
-- Part 2 (discovered_opportunity_requirements) is the real requirements
-- extraction this asks for, wired to the permanent document store the
-- separate document-download task just added (discovered_opportunity_documents,
-- migration 0071 under this repo's current numbering - see that migration's
-- own header). engine/discovery/opportunity_requirements.py runs the exact
-- same classifier a real tender intake uses (engine/intake/classify_tender.py's
-- classify_documents() / check_fingerprint()) against whatever has actually
-- been downloaded for a release, and writes ONE shared row per release_key
-- here - same shared-not-tenant-scoped reasoning as
-- discovered_opportunity_documents itself (documents, and what they say
-- about compile-readiness, belong to the release, not to any one company's
-- verdict on it).
--
-- Part 3 (confidence_override_* columns + the override RPC) is per
-- OPPORTUNITY (company-specific), not per release: Sarel reviews each
-- company's own discovered_opportunities row, and his correction is a note
-- on THAT review, never silently overwritten by a later re-classification -
-- the computed confidence lives in a different table (part 2) and the
-- override lives here, so one can never clobber the other.
--
-- File order note: Part 1 (platform_admin_discovered_opportunities(), the
-- read function) is written and documented FIRST above because it is the
-- conceptual centrepiece of this migration, but it SELECTs from Part 2's
-- table and Part 3's new columns, both of which must exist before a `language
-- sql` function body can reference them (unlike plpgsql, a sql function is
-- planned at CREATE time, not first call). So Part 2 and Part 3 are placed
-- BELOW, and Part 1's own CREATE FUNCTION statement is placed LAST in the
-- file, after both - the numbering here describes each part's role, not its
-- physical top-to-bottom position.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Part 2: discovered_opportunity_requirements - one row per RELEASE
-- (release_key, same identity discovered_opportunity_documents and
-- watch_new_tenders.release_key() use), written by
-- engine/discovery/opportunity_requirements.py (service role). Shared/
-- public like discovered_opportunity_documents - see this migration's
-- header for why release-level, not per-opportunity.
-- ---------------------------------------------------------------------------
create table discovered_opportunity_requirements (
  release_key text primary key check (length(release_key) between 1 and 300),
  source text,
  buyer text,

  -- classify_tender.classify_documents()'s own decision, verbatim:
  route text check (route is null or route in ('sanral', 'general')),
  family text, -- e.g. 'Conventional Consultant Tender', 'RRM Consultant Tender', 'General (non-SANRAL)'
  signal text not null, -- the human-readable sentence classify_documents()/this script produced
  required_documents jsonb not null default '[]'::jsonb, -- decision['sanral_documents'] when route='sanral'; [] for general (see header: a general tender's real requirement list needs the full LLM-backed intake pass, not fabricated here)
  missing text[] not null default '{}', -- labels of required SANRAL documents NOT found among what was downloaded
  fingerprint_status text check (fingerprint_status is null or fingerprint_status in ('ok', 'mismatch', 'no_baseline', 'error')),
  unreadable_documents text[] not null default '{}', -- workbooks that could not even be opened, or storage fetch failures

  failed_downloads int not null default 0, -- discovered_opportunity_documents rows for this release with status='failed'
  document_count int not null default 0, -- documents actually classified against (downloaded + a recognised extension)

  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
comment on table discovered_opportunity_requirements is
  'engine/discovery/opportunity_requirements.py''s real classification of a release''s downloaded documents (engine/intake/classify_tender.py''s own classify_documents()/check_fingerprint(), the same functions a real tender intake uses) - one shared row per release_key, not per company. Absence of a row for a release means its documents have not been downloaded/classified yet (SANRAL releases never get one - see this migration''s header). Written by the service role only.';
comment on column discovered_opportunity_requirements.missing is
  'Required SANRAL documents (C.1.1.1/C.1.2.3/A-Forms/Financial workbook) not found among what was downloaded for this release - empty when route is not sanral, or when everything required was found.';

alter table discovered_opportunity_requirements enable row level security;
create policy "discovered_opportunity_requirements readable by authenticated users"
  on discovered_opportunity_requirements for select to authenticated using (true);
-- No insert/update/delete policy for authenticated clients - written only by
-- opportunity_requirements.py via the service role, same as
-- discovered_opportunity_documents.

-- ---------------------------------------------------------------------------
-- Part 3: Sarel's confidence override + note, per discovered_opportunities
-- row. A plain column pair, not a new table: this is one admin's running
-- correction on one review, the same shape as 0022's harness-run
-- reviewed_at/review_note, not a history or a feedback-training pipeline.
-- ---------------------------------------------------------------------------
alter table discovered_opportunities
  add column confidence_override smallint check (confidence_override is null or (confidence_override between 0 and 100)),
  add column confidence_override_note text,
  add column confidence_overridden_at timestamptz,
  add column confidence_overridden_by uuid references auth.users(id) on delete set null;
comment on column discovered_opportunities.confidence_override is
  'Sarel''s own corrected compile-confidence (0-100), set via platform_admin_override_opportunity_confidence() below. Null = no override; the computed confidence (lib/compileReadiness.ts, from this row + discovered_opportunity_requirements) is shown instead. Never recomputed over automatically - only this RPC writes it.';

create or replace function platform_admin_override_opportunity_confidence(
  p_opportunity_id uuid, p_override_level smallint, p_note text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not is_platform_admin() then
    raise exception 'Only a Tender Tool platform admin can do this' using errcode = '42501';
  end if;
  if p_override_level is not null and (p_override_level < 0 or p_override_level > 100) then
    raise exception 'Confidence override must be between 0 and 100' using errcode = '22023';
  end if;
  update discovered_opportunities
     set confidence_override = p_override_level,
         confidence_override_note = p_note,
         confidence_overridden_at = case when p_override_level is null then null else now() end,
         confidence_overridden_by = case when p_override_level is null then null else auth.uid() end
   where id = p_opportunity_id;
  if not found then
    raise exception 'Discovered opportunity not found' using errcode = 'P0002';
  end if;
end;
$$;
comment on function platform_admin_override_opportunity_confidence(uuid, smallint, text) is
  'Sarel''s correction to one discovered opportunity''s compile-confidence (/admin/discovered-opportunities). p_override_level=null clears the override, reverting the page to the computed value. Platform-admin only (0043).';
revoke all on function platform_admin_override_opportunity_confidence(uuid, smallint, text) from public;
grant execute on function platform_admin_override_opportunity_confidence(uuid, smallint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Part 1: the super-admin read function itself - placed last because it
-- SELECTs from Part 2's table and Part 3's new columns (see the file-order
-- note in the header above).
-- ---------------------------------------------------------------------------
create or replace function platform_admin_discovered_opportunities()
returns table (
  id uuid,
  company_id uuid,
  company_name text,
  contract_number text,
  buyer text,
  title text,
  closing_date timestamptz,
  categories text[],
  document_depth text,
  verdict text,
  reasons text[],
  source text,
  tender_type text,
  province text,
  listing_status text,
  document_urls jsonb,
  score_outlook jsonb,
  downgraded_from text,
  first_seen timestamptz,
  tender_id uuid,
  requirements_status text,
  requirements_route text,
  requirements_family text,
  requirements_signal text,
  requirements_documents jsonb,
  requirements_missing text[],
  requirements_fingerprint_status text,
  requirements_unreadable text[],
  requirements_failed_downloads int,
  requirements_document_count int,
  confidence_override smallint,
  confidence_override_note text,
  confidence_overridden_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    o.id, o.company_id,
    coalesce(c.csd_trading_name, c.legal_name),
    o.contract_number, o.buyer, o.title, o.closing_date,
    o.categories, o.document_depth, o.verdict, o.reasons,
    o.source, o.tender_type, o.province, o.listing_status,
    o.document_urls, o.score_outlook, o.downgraded_from,
    o.first_seen, o.tender_id,
    case when r.release_key is null then 'not_downloaded' else 'extracted' end,
    r.route, r.family, r.signal, r.required_documents, r.missing,
    r.fingerprint_status, r.unreadable_documents, r.failed_downloads, r.document_count,
    o.confidence_override, o.confidence_override_note, o.confidence_overridden_at
  from discovered_opportunities o
  join companies c on c.id = o.company_id
  left join discovered_opportunity_requirements r
    on r.release_key = coalesce(o.ocid, o.contract_number)
  where is_platform_admin()
  order by o.first_seen desc;
$$;
comment on function platform_admin_discovered_opportunities() is
  'Every company''s discovered_opportunities row (0004), left-joined to its release''s real requirements extraction (discovered_opportunity_requirements, written by engine/discovery/opportunity_requirements.py) when one exists, for the super admin review screen (/admin/discovered-opportunities). Returns nothing unless the caller is a platform admin (0043). requirements_status=''not_downloaded'' means no row exists yet - lib/compileReadiness.ts is the single place that turns all of this into a status/confidence number; this function does no classification itself.';
revoke all on function platform_admin_discovered_opportunities() from public;
grant execute on function platform_admin_discovered_opportunities() to authenticated;
