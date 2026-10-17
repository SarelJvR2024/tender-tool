-- The deadline-reminder and digest-readiness "seen" stores in the database
-- (Sarel, 2026-10-17: "why would anything be saved in local instead of
-- database" - Hardcoded-Assumptions-Audit §9.4, "The other local seen stores").
--
-- Same reasoning and same shape as 0038 (discovery_seen_releases): a local
-- JSON file on whichever machine ran the script does not survive a redeploy,
-- a second worker or a run from another machine, and it is not per tenant.
-- Before this:
--   state/seen_deadlines.json        engine/compliance/watch_deadlines.py
--   state/seen_digest_readiness.json engine/notify/daily_digest.py --mode live
--                                    (its deadline items AND its readiness
--                                    changes, in one file)
--
-- 1. deadline_reminders_seen: one row per (company, consumer, seen key) a
--    reminder script has already reported. The seen key is the scripts' own
--    key, unchanged (doc::<company>::<column>::<expiry>::<status>,
--    person::<person>::<column>::<expiry>::<status>,
--    task::<task>::<due>::<status>,
--    doc_before_closing::<company>::<column>::<expiry>::<tender>), so the
--    window / escalation rules (watch_deadlines._expiry_window) are untouched.
--    `consumer` keeps the two readers apart, exactly as their two files did:
--    the watch's reminder report and the daily digest each report an item
--    once, independently - one consuming an item must not hide it from the
--    other.
--
-- 2. digest_readiness_seen: the last field_provenance status the digest saw
--    per row (a readiness CHANGE is reported when the status differs from
--    what was last seen). Per company through the row's tender pack.
--
-- Written only by the scripts via the service role (same as 0038): no client
-- insert/update/delete policy. Members can read their own company's rows.

create table deadline_reminders_seen (
  company_id uuid not null references companies(id) on delete cascade,
  consumer text not null check (consumer in ('watch_deadlines', 'daily_digest')),
  seen_key text not null check (length(seen_key) between 1 and 500),
  kind text not null check (kind ~ '^[a-z_]{1,60}$'),
  first_seen date not null default current_date,
  created_at timestamptz not null default now(),
  primary key (company_id, consumer, seen_key)
);

comment on table deadline_reminders_seen is
  'Reminder seen store: one row per (company, consumer, item key) watch_deadlines.py (consumer watch_deadlines) or daily_digest.py --mode live (consumer daily_digest) has already reported. Replaces state/seen_deadlines.json and the deadline half of state/seen_digest_readiness.json. Written by the service role only.';
comment on column deadline_reminders_seen.seen_key is
  'The script''s own key, e.g. doc::<company>::<column>::<expiry>::<status>. A renewed document (new expiry) or an escalation (renew_soon -> expired, due_soon -> overdue) is a new key, so it is reported again.';

create index deadline_reminders_seen_consumer_idx on deadline_reminders_seen (consumer);

alter table deadline_reminders_seen enable row level security;

create policy "deadline_reminders_seen: members can select" on deadline_reminders_seen
  for select to authenticated using (is_company_member(company_id));
-- No insert/update/delete policy for authenticated clients: service role only.

create table digest_readiness_seen (
  company_id uuid not null references companies(id) on delete cascade,
  field_provenance_id uuid not null references field_provenance(id) on delete cascade,
  status text not null check (status in ('confirmed', 'computed', 'assumed_default', 'missing')),
  first_seen date not null default current_date,
  updated_at timestamptz not null default now(),
  primary key (company_id, field_provenance_id)
);

comment on table digest_readiness_seen is
  'Daily digest readiness seen store: the field_provenance status daily_digest.py last saw per row, so only a CHANGE is reported. Replaces the prov:: half of state/seen_digest_readiness.json. Written by the service role only.';

alter table digest_readiness_seen enable row level security;

create policy "digest_readiness_seen: members can select" on digest_readiness_seen
  for select to authenticated using (is_company_member(company_id));
-- No insert/update/delete policy for authenticated clients: service role only.

-- 3. 0038's profile_fingerprint is now acted on (Sarel, 2026-10-17: re-score a
--    company on a tender when its profile changed since it was last scored) -
--    a code change in watch_new_tenders.fan_out(), as 0038 intended; only the
--    column comment, which said "not acted on today", is corrected here.
comment on column discovery_seen_releases.profile_fingerprint is
  'sha256 of the company profile the verdict was scored against. watch_new_tenders.py re-scores the release for this company (and reports a report-worthy result again, marked rescored=profile_changed) when the company''s current profile fingerprint differs.';
comment on column discovery_seen_releases.verdict is
  'This company''s own verdict when it was last scored (assess_tender.score_release). ERROR = scoring raised; retried on every later run (and recorded in system_alerts), not remembered as seen.';
