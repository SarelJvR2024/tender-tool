-- Market-trend aggregation for similar past awards (Sarel, 2026-10-18,
-- paraphrased from a longer ask: "once we get winning prices we can use to
-- adjust our pricing engine to improve estimates and start building market
-- tendering trends for similar future projects and improve our estimated
-- project value"). This is the follow-on migration 0053 and 0060 both
-- explicitly deferred ("the next agent's pricing-engine/market-trend work
-- ... is NOT touched here").
--
-- What this does NOT do, on purpose:
--  * it never touches engine/fill_financial.py or any BOQ/pricing-fill
--    logic - the priced BOQ stays the tenderer's own business decision,
--    same rule that file's own docstring states;
--  * it never sets or suggests a price for a company to bid - every number
--    here is framed as historical reference about OTHER buyers' past
--    awards, read-only, shown next to (never instead of) the tenderer's own
--    figures;
--  * it is a live SQL function, not a materialized view or a cached table.
--    Given today's outcomes dataset (public_tender_outcomes, 0053) is small
--    and still growing, and there is no live Supabase project running this
--    yet, a cached aggregate would go stale with no refresh job to keep it
--    honest, and would need its own staleness/refresh plumbing for no real
--    performance win at this data volume. A function computed on demand
--    stays correct by construction and costs nothing to maintain; this can
--    be revisited as a materialized view once real row counts justify it.
--
-- Join path (no new identifier scheme - per the brief, tenders.id is
-- already the common key): public_tender_outcomes -> tenders, by the same
-- ocid / SANRAL-reference match tender_market_outcomes() (0053) already
-- uses; tenders -> tender_scope_records (0060), by tenders.id. Grouped by
-- tenders.industry_tags / discipline_tags (0060) overlapping the caller's
-- tags, optionally narrowed to one tender_scope_records.value_band.
--
-- Honesty rules carried over from marketPricing.ts (0053) and
-- tender_scope_records (0060):
--  * only AWARDED, COMPETITIVE outcomes count (sole-source/emergency awards
--    have no price competition to benchmark against, same filter
--    marketPricing.ts's loadSegment() already applies);
--  * a winning-price-vs-estimate ratio is computed ONLY where the matched
--    tender's own tender_scope_records row has value_band_basis =
--    'stated_in_text' (a real rand figure the buyer itself published) -
--    never against a null/unknown estimate, and never against a BOQ total
--    (none is extracted, see 0060);
--  * every aggregate carries its own sample size (n, pct_of_estimate_n,
--    bidder_count_n) so the caller (app/lib/marketTrendLogic.ts
--    gateMarketTrend(), via marketPricing.ts loadMarketTrend()) can apply
--    the same MIN_SAMPLE-style gate the rest of that module already uses -
--    below it, the caller shows nothing rather than a trend built on too
--    few comparable awards ("we stop, we never guess").
create or replace function market_trend_for_tags(
  p_tags text[],
  p_value_band text default null,
  p_window_months integer default 24
)
returns table (
  n integer,
  date_from date,
  date_to date,
  pct_of_estimate_n integer,
  pct_of_estimate_median numeric,
  bidder_count_n integer,
  bidder_count_median numeric,
  bbbee_level_counts jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select
      o.id,
      o.award_date,
      o.winner_amount_zar,
      o.winner_bbbee_points,
      o.bidder_count,
      s.value_band_basis,
      s.value_band_raw_amount
    from public_tender_outcomes o
    join tenders t
      on (t.ocid is not null and o.ocid = t.ocid)
      or (o.match_keys && (award_match_keys(t.contract_no) || award_match_keys(t.nra_reference)))
    left join tender_scope_records s on s.tender_id = t.id
    where o.competitive = true
      and o.status = 'awarded'
      and p_tags is not null and cardinality(p_tags) > 0
      and (t.industry_tags && p_tags or t.discipline_tags && p_tags)
      and (p_value_band is null or s.value_band = p_value_band)
      and (
        p_window_months is null
        or o.award_date is null
        or o.award_date >= (current_date - (p_window_months || ' months')::interval)
      )
  ),
  pct_rows as (
    select (winner_amount_zar / value_band_raw_amount) as ratio
    from scoped
    where value_band_basis = 'stated_in_text'
      and value_band_raw_amount is not null and value_band_raw_amount > 0
      and winner_amount_zar is not null and winner_amount_zar > 0
  ),
  bidder_rows as (
    select bidder_count from scoped where bidder_count > 0
  ),
  bbbee_rows as (
    select winner_bbbee_points as level, count(*) as cnt
    from scoped
    where winner_bbbee_points is not null
    group by winner_bbbee_points
  )
  select
    (select count(*) from scoped)::int,
    (select min(award_date) from scoped),
    (select max(award_date) from scoped),
    (select count(*) from pct_rows)::int,
    (select percentile_cont(0.5) within group (order by ratio) from pct_rows),
    (select count(*) from bidder_rows)::int,
    (select percentile_cont(0.5) within group (order by bidder_count) from bidder_rows),
    (select coalesce(jsonb_object_agg(level, cnt), '{}'::jsonb) from bbbee_rows)
$$;

comment on function market_trend_for_tags(text[], text, integer) is
  'Real-market trend (sample size, winning price as % of stated estimate, bidder count, B-BBEE level distribution) for awarded competitive outcomes whose matched tender shares any of p_tags (industry_tags/discipline_tags, 0060), optionally narrowed to one value_band, over a trailing window. Historical reference only - see app/lib/marketTrendLogic.ts gateMarketTrend() for the MIN_SAMPLE display gate. security invoker: the tenders join runs under the caller''s own RLS (moot here - tenders and public_tender_outcomes are both shared, authenticated-readable tables - but kept consistent with tender_market_outcomes(), 0053).';
