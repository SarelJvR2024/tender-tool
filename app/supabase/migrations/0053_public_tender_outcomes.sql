-- Public tender outcomes: who bid, at what price, who won - for market
-- feedback next to a company's own submitted prices (Sarel, 2026-10-17:
-- "see what we can do with tender submission and award and award price
-- information to provide this as an added benefit to give that analysis
-- feedback"). Design and data coverage: docs/specs/Award-Price-Analysis-Findings.md.
--
-- Source data: engine/discovery/award_outcomes.py (items 17, 28) already
-- reads the two public sources that carry award data - SANRAL's own
-- awarded/closed tender pages (tender opening register: every tenderer and
-- the amount tendered; award: winner, points, approved amount) and the
-- eTenders portal's Awarded tab (winner, amount; a bidders list on a
-- minority of rows). engine/discovery/store_award_outcomes.py writes them
-- here. Nothing is guessed: a register that SANRAL only published inside the
-- reCAPTCHA-gated download is recorded as such, not fetched.
--
-- One row per real tender, not per source row. A SANRAL tender appears on
-- SANRAL's closed list (register), later on its awarded list (winner) and on
-- the eTenders Awarded tab (winner again, with an OCDS id). outcome_key is
-- 'sanral:<first match key>' for anything carrying a SANRAL contract or NRA
-- reference, else 'ocid:<ocid>'. `parts` keeps each source's own normalised
-- record (keyed by source), and every derived column is recomputed from the
-- parts on each write, so a later run of one source never wipes another's.
--
-- Shared reference data, like discipline_categories (0040): readable by any
-- signed-in user, written only by the service role (no client write policy).
--
-- POPIA: bidder names here are juristic persons' names as published by the
-- buyer itself in a statutory award notice / tender opening register (PFMA /
-- MFMA / PPPFA publication duties); the purpose is the same as the
-- publication (transparency about who bid and at what price). Only what that
-- needs is kept: company names, amounts, points, B-BBEE level, dates.
-- award_outcomes.py drops the officials' names, contact people, phone
-- numbers and e-mails before anything reaches this table.
--
-- SANRAL's website Terms & Conditions: reproduction allowed with
-- acknowledgement (`attribution`), unmodified, and "no charge ... upon any
-- recipient of the material". Showing SANRAL-sourced rows to PAYING
-- customers is an open decision for Sarel (Award-Outcomes-Findings.md §6) -
-- the `sources` column lets a deployment filter them out.

-- Every SANRAL contract number / NRA reference in a piece of text, normalised
-- (upper case, no spaces, "L.RRR-...-YYYY/S" whatever dot / dash / slash
-- variant was typed, NRA number without leading zeros), so a tender's
-- "R.396-010-2025/1F" or "NRA 2026/0756 (C)" finds the published record
-- whatever the spacing. The same rule is award_match_keys() in
-- engine/discovery/store_award_outcomes.py (test_award_prices.py checks the
-- two agree on real references). Non-SANRAL tenders join by OCDS id only:
-- other buyers' bid numbers ("RFQ 01/2026") are not unique enough to join on.
create or replace function award_match_keys(t text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(distinct k order by k), '{}')
  from (
    select m[1] || '.' || m[2] || '/' || m[3] as k
    from regexp_matches(regexp_replace(translate(upper(coalesce(t, '')), E'\u2013\u2014', '--'), '\s*([./-])\s*', '\1', 'g'),
                        '(?:^|[^A-Z])([A-Z]{1,2})\.?([0-9]{3}-[0-9./-]*[0-9]{4})[-/._]+([0-9A-Z]+)', 'g') as m
    union all
    select 'NRA' || m[1] || '/' || ltrim(m[2], '0') || coalesce(upper(m[3]), '') as k
    from regexp_matches(regexp_replace(coalesce(t, ''), '\s+', '', 'g'),
                        'NRA([0-9]{4})/([0-9]+)\(?([A-Za-z]{0,3})\)?', 'gi') as m
  ) keys
  where k is not null and k <> ''
$$;

comment on function award_match_keys(text) is
  'SANRAL contract numbers / NRA references found in a text, normalised for joining a tender to its published outcome. Mirrored by store_award_outcomes.award_match_keys().';

create table public_tender_outcomes (
  id uuid primary key default gen_random_uuid(),
  outcome_key text not null unique,
  match_keys text[] not null default '{}',
  ocid text,
  reference text,
  buyer text,
  title text,
  -- SANRAL's own list label (Consulting Services / Construction Projects / ...)
  project_type text,
  -- eTenders' procurement type (Request for Bid, Sole source bidding, ...)
  procurement_type text,
  province text,
  -- Tender Tool's own discipline list (0040), from the title at write time.
  categories text[] not null default '{}',
  -- false for a buyer-declared sole / single source, emergency or deviation
  -- procurement: there was no open price competition to benchmark against.
  competitive boolean not null default true,
  status text not null check (status in ('register_published', 'awarded')),
  closing_date date,
  award_date date,
  winner_name text,
  winner_amount_zar numeric(16, 2),
  winner_points text,
  winner_bbbee_points text,
  winner_count integer not null default 0,
  -- [{name, amounts: [{column, amount_zar, amount_raw}], bbbee, notes, is_winner}]
  bidders jsonb not null default '[]',
  -- where the bidders list came from: sanral_register | etenders_bidders
  bidders_source text,
  -- amount columns in the register: >1 = a batch tender, one price per contract
  register_columns integer not null default 0,
  bidder_count integer not null default 0,
  priced_bidder_count integer not null default 0,
  -- single-contract registers with 2+ priced bids only (null otherwise)
  low_bid_zar numeric(16, 2),
  median_bid_zar numeric(16, 2),
  high_bid_zar numeric(16, 2),
  winner_rank integer,               -- 1 = the lowest priced bid
  winner_vs_median numeric(8, 4),    -- winning bid / median bid
  lowest_bid_won boolean,
  -- how the winner was found in the register: name | amount | name_token
  winner_match_basis text,
  -- plain-language caveats about this record (implausible amount dropped,
  -- register only in the gated download, batch tender, winner not found...)
  data_notes text[] not null default '{}',
  sources text[] not null default '{}',
  source_urls text[] not null default '{}',
  attribution text,
  parts jsonb not null default '{}',
  first_seen_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now()
);

comment on table public_tender_outcomes is
  'Published tender outcomes (opening registers, awards) from SANRAL''s site and the eTenders Awarded tab, one row per tender. Shared reference data, service-role written. See docs/specs/Award-Price-Analysis-Findings.md.';
comment on column public_tender_outcomes.winner_vs_median is
  'Winning bid divided by the median priced bid on the same register: a scale-free measure of how far below the field the winner was. Comparable across tenders, unlike rand amounts.';

create index public_tender_outcomes_categories_idx on public_tender_outcomes using gin (categories);
create index public_tender_outcomes_match_keys_idx on public_tender_outcomes using gin (match_keys);
create index public_tender_outcomes_ocid_idx on public_tender_outcomes (ocid) where ocid is not null;

alter table public_tender_outcomes enable row level security;
create policy "public_tender_outcomes readable by authenticated users" on public_tender_outcomes
  for select to authenticated using (true);

-- Which published outcome belongs to which of the caller's tenders. Security
-- invoker: the tenders join runs under the caller's RLS, so a private
-- (manual, 0024) tender of another company never matches. matched_on says
-- how - OCDS id, or the SANRAL reference found in contract_no / nra_reference.
create or replace function tender_market_outcomes(p_tender_ids uuid[])
returns table (tender_id uuid, outcome_id uuid, matched_on text)
language sql
stable
security invoker
set search_path = public
as $$
  select t.id, o.id,
         case when t.ocid is not null and o.ocid = t.ocid then 'ocid' else 'reference' end
  from tenders t
  join public_tender_outcomes o
    on (t.ocid is not null and o.ocid = t.ocid)
    or (o.match_keys && (award_match_keys(t.contract_no) || award_match_keys(t.nra_reference)))
  where t.id = any(p_tender_ids)
$$;

comment on function tender_market_outcomes(uuid[]) is
  'Published outcomes (public_tender_outcomes) for the given tenders the caller can see: by OCDS id, or by SANRAL contract / NRA reference.';
