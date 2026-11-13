-- Phase 3 data-model reconciliation against Claude-Brief-Awards-Intelligence_v2.md
-- section 2 (Sarel, 2026-11-13), on top of 0053 (public_tender_outcomes) and
-- 0143 (the Phase 2 pricing-exclusion/buyer_key columns).
--
-- The brief's "Data Model Requirements" lists three data points this
-- migration is the gap-check for:
--
--   Award Record: tender number/OCDS ID, buyer/department (buyer_key),
--     category/discipline code, award date, contract amount,
--     pricing_excluded flag, exclusion reason, is_panel_award.
--     -> ALL already on public_tender_outcomes (reference, ocid, buyer,
--     buyer_key [0143], categories, award_date, winner_amount_zar,
--     pricing_excluded/pricing_exclusion_reasons [0143], is_panel_award
--     [0143]). Nothing to add at this level.
--
--   Bidder Register (when published): supplier name, bid amount, is_winner,
--     B-BBEE level, price rank.
--     -> supplier name/bid amount/is_winner already exist inside the
--     `bidders` jsonb array (store_award_outcomes.merge()). B-BBEE LEVEL and
--     PRICE RANK did not - this is the real gap. No new column needed: both
--     are PER-BIDDER data, so they belong as two new keys inside each
--     `bidders` array element (bbbee_level, price_rank), not a new
--     top-level column or a new child table. A child table was considered
--     (the brief explicitly offers the choice) and rejected: the bidder
--     register is already a working, queried JSONB structure with no
--     reported pain point from that shape - adding a table only to hold two
--     more per-element keys would be a bigger, riskier change for no real
--     benefit over extending the JSONB shape the same way `bidders` already
--     grew from Phase 2 (is_winner, notes). See store_award_outcomes.py's
--     own merge() for exactly what's added and why bbbee_level is
--     deliberately conservative (EME/QSE/Level 1-8/Non-compliant/null -
--     never a guessed percentage-to-level conversion: no real captured
--     register in this repo's own fixtures has ever shown a populated
--     `bbbee` value, so a fancier parser would be built against data nobody
--     has actually seen, which this project's own house rule - never invent
--     what isn't verified against real data - exists specifically to avoid).
--
--   Supplier Identity: normalized supplier name to group repeat winners
--     across tenders (the brief's own Phase 3 #4 "Dominant incumbent" and
--     "Top 5 winning suppliers" both need this at the ROW level, not nested
--     in a per-bidder array - a GROUP BY winner_key needs an indexable
--     column). store_award_outcomes.norm_name() already exists (used
--     transiently inside find_winner()); this migration is the first place
--     it's PERSISTED, as `winner_key`.
--
-- Comment-only update to `bidders`' own column comment (0053's original);
-- no data migration needed for the new per-bidder keys - same "recomputed
-- from parts on every write" design 0053/0143 already use, so the next
-- scheduled/manual store run fills them in for every row.

alter table public_tender_outcomes
  add column winner_key text;

comment on column public_tender_outcomes.winner_key is
  'Normalised winner-name identity (store_award_outcomes.norm_name()) for grouping repeat winners across tenders - Claude-Brief-Awards-Intelligence_v2.md section 2, "Supplier Identity". Never a fuzzy/guessed merge of two different real companies, same caution as buyer_key (0143) and award_match_keys() (0053).';

comment on column public_tender_outcomes.bidders is
  '[{name, amounts: [{column, amount_zar, amount_raw}], bbbee, bbbee_level, price_rank, notes, is_winner}] - one entry per bidder on the published register. bbbee is the raw text as published (may be null - no real captured register in this repo''s fixtures has ever shown a value); bbbee_level is a conservative classification of it (EME | QSE | Level 1..8 | Non-compliant | null for anything not confidently recognised - never a guessed percentage/points conversion). price_rank (1 = lowest) is set only under the same conditions low_bid_zar/median_bid_zar/high_bid_zar are (a single-contract, non-batch register with 2+ real priced bids after excluding nominal-placeholder and outlier amounts) - null otherwise, same as those three columns.';

create index public_tender_outcomes_winner_key_idx on public_tender_outcomes (winner_key) where winner_key is not null;
