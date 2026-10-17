-- One job queue for every document engine.
--
-- Until now there were two near-identical request/fulfil tables:
--   pack_generation_jobs (0017) - SANRAL submission packs, claimed by
--     engine/pack/process_pack_jobs.py;
--   tender_engine_jobs   (0018) - general (non-SANRAL) requirement extraction
--     and packs, claimed by engine/general/process_general_jobs.py.
-- 0018's own header said why it was separate ("process_pack_jobs.py claims
-- EVERY 'requested' row in pack_generation_jobs") and how to fold them: "add
-- `engine` to pack_generation_jobs" + a filter in that bridge. This does it:
--
--  1. pack_generation_jobs gains `engine` ('sanral' | 'general', default
--     'sanral' so every existing row and every existing SANRAL insert keeps
--     its meaning) and `kind` ('generate_pack' | 'extract_requirements',
--     default 'generate_pack'). tender_pack_id becomes nullable for general
--     rows only (a SANRAL row still must have one - check constraint).
--  2. 0018's "one open job per (company, tender, engine, kind)" partial unique
--     index moves here, with the exact same predicate, so every
--     `on conflict (company_id, tender_id, engine, kind) where status in
--     ('requested','generating')` written against tender_engine_jobs keeps
--     working (0018's pursue_discovered_opportunity(), and any later
--     migration that copied it).
--  3. RLS: members may read their company's jobs and queue a 'requested' row
--     with no results (0018's stricter insert rule, now for every engine).
--     Update/delete stay allowed for SANRAL rows exactly as 0017 allowed them
--     (nothing in the app uses them today, but 0017 granted them and this
--     migration is additive); general rows stay write-once for clients, as
--     0018 made them. The bridges write status/results with the service role.
--  4. Existing tender_engine_jobs rows are copied over (same ids), the table
--     is dropped, and `tender_engine_jobs` is recreated as an updatable VIEW of
--     pack_generation_jobs where engine = 'general' (security_invoker, so the
--     base table's RLS applies; inserts through it default engine to
--     'general'). Old readers/writers - including a migration landing after
--     this one that still inserts into tender_engine_jobs - keep working.
--  5. Functions that queue general jobs - pursue_discovered_opportunity()
--     (0018, redefined by 0024), load_manual_tender() and
--     add_manual_tender_documents() (0024) - are deliberately NOT redefined
--     here: they insert into tender_engine_jobs, which now resolves to the
--     view, including their `on conflict (...) where status in (...)` clause
--     (verified on a scratch replay). Re-declaring 0024's functions in this
--     file would fork their bodies; whoever next edits them can point them at
--     pack_generation_jobs directly.
--
-- The worker (engine/worker/run_bridges.py) still runs one script per engine,
-- but both poll this one table, each claiming only its own engine's rows
-- (process_pack_jobs.py: engine = 'sanral'; process_general_jobs.py:
-- engine = 'general').

-- ---------------------------------------------------------------------------
-- 1. columns
-- ---------------------------------------------------------------------------
alter table pack_generation_jobs add column engine text not null default 'sanral'
  check (engine in ('sanral', 'general'));
alter table pack_generation_jobs add column kind text not null default 'generate_pack'
  check (kind in ('generate_pack', 'extract_requirements'));
alter table pack_generation_jobs add constraint pack_generation_jobs_sanral_kind
  check (engine <> 'sanral' or kind = 'generate_pack');

alter table pack_generation_jobs alter column tender_pack_id drop not null;
alter table pack_generation_jobs add constraint pack_generation_jobs_sanral_has_pack
  check (engine <> 'sanral' or tender_pack_id is not null);
-- 0017 cascaded a deleted tender_pack into its SANRAL jobs; 0018 set general
-- jobs' link to null. Keep 0017's behaviour (the SANRAL check above forbids a
-- null there anyway); a general job loses nothing it needs without its pack.

comment on column pack_generation_jobs.engine is
  'Which bridge fulfils the row: sanral = engine/pack/process_pack_jobs.py (SANRAL submission pack), general = engine/general/process_general_jobs.py (non-SANRAL requirement extraction / pack). Each bridge claims only its own engine''s rows.';
comment on column pack_generation_jobs.kind is
  'generate_pack (both engines) or extract_requirements (general only: read the tender''s own documents into tenders.document_requirements).';

-- ---------------------------------------------------------------------------
-- 2. one open job per (company, tender, engine, kind)
-- ---------------------------------------------------------------------------
-- A database where two SANRAL requests for the same tender were both still
-- open would fail the unique index below; the Tender Workspace refuses a
-- second request while one is queued, so this should find nothing - but if it
-- does, the older duplicates are failed with a reason, never deleted.
update pack_generation_jobs j set status = 'failed', completed_at = now(),
  error_message = 'Superseded: a newer request for the same pack was already queued (job queues merged).'
where j.status in ('requested', 'generating')
  and exists (select 1 from pack_generation_jobs n
              where n.company_id = j.company_id and n.tender_id = j.tender_id
                and n.engine = j.engine and n.kind = j.kind
                and n.status in ('requested', 'generating')
                and (n.requested_at, n.id) > (j.requested_at, j.id));

create unique index pack_generation_jobs_one_open_key
  on pack_generation_jobs (company_id, tender_id, engine, kind) where status in ('requested', 'generating');
-- the bridges poll (engine, status) oldest first
create index pack_generation_jobs_engine_status_idx on pack_generation_jobs (engine, status, requested_at);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
drop policy "pack_generation_jobs: tenant isolation" on pack_generation_jobs;
create policy "pack_generation_jobs: members can select" on pack_generation_jobs
  for select to authenticated using (is_company_member(company_id));
create policy "pack_generation_jobs: members can request" on pack_generation_jobs
  for insert to authenticated with check (
    is_company_member(company_id) and status = 'requested' and storage_path_pdf is null and manifest is null
    and output_files = '{}'::jsonb and error_message is null and started_at is null and completed_at is null
  );
create policy "pack_generation_jobs: members can update sanral rows" on pack_generation_jobs
  for update to authenticated
  using (engine = 'sanral' and is_company_member(company_id))
  with check (engine = 'sanral' and is_company_member(company_id));
create policy "pack_generation_jobs: members can delete sanral rows" on pack_generation_jobs
  for delete to authenticated using (engine = 'sanral' and is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- 4. tender_engine_jobs -> rows moved here, name kept as a view
-- ---------------------------------------------------------------------------
insert into pack_generation_jobs (id, company_id, tender_id, tender_pack_id, engine, kind, status,
                                  storage_path_pdf, output_files, page_count, manifest, error_message,
                                  requested_by, requested_at, started_at, completed_at)
select id, company_id, tender_id, tender_pack_id, engine, kind, status,
       storage_path_pdf, output_files, page_count, manifest, error_message,
       requested_by, requested_at, started_at, completed_at
from tender_engine_jobs;

drop table tender_engine_jobs;

create view tender_engine_jobs with (security_invoker = true) as
  select id, company_id, tender_id, tender_pack_id, engine, kind, status, storage_path_pdf, output_files,
         page_count, manifest, error_message, requested_by, requested_at, started_at, completed_at
  from pack_generation_jobs
  where engine = 'general'
  with cascaded check option;
alter view tender_engine_jobs alter column engine set default 'general';
alter view tender_engine_jobs alter column status set default 'requested';
alter view tender_engine_jobs alter column output_files set default '{}'::jsonb;
comment on view tender_engine_jobs is
  'Compatibility view (unified job queue): the general engine''s rows of pack_generation_jobs. Inserts through it land in pack_generation_jobs with engine = ''general''. New code uses pack_generation_jobs directly.';
grant select, insert on tender_engine_jobs to authenticated;
