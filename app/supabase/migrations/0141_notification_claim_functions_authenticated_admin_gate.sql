-- Standing solution-architect review, Finding 427, 2026-11-11: claim_notification()
-- (0093), record_notification_sent() (0093), record_deadline_reminder_sent() (0080)
-- and record_operational_alert_sent() (0092) are still callable by ANY signed-in
-- `authenticated` user, not just a platform admin, after 0119 revoked only `anon`.
--
-- This is the exact meta-lesson the task brief that found Finding 426 named:
-- 0119's own header comment gives, as its reason for leaving `authenticated`
-- granted, "the one webapp Server Action caller... redirects to /login unless
-- supabase.auth.getUser() already returns a signed-in user - genuinely
-- `authenticated`... and its own comment already says 'already granted to
-- authenticated'" - and Finding 274's own later write-up (PR #202, unmerged)
-- repeats the identical premise: "real, non-admin notification flows (the welcome
-- email) legitimately need to call them too." Checked that premise against the
-- real code (it was never re-checked by either pass): app/app/onboarding/
-- actions.ts's createCompanyBasics() - the ONLY place the welcome email is ever
-- sent - calls sendTransactionalEmail() directly and never calls claim_notification()
-- or any of these 4 functions at all. There is no genuine non-admin `authenticated`
-- caller anywhere in this app. Re-confirmed by re-grepping every real call site
-- (same method 0119's own pass used): every app/scripts/*.ts cron sender and
-- engine/notify/send_pack_ready_email.py authenticates with
-- SUPABASE_SERVICE_ROLE_KEY (bypasses every grant here regardless, per 0120's own
-- default-privilege finding); the only `authenticated`-context caller left in the
-- whole app is admin/notifications/actions.ts's sendTestNotificationEmail() (the
-- Template Gallery's "Send Test to Me" button), admin-only by explicit design per
-- that action's own header comment, 0119's own header comment ("a signed-in admin
-- test-send"), and Finding 274's write-up.
--
-- Finding 274 (PR #202, unmerged) adds an is_platform_admin() check to that ONE
-- Server Action, but a Server Action is not the only way to reach a SECURITY
-- DEFINER RPC granted to `authenticated` - PostgREST exposes every such function
-- directly over REST to any session carrying a valid `authenticated` JWT,
-- regardless of which page or action (if any) a browser is on. Confirmed live
-- (RED, below) against the real schema (PR #202 unapplied): a plain authenticated,
-- non-admin session - nothing more than a real signed-up user's own normal login -
-- can call `claim_notification('founder-digest-2026-12-25', 'founder_daily_digest')`
-- directly and successfully pre-claim it, permanently and silently burning Sarel's
-- own founder daily digest for that date with no error anywhere - the exact
-- one-time-ever-token damage 0119's own header comment already named as the most
-- concretely reachable harm of this bug class for `anon`, never closed for
-- `authenticated`. `record_notification_sent()` carries a second, independent harm:
-- any authenticated user can insert an arbitrary row into `notification_logs` (an
-- is_platform_admin()-gated audit table, 0093's own select policy) under any
-- company_id/tender_id/subject/status/error they can name, with no ownership check
-- anywhere in the function body - confirmed live below with company_id/tender_id
-- left null (a real company/tender id is FK-constrained, but the function has no
-- admin or ownership gate regardless of whether the id is real). The other two
-- functions (record_deadline_reminder_sent/record_operational_alert_sent) carry the
-- identical gap for sent_deadline_reminders/sent_operational_alerts - confirmed by
-- reading both bodies (0080/0092): neither has ever had an admin or ownership check.
--
-- Fix: the exact caller-role read company_member_labels() (0048) already
-- established for telling a real `authenticated` caller apart from the
-- service-role engine from INSIDE a SECURITY DEFINER body - current_user/
-- session_user don't work for this (both are overridden the moment a SECURITY
-- DEFINER function starts running as its owner); the JWT-role GUC PostgREST sets
-- before that happens is not. An `authenticated` caller who is not a platform
-- admin is refused outright (42501) before any insert is attempted; `service_role`
-- (every real script/engine caller - unaffected by any grant/revoke here per 0120,
-- and this body-level check reads a GUC service-role calls never set, so it never
-- matches 'authenticated' either) and a genuine signed-in platform admin (the one
-- real `authenticated` caller, Finding 274's own test-send) are both unaffected.
-- The `grant ... to authenticated` itself is deliberately left in place (narrowing
-- it further would need a second, SQL-level reason, which 0120 already
-- established doesn't apply here) - gating inside the function body, same shape
-- every other admin-only SECURITY DEFINER RPC in this schema already uses
-- (`if not is_platform_admin() then raise exception`), rather than a second round
-- of grant surgery for a caller class (authenticated-but-not-admin) that was
-- always reachable through the grant, just never checked inside the body.

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
  -- Finding 427: an authenticated-but-not-admin caller is refused outright -
  -- see this migration's own header for the full reasoning and live exploit.
  if coalesce(current_setting('request.jwt.claim.role', true),
              nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'authenticated'
     and not is_platform_admin() then
    raise exception 'Only a platform admin may claim a notification idempotency key directly.' using errcode = '42501';
  end if;
  insert into notification_claims (idempotency_key, notification_type) values (p_idempotency_key, p_notification_type);
  return true;
exception
  when unique_violation then
    return false;
end;
$$;
comment on function claim_notification(text, text) is
  'Atomically claims one idempotency_key for one notification_type - the insert''s own unique constraint is the race-safe check (two overlapping cron runs, or a retried request, can never both send). Callers (Next.js Server Actions with no service-role key, and the standalone scripts/engine jobs that do have one) both call this the same way, before sending; the email is only sent when this returns true. Mirrors apply_payfast_itn / record_deadline_reminder_sent''s own proven shape. Finding 427 (0141): an `authenticated` caller who is not a platform admin is refused (42501) before any insert is attempted - every real caller is either service_role (unaffected, see 0120) or a signed-in platform admin test-send (admin/notifications/actions.ts) - 0119''s own stated reason for keeping `authenticated` granted ("the welcome email legitimately needs to call this too") does not hold up against the real code (the welcome email never calls this function at all).';

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
  -- Finding 427: same admin-or-service_role-only gate as claim_notification()
  -- above - without it, any authenticated user could insert an arbitrary audit
  -- row under any company_id/tender_id they can name, with no ownership check.
  if coalesce(current_setting('request.jwt.claim.role', true),
              nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'authenticated'
     and not is_platform_admin() then
    raise exception 'Only a platform admin may record a notification-sent log row directly.' using errcode = '42501';
  end if;
  insert into notification_logs (
    idempotency_key, notification_type, recipient_email, company_id, tender_id, subject, status, resend_id, error
  ) values (
    p_idempotency_key, p_notification_type, p_recipient_email, p_company_id, p_tender_id, p_subject, p_status, p_resend_id, p_error
  );
end;
$$;
comment on function record_notification_sent(text, text, text, uuid, uuid, text, text, text, text) is
  'Writes one notification_logs row. Called by the same sendNotification() helper (lib/notificationEngine.ts) right after a Resend send attempt, whether it succeeded or failed - called from both the anon/authenticated context (a Server Action with no service-role key, e.g. the welcome email) and service-role scripts (which could insert directly, but go through the same function for one consistent write path and one place that enforces the status check). Finding 427 (0141): an `authenticated` caller who is not a platform admin is refused (42501) before any insert is attempted - see claim_notification()''s own updated comment and this migration''s header for the full reasoning (the "welcome email" premise above does not hold up against the real code - it never calls this function).';

create or replace function record_deadline_reminder_sent(p_tender_id uuid, p_company_id uuid, p_threshold_days int)
returns boolean -- true if this is the first time for this (tender, company, threshold) - caller should actually send the email
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Finding 427: same admin-or-service_role-only gate as claim_notification()
  -- - this function's own one-time-ever claim is the identical shape, and it
  -- has never had an admin or ownership check either.
  if coalesce(current_setting('request.jwt.claim.role', true),
              nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'authenticated'
     and not is_platform_admin() then
    raise exception 'Only a platform admin may claim a deadline-reminder token directly.' using errcode = '42501';
  end if;
  insert into sent_deadline_reminders (tender_id, company_id, threshold_days) values (p_tender_id, p_company_id, p_threshold_days);
  return true;
exception
  when unique_violation then
    return false;
end;
$$;
comment on function record_deadline_reminder_sent(uuid, uuid, int) is
  'Atomically claims "send the 3-day/24-hour reminder for this (tender, company)" - the insert''s own unique constraint is the race-safe dedupe check. Called by scripts/send-deadline-reminders.ts once per (tender, company) pair BEFORE sending; the email is only sent when this returns true. Superseded the (tender_id, threshold_days)-only version (0079) - see this migration''s header comment. Finding 427 (0141): an `authenticated` caller who is not a platform admin is refused (42501) before any insert is attempted - the real caller is always scripts/send-deadline-reminders.ts (service_role), never a Server Action.';

create or replace function record_operational_alert_sent(p_alert_type text, p_tender_id uuid, p_company_id uuid, p_threshold_key text)
returns boolean -- true if this is the first time for this (type, tender, company, threshold) - caller should actually send
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Finding 427: same admin-or-service_role-only gate as claim_notification()
  -- - this function's own one-time-ever claim is the identical shape, and it
  -- has never had an admin or ownership check either.
  if coalesce(current_setting('request.jwt.claim.role', true),
              nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'authenticated'
     and not is_platform_admin() then
    raise exception 'Only a platform admin may claim an operational-alert token directly.' using errcode = '42501';
  end if;
  insert into sent_operational_alerts (alert_type, tender_id, company_id, threshold_key)
  values (p_alert_type, p_tender_id, p_company_id, p_threshold_key);
  return true;
exception
  when unique_violation then
    return false;
end;
$$;
comment on function record_operational_alert_sent(text, uuid, uuid, text) is
  'Atomically claims "send this operational alert" - the insert''s own unique constraint is the race-safe dedupe check. Called by scripts/send-operational-alerts.ts once per candidate BEFORE sending; the email is only sent when this returns true. Finding 427 (0141): an `authenticated` caller who is not a platform admin is refused (42501) before any insert is attempted - the real caller is always scripts/send-operational-alerts.ts (service_role), never a Server Action.';
