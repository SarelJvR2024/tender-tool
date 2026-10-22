-- Fixes a real multi-tenant gap in 0079_sent_deadline_reminders.sql, found by
-- the standing QA pass before RESEND_API_KEY was ever set (no real rows exist
-- in sent_deadline_reminders yet - confirmed by reading this migration's own
-- unique constraint and the fact the feature just landed this same batch).
--
-- 0079's own comment claimed "a tender only ever has one tracking company via
-- tender_packs in practice for this app's v1 single-company-per-tender
-- model" - but tenders are the SHARED/PUBLIC table (0001's own split: the
-- daily discovery pipeline's one feed serves every tenant), and tender_packs
-- is `unique (company_id, tender_id)` (0001), not `unique (tender_id)` -
-- meaning MANY unrelated companies routinely each have their own
-- tender_packs row for the exact same public tender. That's the ordinary
-- case, not an edge case, for any popular SANRAL/eTenders listing.
--
-- scripts/send-deadline-reminders.ts reads `tenders.select(..., tender_packs
-- !inner(company_id))`, which (a has-many embed, not a to-one one) returns
-- EVERY matching tender_packs row as an array on the tender - but the script
-- only read tender.tender_packs[0].company_id and called
-- record_deadline_reminder_sent ONCE per tender, not once per company. With
-- the old `unique (tender_id, threshold_days)` constraint, the FIRST company
-- in that array (sort order unspecified) permanently claimed the dedupe slot
-- for that tender+threshold, and every OTHER company pursuing the same
-- tender silently never got a "closing in 3 days"/"24 hours" email at all,
-- for either threshold, for as long as that tender stays open - a real,
-- silent loss of a notification feature for an unpredictable subset of real
-- companies, the moment more than one company tracks the same public tender
-- (confirmed reachable: this is this product's own normal multi-tenant
-- shape, not contrived input).
--
-- Fix: scope the dedupe to (tender_id, company_id, threshold_days) - one
-- reminder per COMPANY per tender per threshold, matching tender_packs' own
-- per-company granularity - and have the script iterate every tender_packs
-- row, not just the first.
alter table sent_deadline_reminders add column company_id uuid references companies(id) on delete cascade;
-- No real row SHOULD exist yet (RESEND_API_KEY was never set before this
-- fix landed in the same batch as 0079 - scripts/send-deadline-reminders.ts's
-- own early-exit for a missing key), but "never guess, say what you don't
-- know" (this project's own standing rule) applies to a migration too: don't
-- just assert that and let `set not null` below fail loudly if it's wrong
-- (confirmed it does, against a local fixture with a pre-existing row - QA
-- pass, 2026-10-22). A pre-0080 row can't be honestly attributed to one
-- company anyway - it only proves SOME company among this tender's
-- tender_packs got the email under the old, unspecified-order [0] pick, not
-- which one - so the honest move is to delete it, not guess, and let the
-- next run re-evaluate fresh per company under the fixed logic (worst case:
-- one already-past reminder day doesn't get a backdated send, not a
-- double-send or a wrong recipient).
delete from sent_deadline_reminders where company_id is null;
alter table sent_deadline_reminders alter column company_id set not null;
alter table sent_deadline_reminders drop constraint sent_deadline_reminders_tender_id_threshold_days_key;
alter table sent_deadline_reminders add constraint sent_deadline_reminders_tender_id_company_id_threshold_days_key
  unique (tender_id, company_id, threshold_days);
comment on table sent_deadline_reminders is
  'One row per (tender, company, reminder threshold), written by scripts/send-deadline-reminders.ts after a send - prevents re-sending the same 3-day/24-hour warning on every cron run. Per-company, not just per-tender (0080): tenders are shared/public and tender_packs is unique(company_id, tender_id), so more than one company routinely tracks the same tender.';

create or replace function record_deadline_reminder_sent(p_tender_id uuid, p_company_id uuid, p_threshold_days int)
returns boolean -- true if this is the first time for this (tender, company, threshold) - caller should actually send the email
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into sent_deadline_reminders (tender_id, company_id, threshold_days) values (p_tender_id, p_company_id, p_threshold_days);
  return true;
exception
  when unique_violation then
    return false;
end;
$$;
revoke all on function record_deadline_reminder_sent(uuid, uuid, int) from public;
grant execute on function record_deadline_reminder_sent(uuid, uuid, int) to anon, authenticated;
comment on function record_deadline_reminder_sent(uuid, uuid, int) is
  'Atomically claims "send the 3-day/24-hour reminder for this (tender, company)" - the insert''s own unique constraint is the race-safe dedupe check. Called by scripts/send-deadline-reminders.ts once per (tender, company) pair BEFORE sending; the email is only sent when this returns true. Superseded the (tender_id, threshold_days)-only version (0079) - see this migration''s header comment.';

drop function if exists record_deadline_reminder_sent(uuid, int);
