-- Finding 443 (standing solution-architect review, 2026-11-11): migration
-- 0130's own partial unique index - narrative_documents_one_generating_per_
-- tender_kind, (tender_id, kind) where status = 'generating' - is the
-- DB-level serialization guard that closes the anti-collusion uniqueness
-- check's cross-process TOCTOU race (0130's own header has the full
-- original finding). It is keyed by tender_id ALONE, which is exactly the
-- same root cause PR #252 (Finding 442) found and fixed in
-- process_narrative_jobs.py's own READ-time check
-- (load_other_companies_text()) - but this is a DIFFERENT, still-open
-- mechanism that PR #252 does not touch at all (confirmed by reading its
-- real diff: it only changes load_other_companies_text()/process_one(),
-- lines 274-360, never this index or this migration).
--
-- Migration 0032 deliberately lets two different companies each hold their
-- OWN private (owner_company_id set) tenders row for the identical real
-- tender, sharing one ocid - tenders_ocid_key (0018, narrowed by 0032) is
-- only unique among SHARED (owner_company_id is null) rows, and
-- load_manual_tender()'s own comment says it plainly: "Another company's
-- private copy with the same id is invisible here and blocks nothing."
-- Two such companies' own narrative_documents rows for the SAME real tender
-- therefore carry two DIFFERENT tender_id values, so 0130's own index does
-- nothing to stop both of their claim_job() PATCHes reaching 'generating'
-- at the exact same instant - reopening the identical TOCTOU race 0130 was
-- built to close, just substituted onto two tenders.id rows sharing one
-- ocid instead of two rows sharing one tender_id.
--
-- Reproduced live on a scratch Postgres (121 migrations replayed via
-- engine/security/replay_schema.sh): two companies, each with its own
-- tenders row sharing ocid 'ocds-9999-REALTENDER', each with a 'requested'
-- narrative_documents row. Both rows' own claim_job()-shaped PATCH
-- (status 'requested' -> 'generating') succeeded with ZERO error - no
-- 23505, nothing serialized - even though PR #252's own fix (once merged)
-- would still show company A's read-time check nothing: company B's draft
-- is 'generating', not 'ready', at the exact moment company A's own job
-- runs its read (0130's own header: "a document that is still 'generating'
-- is invisible to it" - previously stated for the same-tender_id case,
-- equally true here). This is the one real mechanism meant to prevent two
-- companies from both getting disqualified for near-identical draft text
-- (migration 0087's own header, Sarel's own words) - it silently never ran
-- for this entirely ordinary, no-race-needed, no-overlap-needed scenario:
-- two companies independently using the system's own documented "load your
-- own copy" path for the same real government tender.
--
-- Fix: denormalize each row's own tender's ocid onto narrative_documents
-- itself (trigger-maintained, set once at insert time - tenders.ocid is
-- set when a tender is loaded and never updated afterward anywhere in this
-- codebase, confirmed by grep), and widen 0130's own index to
-- coalesce(ocid, tender_id::text) instead of tender_id alone. A tender
-- with no ocid at all (a fully manual load, no real-world identity signal
-- to widen on - same documented limit tender_ids_for_uniqueness_check()
-- in process_narrative_jobs.py accepts for PR #252's own fix) still
-- serializes correctly on just its own tender_id, unchanged from before.
-- The index keeps its exact name, so claim_job()'s own existing 23505
-- handling (which matches by name, not by column list) needs no change.

alter table narrative_documents add column ocid text;
comment on column narrative_documents.ocid is
  'Denormalized from tenders.ocid at insert time (narrative_documents_set_ocid trigger below) - lets narrative_documents_one_generating_per_tender_kind serialize two different companies'' own private tenders rows for the SAME real-world tender (migration 0032), which share one ocid but have two different tender_id values. Null when the tender itself has no ocid (a fully manual load with no real-world identity to widen on). Finding 443.';

-- Backfill existing rows before the index below is rebuilt against this
-- column - a fresh database (replay_schema.sh) has none, but a real one
-- already running 0130 could.
update narrative_documents nd
  set ocid = t.ocid
  from tenders t
  where t.id = nd.tender_id and nd.ocid is null;

create or replace function narrative_documents_set_ocid()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  select ocid into new.ocid from tenders where id = new.tender_id;
  return new;
end;
$$;
comment on function narrative_documents_set_ocid() is
  'BEFORE INSERT trigger: stamps narrative_documents.ocid from the row''s own tender at insert time, so narrative_documents_one_generating_per_tender_kind can serialize across every private copy of the same real-world tender (Finding 443). tender_id never changes after insert (no code in this app updates narrative_documents.tender_id), so this only needs to run on INSERT.';

create trigger narrative_documents_set_ocid_trigger
  before insert on narrative_documents
  for each row execute function narrative_documents_set_ocid();

drop index narrative_documents_one_generating_per_tender_kind;
create unique index narrative_documents_one_generating_per_tender_kind
  on narrative_documents (coalesce(ocid, tender_id::text), kind)
  where status = 'generating';
comment on index narrative_documents_one_generating_per_tender_kind is
  'At most one narrative_documents row may be ''generating'' for a given real-world tender (coalesce(ocid, tender_id::text)) + kind at a time, across every company, every one of that tender''s own private per-company copies (migration 0032), and every worker process. Finding 443: widened from tender_id alone (0130''s original definition) once reproduced live that two different companies'' own private tenders rows for the SAME real-world tender could both reach ''generating'' at once with zero block. A claim that would violate this still raises 23505 under this same index name; process_narrative_jobs.py''s claim_job() is unchanged - it already matches by name, not by column list.';
