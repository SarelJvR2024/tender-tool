-- Discovery "seen" store in the database, per company x release (Sarel,
-- 2026-10-17, Hardcoded-Assumptions-Audit follow-up (d): move it out of the
-- local JSON file).
--
-- engine/discovery/watch_new_tenders.py remembers which releases it has
-- already scored for which company, so a run only ever reports what is new to
-- that company. Until now that memory was state/seen_tenders.json - one file
-- on whatever machine ran the watch. Since Discovery scores every company from
-- its own rows (Q4, §8.2), the memory is per company, and a file on one host
-- does not survive a redeploy, a second host, or a run from another machine.
--
-- Why per company, not one row per release: the same tender is scored
-- separately for each company (one company's strong_fit is another's
-- not_a_fit), a company added later must still be scored on releases already
-- seen for the others, and a company's own profile can change. One row is
-- one company's verdict on one release, at the time it was scored.
--
-- release_key is the watch's own key: the OCDS ocid, falling back to the
-- contract number for the rare release with none (same rule as before).
--
-- profile_fingerprint: sha256 of the profile the verdict was scored against
-- (company_profiles.profile_fingerprint). Recorded, not acted on: today a
-- company is never re-notified about a release it has been scored on, even if
-- its profile has changed since. Whether a changed profile should re-surface
-- an older release is an open question for Sarel; this column makes that a
-- code change later, not another migration.
--
-- Written only by the watch via the service role (same as
-- discovered_opportunities, 0004): no client insert/update/delete policy.
-- Members can read their own company's rows.
--
-- The local JSON file remains only for a run with no Supabase configured
-- (--profile files), where companies have no company_id to key on.

create table discovery_seen_releases (
  company_id uuid not null references companies(id) on delete cascade,
  release_key text not null check (length(release_key) between 1 and 300),
  ocid text,
  contract_number text,
  title text,
  verdict text not null check (
    verdict in ('strong_fit', 'possible', 'needs_review', 'not_a_fit', 'closed', 'ERROR')
  ),
  profile_fingerprint text check (profile_fingerprint is null or profile_fingerprint ~ '^[0-9a-f]{64}$'),
  first_seen date not null default current_date,
  scored_at timestamptz not null default now(),
  primary key (company_id, release_key)
);

comment on table discovery_seen_releases is
  'Discovery seen store: one row per (company, OCDS release) watch_new_tenders.py has scored for that company, with the verdict at the time. A company with a row for a release is not scored or notified on it again. Replaces state/seen_tenders.json for Supabase-mode runs. Written by the service role only.';
comment on column discovery_seen_releases.release_key is
  'The watch''s seen key: the OCDS ocid, else the contract number.';
comment on column discovery_seen_releases.verdict is
  'This company''s own verdict when it was scored (assess_tender.score_release). ERROR = scoring raised; recorded so a broken release is not retried every run, same as the JSON store did.';
comment on column discovery_seen_releases.profile_fingerprint is
  'sha256 of the company profile the verdict was scored against. Recorded for a future "re-surface when the profile changed" rule; not acted on today.';

create index discovery_seen_releases_release_key_idx on discovery_seen_releases (release_key);

alter table discovery_seen_releases enable row level security;

create policy "discovery_seen_releases: members can select" on discovery_seen_releases
  for select to authenticated using (is_company_member(company_id));
-- No insert/update/delete policy for authenticated clients: written only by
-- watch_new_tenders.py via the service role.
