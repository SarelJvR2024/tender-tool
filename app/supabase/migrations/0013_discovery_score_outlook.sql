-- Scoring outlook on discovered opportunities (Sarel, 2026-10-16: map each
-- opportunity for "how well suited the tender is in terms of the service and
-- also in terms of how they will score on the tender").
--
-- verdict/reasons (0004) already answer suitability. This adds the second,
-- separate answer: what the tender's own documents say about how it is scored
-- (preference system, specific-goal basis, functionality threshold) and what
-- can honestly be estimated from the company profile. Shape is
-- engine/discovery/score_outlook.py's estimate_score_outlook() return value,
-- written by seed_supabase_opportunities.py exactly as assess_release()
-- produced it. Its `summary` array is what the Discovery page renders.
--
-- Nullable on purpose: rows seeded before this existed have no outlook, and
-- the page shows nothing rather than a made-up one. No new policy needed -
-- discovered_opportunities' existing select-only RLS (0004) covers the column.
-- Evidence and limits: docs/specs/Tender-Evaluation-Engine-Audit.md.

alter table discovered_opportunities add column score_outlook jsonb;

comment on column discovered_opportunities.score_outlook is
  'engine/discovery/score_outlook.py estimate_score_outlook() result: {estimable, preference_system, specific_goals, functionality, price, summary[]}. Price points are never estimated (scored against the lowest bid). Null = assessed before this column existed.';
