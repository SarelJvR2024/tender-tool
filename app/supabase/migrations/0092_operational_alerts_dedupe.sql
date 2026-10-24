-- Dedupe record for the 3 new operational email alerts (Batch: "Operational
-- Notification Engine", Sarel's own brief) - print & transit cutoff,
-- briefing countdown, compliance-document expiry. Same shape and reasoning
-- as sent_deadline_reminders (0079/0080): without a row recording "already
-- sent", a daily cron run would re-email the same warning every single run
-- until the underlying date passes.
--
-- Generalized into ONE table across all 3 alert types, not three near-
-- identical tables, for two reasons: (1) all three dedupe on the exact same
-- shape - "has (this alert type, for this tender if any, for this company,
-- at this threshold) already been sent" - and three copies of the same
-- table+function pair would be the kind of duplicate logic this app's own
-- rules warn against; (2) compliance-document expiry isn't tender-scoped at
-- all (it's a company vault field, e.g. SARS Tax Compliance PIN), so
-- tender_id must already be nullable here - a table literally named
-- "sent_tender_alerts" would be the wrong shape for that one alert type.
--
-- threshold_key carries whatever distinguishes one alert instance from
-- another within its own type: '48h' for the print/transit cutoff (a single
-- threshold, not a set), '5' or '1' (days) for the briefing countdown, and
-- '<company field>:14' (e.g. 'sars_tcs_pin_expiry:14') for compliance
-- expiry - the field name is part of the key because a company can have
-- more than one tracked expiry field reach 14 days out independently.
create table sent_operational_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null check (alert_type in ('print_cutoff', 'briefing', 'compliance_expiry')),
  tender_id uuid references tenders(id) on delete cascade, -- null for compliance_expiry (not tender-scoped)
  company_id uuid not null references companies(id) on delete cascade,
  threshold_key text not null,
  sent_at timestamptz not null default now(),
  unique nulls not distinct (alert_type, tender_id, company_id, threshold_key)
);
comment on table sent_operational_alerts is
  'One row per (alert_type, tender, company, threshold), written by scripts/send-operational-alerts.ts after a send - prevents re-sending the same print-cutoff/briefing/compliance-expiry warning on every cron run. tender_id is null for compliance_expiry (a company vault field''s own expiry, not tied to one tender). See lib/printCutoffReminders.ts, lib/briefingReminders.ts and lib/complianceExpiryReminders.ts for what each alert_type''s own threshold_key means.';

-- Same "no client role ever reads or writes this directly" shape as
-- sent_deadline_reminders (0079) - RLS enabled with zero policies, written
-- only through the SECURITY DEFINER function below, called by the
-- service-role script.
alter table sent_operational_alerts enable row level security;

create or replace function record_operational_alert_sent(p_alert_type text, p_tender_id uuid, p_company_id uuid, p_threshold_key text)
returns boolean -- true if this is the first time for this (type, tender, company, threshold) - caller should actually send
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into sent_operational_alerts (alert_type, tender_id, company_id, threshold_key)
  values (p_alert_type, p_tender_id, p_company_id, p_threshold_key);
  return true;
exception
  when unique_violation then
    return false;
end;
$$;
revoke all on function record_operational_alert_sent(text, uuid, uuid, text) from public;
grant execute on function record_operational_alert_sent(text, uuid, uuid, text) to anon, authenticated;
comment on function record_operational_alert_sent(text, uuid, uuid, text) is
  'Atomically claims "send this operational alert" - the insert''s own unique constraint is the race-safe dedupe check. Called by scripts/send-operational-alerts.ts once per candidate BEFORE sending; the email is only sent when this returns true.';
