-- A re-assessment that downgrades a company's Discovery verdict is flagged,
-- never silently applied (Sarel, 2026-10-17: "When evaluation downgrades
-- opportunity it must be flagged").
--
-- engine/discovery/watch_new_tenders.py re-scores a tender for a company whose
-- own profile changed since it was scored (Hardcoded-Assumptions-Audit §11.1).
-- Until now a worse result either left the old row saying "Strong fit" (a
-- not_a_fit result is not report-worthy, so the seeder never saw it) or
-- overwrote the verdict with no trace it had been better. Now the seeder
-- (seed_supabase_opportunities.py + discovery_downgrades.py) compares the new
-- verdict with the row's - fit order strong_fit > possible > needs_review >
-- not_a_fit; `closed` is never a downgrade - and on a downgrade keeps:
--
--   downgraded_from   the best verdict the company was shown before
--   downgraded_at     when the re-assessment made it worse
--   downgrade_cause   the watch's reason for re-scoring ('profile_changed' /
--                     'retry_after_error'), null when not known
--   reasons_before    why it matched before (`reasons` holds the new ones)
--
-- The Discovery card (and the Tender Workspace's "How this tender was read"
-- card, and the Pipeline chip) show "Re-assessed: was Strong fit, now Not a
-- fit" until a member marks it seen; after that a small "was Strong fit"
-- marker stays, so a downgraded tender never looks like one that was never a
-- match. A verdict that recovers to at least what it was clears the flag.
--
-- Seen/acknowledged: the same shape as the tender-update accept (0048,
-- accept_tender_update_date): discovered_opportunities stays service-role
-- written (0004, no client update policy) and a SECURITY DEFINER function
-- records who marked it seen and when, for any member of the row's company.
-- downgrade_digested_at is the daily digest's "carried once" marker, the same
-- idea as tender_update_notifications.digested_at (0039).

alter table discovered_opportunities
  add column downgraded_from text
    check (downgraded_from in ('strong_fit', 'possible', 'needs_review')),
  add column downgraded_at timestamptz,
  add column downgrade_cause text
    check (downgrade_cause in ('profile_changed', 'retry_after_error')),
  add column reasons_before text[],
  add column downgrade_acknowledged_at timestamptz,
  add column downgrade_acknowledged_by uuid references auth.users(id) on delete set null,
  add column downgrade_digested_at timestamptz,
  add constraint discovered_opportunities_downgrade_pair
    check ((downgraded_from is null) = (downgraded_at is null));

comment on column discovered_opportunities.downgraded_from is
  'Set when a re-assessment (watch_new_tenders.py re-score, e.g. after the company''s profile changed) made this company''s verdict worse: the best verdict it was shown before. Null = never downgraded, or recovered since.';
comment on column discovered_opportunities.reasons_before is
  'The reasons the tender matched before the downgrade (reasons holds the re-assessment''s).';
comment on column discovered_opportunities.downgrade_acknowledged_at is
  'A member marked the downgrade seen (acknowledge_discovery_downgrade). The card then shows a small "was ..." marker instead of the banner.';
comment on column discovered_opportunities.downgrade_digested_at is
  'The daily digest (engine/notify/daily_digest.py) carried this downgrade - carried once.';

create index discovered_opportunities_open_downgrade_idx
  on discovered_opportunities (company_id) where downgraded_from is not null and downgrade_acknowledged_at is null;

create or replace function acknowledge_discovery_downgrade(p_opportunity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  opp discovered_opportunities%rowtype;
begin
  select * into opp from discovered_opportunities where id = p_opportunity_id;
  if not found or not is_company_member(opp.company_id) then
    raise exception 'Discovery entry not found.';
  end if;
  if opp.downgraded_from is null then
    raise exception 'This tender has not been re-assessed - nothing to mark as seen.';
  end if;
  update discovered_opportunities
     set downgrade_acknowledged_at = coalesce(downgrade_acknowledged_at, now()),
         downgrade_acknowledged_by = coalesce(downgrade_acknowledged_by, auth.uid())
   where id = p_opportunity_id;
end;
$$;

revoke all on function acknowledge_discovery_downgrade(uuid) from public, anon;
grant execute on function acknowledge_discovery_downgrade(uuid) to authenticated;
