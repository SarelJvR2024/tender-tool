-- Key positions: suggest the best person (+ up to 2 alternatives) for each
-- position, let the user confirm the suggestion or pick someone else
-- (Sarel, 2026-10-17).
--
-- The scorer already exists and is not rebuilt here: engine/pack_generator/
-- suggest_pack.py score_candidate() (keyword overlap between the position's
-- SETUP description and the person's qualifications + projects, plus years
-- since first degree and ECSA level - the same function generate_cv.py uses
-- for tender-customised CVs). It is Python, and the web app can't run Python,
-- so engine/pack/process_pack_jobs.py sync_position_suggestions() runs it on
-- every poll for every SANRAL tender pack that has positions, and stores the
-- ranked result here. The Tender Workspace then filters that ranking to the
-- people tagged as eligible for the position's role (person_role_eligibility,
-- 0016, via the same roleCodeForPosition() the compliance report uses) and
-- shows the top one as the suggestion and the next two as alternatives. The
-- full dropdown stays: nobody is hidden, only ordered.
--
-- tender_pack_assignments (0001) already has suggested_person_id /
-- suggested_score / suggested_rationale for ONE suggestion; it has nowhere to
-- keep the alternatives or the per-person evidence, hence one jsonb column.
-- suggested_person_id is now written when the user confirms (the person the
-- page was suggesting at that moment), so pack_selections.yaml records
-- "suggested X, confirmed Y" honestly. Same tenant RLS as the table already
-- has - no new policy.

alter table tender_pack_assignments
  add column candidate_scores jsonb,
  add column scored_at timestamptz;

comment on column tender_pack_assignments.candidate_scores is
  'score_candidate() (engine/pack_generator/suggest_pack.py) for every person in the company against this position, highest first: [{person_id, name, score, years_experience, ecsa_level, matched[], missing[], specialism_warning, rationale}]. Written by engine/pack/process_pack_jobs.py sync_position_suggestions(); the Tender Workspace narrows it to role-tagged people for the suggestion + 2 alternatives. Null = not scored yet.';
comment on column tender_pack_assignments.scored_at is
  'When candidate_scores was last (re)computed - it is recomputed whenever people, projects or the position change the result.';
