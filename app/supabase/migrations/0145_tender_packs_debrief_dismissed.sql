-- Phase 4 (Claude-Brief-Awards-Intelligence_v2.md section 3, Sarel,
-- 2026-11-14): the Pipeline debrief banner - "Government outcome published:
-- Awarded to {winner} for R{amount}" on a 'submitted'-stage pursuit once
-- matchPursuitsToAwards() (app/lib/awardsIntelligence.ts) finds a published
-- outcome for it. "Confirm Won"/"Confirm Lost" already has a real mechanism
-- (recordOutcomeAndMoveStage, app/pipeline/actions.ts - moves
-- tender_packs.pipeline_stage to won/lost and records the outcome in
-- tender_answers); nothing new is needed for that half. "Dismiss" has no
-- existing mechanism - this is it.
--
-- Same table, same reasoning as 0021's own pipeline_stage (per company per
-- tender -> tender_packs, not a new table) and the same existing RLS
-- ("tender_packs: tenant isolation", all verbs already covers it) - no new
-- policy needed, a plain company-scoped .update() from dismissBanner()
-- (app/pipeline/actions.ts) is enough, the same way recordOutcomeAndMoveStage
-- already upserts pipeline_stage directly.
--
-- Scoped to the COMPANY, not literally one individual's own browser/session -
-- same convention this product already uses for the one other "mark this as
-- seen" banner (discovered_opportunities.downgrade_acknowledged_at, 0055,
-- DowngradeFlag's own "Mark as seen"): once anyone at the company dismisses
-- it, it's dismissed for the company. True per-individual-user state would
-- need a new company_member-scoped join table that nothing else in this
-- product has needed yet - a deliberate, smaller choice than that, matching
-- precedent; revisit only if this is ever reported as wrong (e.g. one admin
-- dismissing it while a colleague still needed to see it).
alter table tender_packs
  add column debrief_dismissed_at timestamptz;

comment on column tender_packs.debrief_dismissed_at is
  'When this company dismissed the published-outcome debrief banner for this pursuit (app/pipeline/debrief-banner.tsx). Company-wide, same convention as discovered_opportunities.downgrade_acknowledged_at (0055). Never set automatically - only the Dismiss button sets it, and moving to won/lost via the existing outcome form does not need it (the banner only ever shows on a submitted-stage pursuit in the first place).';
