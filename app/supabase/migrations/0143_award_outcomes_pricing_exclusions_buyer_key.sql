-- Phase 2 of the awards-intelligence work (Sarel, 2026-11-13), on top of
-- public_tender_outcomes (0053) and its own data-quality findings
-- (docs/specs/Award-Price-Analysis-Findings.md, plus a fresh live Phase 1
-- coverage read the same day: 53.6% of a 593-tender sample were
-- non-competitive awards, and the register/benchmark numbers in 0053 were
-- computed with no gate on that at all - a sole-source or deviation award
-- that happened to carry a priced register still got a median/winner-rank
-- worked out against it, which is not a fair "how did my price compare"
-- comparison).
--
-- Four structured columns so a UI/analysis consumer never has to regex-parse
-- `data_notes` to find out whether a row's own price numbers are safe to use
-- in a competitive benchmark:
--
--   buyer_key              a normalised grouping key for `buyer` (collapsed
--                          whitespace, upper-cased) so two award rows for the
--                          same real department that were typed with
--                          different spacing/casing group together. This is
--                          NOT a fuzzy/guessed correction - a genuine typo in
--                          the buyer's own name (a missing space, a
--                          misspelling) is left as published; only
--                          whitespace and case are normalised, the same
--                          caution this project already applies to company
--                          names (store_award_outcomes.norm_name()) and
--                          tender references (award_match_keys()).
--   is_panel_award          true when winner_count > 1 (a split/panel award
--                          to several suppliers) - already computed but
--                          never exposed as its own typed flag before; a
--                          consumer had to infer it from winner_count or
--                          parse a free-text note.
--   pricing_excluded        true when this row's own winner_amount_zar /
--                          register numbers should NOT be used in a
--                          competitive benchmark or median-pricing
--                          calculation - non-competitive, a panel award (no
--                          single winning price), or a nominal/placeholder
--                          amount (R1 or less - R0 was already excluded by
--                          0053's own plausible() guard before this).
--   pricing_exclusion_reasons   the human-readable reason(s), e.g.
--                          'Non-competitive award (deviation/emergency)' -
--                          the exact tag Sarel asked for.
--
-- store_award_outcomes.py's merge() (the only writer) is updated in the same
-- change to compute all four; existing rows get the new columns' defaults
-- until the next write recomputes them (same "recomputed from parts on every
-- write" design 0053 already uses - no backfill migration needed, the next
-- scheduled/manual run fixes every row).

alter table public_tender_outcomes
  add column buyer_key text,
  add column is_panel_award boolean not null default false,
  add column pricing_excluded boolean not null default false,
  add column pricing_exclusion_reasons text[] not null default '{}';

comment on column public_tender_outcomes.buyer_key is
  'Normalised grouping key for buyer (whitespace collapsed, upper-cased) - never a fuzzy/guessed name correction, only case and spacing. Lets two award rows for the same real department group together even when typed with different spacing/casing.';
comment on column public_tender_outcomes.is_panel_award is
  'True when winner_count > 1 - a split/panel award to several suppliers, so there is no single winning price. A typed flag for what was previously only inferable from winner_count or a free-text note.';
comment on column public_tender_outcomes.pricing_excluded is
  'True when this row''s own price numbers (winner_amount_zar, the register, low/median/high/winner_rank) should NOT be used in a competitive benchmark or median-pricing calculation. See pricing_exclusion_reasons for why.';
comment on column public_tender_outcomes.pricing_exclusion_reasons is
  'Human-readable reason(s) pricing_excluded is true: non-competitive award, panel/multi-supplier award, or a nominal/placeholder amount (R1 or less).';

create index public_tender_outcomes_buyer_key_idx on public_tender_outcomes (buyer_key) where buyer_key is not null;
