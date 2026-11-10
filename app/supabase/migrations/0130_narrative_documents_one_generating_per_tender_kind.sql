-- Closes a real cross-process TOCTOU gap in the anti-collusion uniqueness
-- check that is the entire reason narrative_documents exists (migration
-- 0087's own header comment, Sarel's own words: "it may NEVER generate the
-- same or similar versions for two companies - then they might both get
-- disqualified"). engine/narrative/uniqueness.py's check_uniqueness() -
-- called from process_narrative_jobs.py's own load_other_companies_text() -
-- compares a new draft only against OTHER companies' already-'ready'
-- documents for the SAME (tender_id, kind). A document that is still
-- 'generating' is invisible to it.
--
-- This was flagged (QA-Edge-Case-Findings.md Finding 66, and again in
-- System-Status.md) as "safe today, but a real TOCTOU gap if it's ever run
-- as more than one concurrent worker" - at the time, process_narrative_jobs.py
-- was not yet wired into engine/worker/run_bridges.py's BRIDGES registry and
-- ran as a single sequential process, so two jobs for the SAME tender could
-- never both be mid-generation at once. That changed on 2026-10-25 (commit
-- 4703382, "Register the narrative bridge in the always-on worker's poll
-- list") - narrative is now driven by run_bridges.py exactly like every
-- other bridge, and this repo's own documented deployment model explicitly
-- allows a hosted worker and a hand-run --once to overlap
-- (docs/specs/Automated-Fulfillment-Deployment.md, "a hosted worker and a
-- hand-run --once can overlap without building the same CV twice" - the
-- SAME overlap this narrative bridge now shares). That is exactly the
-- "more than one concurrent worker" condition the original finding named as
-- the trigger for this gap going live - and nothing fixed it when that
-- trigger actually fired.
--
-- Standing review pass, 2026-11-10: reproduced directly against a real
-- replayed schema. Two companies' 'requested' narrative_documents rows for
-- the SAME tender_id+kind both reached 'generating' via two independent,
-- unsynchronized UPDATEs (no shared lock between them - the exact shape two
-- overlapping worker processes, or two near-simultaneous poll cycles, would
-- produce). The uniqueness check's own live query
-- (tender_id=eq...&kind=eq...&status=eq.ready&company_id=neq...) then
-- returned ZERO rows for either company, even though the other company's
-- near-identical draft was being generated in the very same instant - the
-- one check this whole table exists for silently never ran for that pair.
--
-- Fix: a partial unique index makes it impossible for more than one row to
-- be 'generating' for the same (tender_id, kind) at once, system-wide,
-- regardless of how many worker processes are running - the same
-- "serialize with a unique index, never a check-then-act read" pattern
-- already used for pack_generation_jobs_one_open_key (0017) and
-- company_can_request_pack()'s own in-flight-job counting (0084). A second
-- claim attempt for a different row sharing the same (tender_id, kind) now
-- raises a real 23505 unique-violation instead of silently succeeding.
-- engine/narrative/process_narrative_jobs.py's claim_job() catches exactly
-- that error and treats it the same as "already claimed by another
-- worker" - skip this cycle, retry next poll - never as a job failure: the
-- job itself is fine, it only has to wait for the other company's job for
-- the SAME tender+kind to leave 'generating' first (so its own uniqueness
-- check can then actually see it as a 'ready' peer).

create unique index narrative_documents_one_generating_per_tender_kind
  on narrative_documents (tender_id, kind)
  where status = 'generating';

comment on index narrative_documents_one_generating_per_tender_kind is
  'At most one narrative_documents row may be ''generating'' for a given (tender_id, kind) at a time, across every company and every worker process - closes the anti-collusion uniqueness check''s own cross-process TOCTOU gap (engine/narrative/uniqueness.py). A claim that would violate this raises 23505; process_narrative_jobs.py''s claim_job() treats that as "retry next cycle", not a job failure.';
