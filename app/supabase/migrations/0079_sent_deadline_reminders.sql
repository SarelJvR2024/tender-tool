-- Dedupe record for the deadline-reminder email (lib/deadlineReminders.ts) -
-- "closing in 3 days / 24 hours", triggered off the exact same facts
-- lib/notifications.ts's getNotifications() already computes for the
-- topbar bell (same closing_date join, same 14-day window), never a second
-- scan of tenders. Without this row, a cron run every few hours would
-- re-email the same tender's 3-day warning on every single run until it
-- actually closed - one row per (tender_id, threshold) is all that's needed
-- to send it exactly once.
create table sent_deadline_reminders (
  id uuid primary key default gen_random_uuid(),
  tender_id uuid not null references tenders(id) on delete cascade,
  threshold_days int not null, -- 3 or 1 (the "24 hours" warning) - see lib/deadlineReminders.ts's REMINDER_THRESHOLDS
  sent_at timestamptz not null default now(),
  unique (tender_id, threshold_days)
);
comment on table sent_deadline_reminders is
  'One row per tender per reminder threshold, written by app/api/cron/deadline-reminders after a send - prevents re-sending the same 3-day/24-hour warning on every cron run. Not tenant-scoped by company_id: tenders themselves are the shared/public table (0001''s own split), and a tender only ever has one tracking company via tender_packs in practice for this app''s v1 single-company-per-tender model.';

-- No RLS needed: this table is written only by the Next.js cron route via
-- start_payfast_checkout/apply_payfast_itn's own precedent of a narrow
-- SECURITY DEFINER function (never a direct client insert, and never read
-- by any client at all - it has no select policy, so RLS stays OFF-by-
-- default-deny is unnecessary; instead no policy exists, matching this
-- table's own "nothing authenticated ever reads this" role - PostgREST
-- still requires RLS enabled to expose it at all over the anon/authenticated
-- roles, so enable it with zero policies, closing it to every client role).
alter table sent_deadline_reminders enable row level security;

create or replace function record_deadline_reminder_sent(p_tender_id uuid, p_threshold_days int)
returns boolean -- true if this is the first time (caller should actually send the email), false if already sent
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into sent_deadline_reminders (tender_id, threshold_days) values (p_tender_id, p_threshold_days);
  return true;
exception
  when unique_violation then
    return false;
end;
$$;
revoke all on function record_deadline_reminder_sent(uuid, int) from public;
grant execute on function record_deadline_reminder_sent(uuid, int) to anon, authenticated;
comment on function record_deadline_reminder_sent(uuid, int) is
  'Atomically claims "send the 3-day/24-hour reminder for this tender" - the insert''s own unique constraint is the race-safe dedupe check (two overlapping cron runs can never both send), not a separate select-then-insert. Called by app/api/cron/deadline-reminders BEFORE sending; the email is only sent when this returns true.';
