-- Closes System-Status Gap #11: a worker killed mid-job (OOM, host crash)
-- leaves its generated_cvs row stuck in 'generating' forever, because this
-- table has no timestamp recording when a job was claimed - unlike
-- pack_generation_jobs.started_at (0017), which engine/pack/process_pack_jobs.py's
-- own fail_stale_jobs() already uses for exactly this purpose. Deliberately
-- not added alongside 0017 to avoid a same-day migration-number collision
-- (noted in System-Status.md at the time); this is that follow-up.
--
-- Nullable: a 'requested' row has no claimed_at yet (it isn't claimed); it's
-- set the moment a worker successfully claims the row (status
-- requested -> generating), mirroring pack_generation_jobs.started_at exactly.

alter table generated_cvs add column claimed_at timestamptz;

comment on column generated_cvs.claimed_at is
  'Set when a worker claims this job (status -> generating). Null while status is requested. Used by engine/cv/process_cv_jobs.py''s fail_stale_jobs() to detect and fail a job whose worker died mid-build, the same way pack_generation_jobs.started_at already does for process_pack_jobs.py.';
