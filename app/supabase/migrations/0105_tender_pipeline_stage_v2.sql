-- Bids pipeline operational-stage migration (task #48; spec: app/AGENTS.md
-- "Bids pipeline redesign (prompt 10, item 4)", flagged there, not built,
-- 2026-10-21 - this is that follow-up).
--
-- tender_packs.pipeline_stage (0021) has a hard check constraint allowing
-- exactly 5 values: found/bidding/submitted/won/lost. AGENTS.md's own entry
-- names 2 genuinely missing states, both confirmed against the real schema
-- (no existing column anywhere already captures either):
--   - "Bidding" was always two different things wearing one label:
--     Assessing (deciding whether to bid) and Building (actually preparing
--     the submission). Split into 'assessing' and 'building'.
--   - A 'briefing_shortlisted' state between Submitted and an outcome, for
--     buyers who hold a briefing/shortlist step before award.
-- 7 stored values total, not 5. (Not 8 - an earlier draft of this task
-- guessed 8 with nothing behind the number; this is the actual spec.)
--
-- Dry-run (read-only, 2026-10-30, Sarel's own review before this file was
-- written) against the live tender_packs table found 14 rows total:
-- found=9, bidding=1, submitted=2, won=2, lost=0. No pre-existing data-
-- integrity problems (no null/out-of-range pipeline_stage, no row missing
-- submitted_at once it reached submitted/won/lost, no stale submitted_at on
-- a found/bidding row). The single 'bidding' row was checked individually
-- for real work-in-progress signals (Sarel's own backfill rule, 2026-10-30):
-- it has 3 CONFIRMED tender_pack_assignments (not just suggested) and 1
-- financial_captures row, so it backfills to 'building', not 'assessing'.
-- The backfill below re-derives this generically from the same signals
-- (confirmed assignment, any tender_answers row, or any financial_captures
-- row) rather than hardcoding that one row's id, so it stays correct if
-- more 'bidding' rows exist by the time this runs.
--
-- Run this together with 0106 (the companion migration widening
-- accept_tender_update_date()'s own 'found'/'bidding'/'submitted' check to
-- the new stage set) - app/lib/pipeline.ts and the ~6 real TS/Python
-- "active pursuit" allow-lists were updated in the same change (2026-10-30)
-- to accept both the new stages and the legacy 'bidding' value, so nothing
-- drops regardless of which of 0105/0106 has been run yet.

begin;

-- 1. Widen the check constraint before any row is written with a new value.
-- Postgres's own default name for an unnamed column-level check (0021 added
-- it inline, never named) - confirmed via information_schema before writing
-- this file.
alter table tender_packs
  drop constraint if exists tender_packs_pipeline_stage_check;

alter table tender_packs
  add constraint tender_packs_pipeline_stage_check
    check (pipeline_stage in (
      'found', 'assessing', 'building', 'submitted',
      'briefing_shortlisted', 'won', 'lost'
    ));

comment on column tender_packs.pipeline_stage is
  'This company''s business stage on the tender (pipeline board, /pipeline): found -> assessing -> building -> submitted -> briefing_shortlisted -> won | lost. Not tenders.status (the buyer''s public status) and not tender_packs.status (the key-person confirm gate). Widened from 5 to 7 values (0105) - briefing_shortlisted is purely additive (no existing row could have been in it); existing bidding rows were split into assessing/building by the backfill below.';

-- 2. Backfill existing 'bidding' rows. Order matters: promote the ones with
-- real work-in-progress signals to 'building' FIRST, then whatever is still
-- 'bidding' (an empty shell - no assignment confirmed, no answer, no
-- financial capture) becomes 'assessing'.
update tender_packs tp
set pipeline_stage = 'building'
where tp.pipeline_stage = 'bidding'
  and (
    exists (
      select 1 from tender_pack_assignments a
      where a.tender_pack_id = tp.id and a.confirmed_person_id is not null
    )
    or exists (
      select 1 from tender_answers ta
      where ta.company_id = tp.company_id and ta.tender_id = tp.tender_id
    )
    or exists (
      select 1 from financial_captures fc
      where fc.company_id = tp.company_id and fc.tender_id = tp.tender_id
    )
  );

update tender_packs
set pipeline_stage = 'assessing'
where pipeline_stage = 'bidding';

-- 3. The stage-stamp trigger (0021) sets submitted_at the first time a pack
-- reaches submitted/won/lost. briefing_shortlisted only ever follows
-- submitted in the stage machine (see NEXT_STAGES, app/lib/pipeline.ts), so
-- submitted_at will already be set by the time a row reaches it in normal
-- use - included here anyway (idempotent: only fires when still null) so a
-- row can never reach briefing_shortlisted/won/lost with a null
-- submitted_at, matching the guarantee submitted/won/lost already had.
create or replace function tender_packs_stage_stamp()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.pipeline_stage is distinct from old.pipeline_stage then
    new.stage_changed_at := now();
    if new.pipeline_stage in ('submitted', 'briefing_shortlisted', 'won', 'lost') and new.submitted_at is null then
      new.submitted_at := now();
    end if;
  end if;
  return new;
end;
$$;

commit;
