-- Multi-tier transactional notification engine (Sarel's own brief, "Multi-
-- Tier Transactional Notification Engine (Resend)" + the Tier 0 onboarding
-- addendum, 2026-10-24).
--
-- Numbered 0093, not 0092: two sessions independently built overlapping
-- notification-engine work from the same brief at the same time. 0092 is
-- session_011NLr419YmLS44xgf1YM6n3's own 0092_operational_alerts_dedupe.sql
-- (merged to main first, as PR #144) - sent_operational_alerts, scoped to
-- 3 already-cron-wired alert types (print cutoff, briefing, a 2-field
-- compliance expiry). This migration is additive, not a replacement:
-- separate table names, separate functions, zero overlap, reconciled by
-- the two sessions directly (send_message, 2026-10-24) rather than either
-- one silently overwriting the other - see docs/specs/System-Status.md for
-- the full account. notification_claims/notification_logs below cover
-- what 0092 doesn't: Tier 0 (onboarding/lifecycle), Tier 3 (founder/Scout),
-- and a generalised, audit-logged idempotency pattern for every type
-- beyond those first 3 - sent_operational_alerts stays exactly as it is,
-- live and unmodified.
--
-- This is deliberately NOT a from-scratch build. Real sending infrastructure
-- already existed before this migration (lib/resendEmail.ts, the welcome
-- email, scripts/send-deadline-reminders.ts) with its own established
-- idempotency pattern - a narrow SECURITY DEFINER function doing an INSERT
-- and catching unique_violation as the atomic "have I already sent this"
-- check (sent_deadline_reminders / record_deadline_reminder_sent, 0079/0080;
-- the exact same shape as apply_payfast_itn's own claim). This migration
-- generalises that ONE proven pattern across every notification type this
-- brief adds, rather than inventing 9+ more one-off per-feature tables the
-- way sent_deadline_reminders itself warned against doing for "a second,
-- genuinely different notification type" (0073's own comment) - that
-- threshold is now genuinely met, by a wide margin.
--
-- Two tables, not one, on purpose:
--   - notification_claims: the actual concurrency-safe dedupe gate. Tiny,
--     write-once-per-key, never read back except by its own unique index.
--   - notification_logs: an append-only audit trail of every attempted
--     send (recipient, subject, Resend id, status) - written AFTER a claim
--     succeeds, for debugging ("did this person actually get this email")
--     and Tier 3's founder digest. Separate from the claim table because its
--     job is different (human-readable history, queried by admin; never the
--     dedupe check itself) and because a failed SEND still needs a log row
--     even though the claim already succeeded (the email was genuinely
--     attempted - re-claiming and re-sending would double-send on a retry
--     for a transient Resend error, which is exactly what the claim exists
--     to prevent; a failed send is visible in notification_logs.status for
--     a human to notice and resend manually, same as every other "never
--     silently retry, never silently drop" rule this engine follows).
--
-- `notification_preferences` from the brief is deliberately NOT built here.
-- This brief's own "Deliverables & Acceptance Criteria" checklist does not
-- list a preferences table or UI, and every notification type this
-- migration's own two tables serve is either already covered by an
-- existing, narrower opt-in (company_members.daily_digest_opt_in, 0073) or
-- is an operational/compliance alert the brief itself says "cannot be
-- disabled for active bidders" - building a generalised opt-out table with
-- nothing real to opt out of yet would be exactly the premature
-- abstraction this project's own standing rule warns against. Revisit when
-- a genuinely optional, not-yet-covered notification type needs its own
-- toggle (flagged in docs/specs/System-Status.md, not guessed at here).

create table notification_claims (
  idempotency_key text primary key,
  notification_type text not null check (notification_type ~ '^[a-z0-9_]{1,64}$'),
  created_at timestamptz not null default now()
);
comment on table notification_claims is
  'Atomic "has this exact notification already been sent" gate - one row per idempotency_key, inserted by claim_notification() before any send is attempted. notification_type is denormalised here (not just in notification_logs) purely so a stuck/abandoned claim is diagnosable by type without a join.';
create index notification_claims_type_idx on notification_claims (notification_type);

-- No RLS needed in the "define policies" sense, same reasoning
-- sent_deadline_reminders (0079) already gives for the same shape: nothing
-- authenticated ever reads or writes this directly, only through
-- claim_notification() below. Enabled with zero policies so PostgREST
-- still closes it to anon/authenticated by default.
alter table notification_claims enable row level security;

create or replace function claim_notification(p_idempotency_key text, p_notification_type text)
returns boolean -- true = this is the first claim (caller must now actually send); false = already sent, do nothing
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key must not be empty' using errcode = '22023';
  end if;
  insert into notification_claims (idempotency_key, notification_type) values (p_idempotency_key, p_notification_type);
  return true;
exception
  when unique_violation then
    return false;
end;
$$;
comment on function claim_notification(text, text) is
  'Atomically claims one idempotency_key for one notification_type - the insert''s own unique constraint is the race-safe check (two overlapping cron runs, or a retried request, can never both send). Callers (Next.js Server Actions with no service-role key, and the standalone scripts/engine jobs that do have one) both call this the same way, before sending; the email is only sent when this returns true. Mirrors apply_payfast_itn / record_deadline_reminder_sent''s own proven shape.';
revoke all on function claim_notification(text, text) from public;
grant execute on function claim_notification(text, text) to anon, authenticated;

create table notification_logs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  notification_type text not null check (notification_type ~ '^[a-z0-9_]{1,64}$'),
  recipient_email text not null,
  -- Diagnosis-only context, same convention as system_alerts.context (0042) -
  -- never a join target, never shown to a tenant, ON DELETE SET NULL so a
  -- deleted company/tender never blocks deleting it (POPIA s24, same
  -- reasoning 0044 already applied to every other "who did this" reference).
  company_id uuid references companies(id) on delete set null,
  tender_id uuid references tenders(id) on delete set null,
  subject text not null check (length(subject) between 1 and 500),
  status text not null check (status in ('sent', 'failed', 'skipped_no_api_key')),
  resend_id text,
  error text check (error is null or length(error) <= 2000),
  sent_at timestamptz not null default now()
);
comment on table notification_logs is
  'Append-only audit trail of every attempted notification send, written after a successful claim_notification() call. Not the dedupe mechanism itself (notification_claims is) - this is for "did X actually get this email" debugging and Tier 3''s founder digest. Owner/platform-admin visibility only, same non-tenant-scoped convention as system_alerts and admin_harness_runs: a recipient''s own inbox is the real record of their own mail, this table is Tender Ready''s own operational visibility into whether sending worked.';
comment on column notification_logs.idempotency_key is
  'The same key claim_notification() was called with - lets a human trace one specific send back to its claim row.';

create index notification_logs_sent_at_idx on notification_logs (sent_at desc);
create index notification_logs_type_idx on notification_logs (notification_type, sent_at desc);

alter table notification_logs enable row level security;
create policy "notification_logs: platform admins can select" on notification_logs
  for select to authenticated using (is_platform_admin());

create or replace function record_notification_sent(
  p_idempotency_key text,
  p_notification_type text,
  p_recipient_email text,
  p_company_id uuid,
  p_tender_id uuid,
  p_subject text,
  p_status text,
  p_resend_id text,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('sent', 'failed', 'skipped_no_api_key') then
    raise exception 'status must be sent, failed or skipped_no_api_key' using errcode = '22023';
  end if;
  insert into notification_logs (
    idempotency_key, notification_type, recipient_email, company_id, tender_id, subject, status, resend_id, error
  ) values (
    p_idempotency_key, p_notification_type, p_recipient_email, p_company_id, p_tender_id, p_subject, p_status, p_resend_id, p_error
  );
end;
$$;
comment on function record_notification_sent(text, text, text, uuid, uuid, text, text, text, text) is
  'Writes one notification_logs row. Called by the same sendNotification() helper (lib/notificationEngine.ts) right after a Resend send attempt, whether it succeeded or failed - called from both the anon/authenticated context (a Server Action with no service-role key, e.g. the welcome email) and service-role scripts (which could insert directly, but go through the same function for one consistent write path and one place that enforces the status check).';
revoke all on function record_notification_sent(text, text, text, uuid, uuid, text, text, text, text) from public;
grant execute on function record_notification_sent(text, text, text, uuid, uuid, text, text, text, text) to anon, authenticated;
