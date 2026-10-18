-- Government tender coverage + listing-level change tracking (2026-10-17,
-- Sarel: "provide the same service [as Leads 2 Business] ... for government
-- tenders"). Engine side: engine/discovery/gov_sources.py (every automatable
-- government source, merged), engine/discovery/tender_changes.py (what
-- changed on those listings between runs). Evidence:
-- docs/specs/Government-Tender-Coverage-Findings.md.
--
-- 1. discovered_opportunities: where a tender was listed, and the listing
--    facts the eTenders portal and the buyers' own sites carry (province,
--    tender type, briefing session) that the OCDS feed never did.
-- 2. tender_listing_snapshots: the change tracker's memory - one row per
--    listing (release_key), the fields it compares run to run. Service role
--    only (no policy): it is engine state, like discovery_seen_releases (0038).
-- 3. tender_listing_changes: one row per detected change (cancelled, closing
--    date moved, briefing moved, new document listed, re-advertised, buyer's
--    own site disagrees with eTenders, Eskom notice published). Public
--    listing facts about public tenders, so readable by every signed-in user
--    (same as `tenders`, 0001) - the Discovery page shows each company the
--    changes on the tenders in ITS feed by joining on ocid. Written by the
--    service role only.
--
--    Not the same thing as 0039's tender_update_notifications: those are
--    documents a pursuing company's tender gained, downloaded and READ
--    (watch_tender_updates.py). These are listing-level facts read from the
--    listings themselves, for every tender in Discovery, pursued or not -
--    notably cancellations, which only the portal's Cancelled tab and Eskom's
--    bulletin carry (the OCDS status field is always blank).
-- 4. pursue_discovered_opportunity(): contract_no from contract_number (now
--    the real bid number - etenders_national.normalize() used to store the
--    portal's internal id there and the bid number in title), and tenders.ocid
--    only for a real OCDS ocid (a direct-site listing's key, e.g.
--    "eskom-bulletin:73478", is kept as the slug, so the document watch never
--    looks for it in OCDS).

-- ---------------------------------------------------------------------------
-- 1. discovered_opportunities
-- ---------------------------------------------------------------------------
alter table discovered_opportunities drop constraint discovered_opportunities_source_check;
alter table discovered_opportunities add constraint discovered_opportunities_source_check
  check (source in ('etenders_ocds', 'manual', 'etenders_portal', 'sanral', 'eskom_bulletin',
                    'transnet_etenders', 'capetown_procurement'));

alter table discovered_opportunities
  add column listing_sources jsonb not null default '[]'::jsonb
    check (jsonb_typeof(listing_sources) = 'array'),
  add column province text,
  add column tender_type text,
  add column briefing jsonb check (briefing is null or jsonb_typeof(briefing) = 'object'),
  add column listing_status text check (listing_status is null or listing_status in
    ('advertised', 'cancelled', 'closed', 'awarded'));

comment on column discovered_opportunities.listing_sources is
  'Every source that lists this tender: [{source, source_id, url}] (gov_sources.merge). A tender on both the eTenders portal and the buyer''s own site has both.';
comment on column discovered_opportunities.briefing is
  '{date, compulsory, venue} as the listing states it; null = no briefing session listed.';
comment on column discovered_opportunities.listing_status is
  'The listing''s own status (eTenders portal tab / buyer site). Null for rows from the OCDS feed, which has none.';

-- ---------------------------------------------------------------------------
-- 2. tender_listing_snapshots
-- ---------------------------------------------------------------------------
create table tender_listing_snapshots (
  release_key text primary key check (length(release_key) between 1 and 300),
  source text not null,
  contract_number text,
  buyer text,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
comment on table tender_listing_snapshots is
  'tender_changes.py''s memory: the compared fields of each government tender listing (closing date, briefing, status, title, listed document names, per-source closing dates) as last read. Service role only.';
alter table tender_listing_snapshots enable row level security;
-- No policies: engine state, read and written by the service role only.

-- ---------------------------------------------------------------------------
-- 3. tender_listing_changes
-- ---------------------------------------------------------------------------
create table tender_listing_changes (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (length(dedupe_key) between 1 and 600),
  release_key text not null,
  ocid text,
  source text not null,
  contract_number text,
  buyer text,
  title text,
  change_type text not null check (change_type in (
    'cancelled', 'closing_date_changed', 'briefing_changed', 'document_added', 'readvertised',
    'sources_disagree', 'title_changed', 'validity_extended', 'bidders_list_published',
    'award_published', 'regret_published')),
  summary text not null,
  old_value jsonb,
  new_value jsonb,
  evidence_url text,
  source_timestamp timestamptz,
  detected_at timestamptz not null default now()
);
comment on table tender_listing_changes is
  'Listing-level changes to government tenders (tender_changes.py): cancellations (eTenders portal Cancelled tab, Eskom bulletin), closing-date and briefing moves, newly listed documents (names only - reading them is watch_tender_updates.py, 0039), re-advertisements, and a buyer''s own site disagreeing with eTenders. Public listing facts; written by the service role only.';
comment on column tender_listing_changes.dedupe_key is
  'One row per real change: release_key + change_type + the new value, so a re-run never records the same change twice.';
comment on column tender_listing_changes.source_timestamp is
  'When the SOURCE says it happened (portal cancellation time, document upload time, notice publish date), if it says; detected_at is when the tracker saw it.';

create index tender_listing_changes_ocid_idx on tender_listing_changes (ocid);
create index tender_listing_changes_detected_idx on tender_listing_changes (detected_at desc);

alter table tender_listing_changes enable row level security;
create policy "tender_listing_changes: readable by authenticated users" on tender_listing_changes
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 4. pursue_discovered_opportunity() (0024's body + 0043's search_path; two lines changed)
-- ---------------------------------------------------------------------------
create or replace function pursue_discovered_opportunity(p_opportunity_id uuid)
returns uuid
language plpgsql
security definer
-- 0043 hardened this function's search_path to (public, pg_temp); kept.
set search_path = public, pg_temp
as $$
declare
  opp discovered_opportunities%rowtype;
  t_id uuid;
  rules jsonb;
begin
  select * into opp from discovered_opportunities where id = p_opportunity_id;
  if not found or not is_company_member(opp.company_id) then
    raise exception 'opportunity not found' using errcode = 'P0002';
  end if;
  if opp.tender_id is not null and exists (select 1 from tenders where id = opp.tender_id) then
    return opp.tender_id;
  end if;

  if opp.score_outlook ? 'experience_evidence' then
    rules := jsonb_build_object(
      'experience_evidence', opp.score_outlook -> 'experience_evidence',
      'locality', jsonb_build_object(
        'rows', coalesce(opp.score_outlook -> 'locality' -> 'rows', '[]'::jsonb),
        'mandatory_local_office', opp.score_outlook -> 'locality' -> 'mandatory_local_office'),
      'source_document', 'discovery outlook (first readable document)',
      'extracted_at', now());
  end if;

  insert into tenders (slug, contract_no, title, description, closing_date, family, status,
                       buyer, ocid, source, document_urls, evaluation_rules)
  values (coalesce(opp.ocid, 'opportunity-' || opp.id::text),
          coalesce(opp.contract_number, opp.title),
          opp.title,
          coalesce(opp.description, opp.title),
          opp.closing_date,
          'General (non-SANRAL)',
          case when opp.closing_date is not null and opp.closing_date < now() then 'closed' else 'open' end,
          opp.buyer,
          case when opp.ocid like 'ocds-%' then opp.ocid end,
          'etenders_ocds', opp.document_urls, rules)
  on conflict (slug) do update set last_seen_at = now()
  returning id into t_id;

  update discovered_opportunities set tender_id = t_id where id = opp.id;

  insert into tender_packs (company_id, tender_id)
  values (opp.company_id, t_id)
  on conflict (company_id, tender_id) do nothing;

  if not exists (select 1 from tenders where id = t_id and document_requirements is not null) then
    insert into tender_engine_jobs (company_id, tender_id, tender_pack_id, kind, requested_by)
    select opp.company_id, t_id, tp.id, 'extract_requirements', auth.uid()
    from tender_packs tp where tp.company_id = opp.company_id and tp.tender_id = t_id
    on conflict (company_id, tender_id, engine, kind) where status in ('requested', 'generating') do nothing;
  end if;

  return t_id;
end;
$$;

revoke all on function pursue_discovered_opportunity(uuid) from public;
grant execute on function pursue_discovered_opportunity(uuid) to authenticated;
