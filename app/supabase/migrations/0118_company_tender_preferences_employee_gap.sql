-- Standing review finding, 2026-11-06 (quick "migrations after 0077" spot-
-- check the prior pass's own 0117 entry called for): company_tender_preferences
-- (0088, 11 days after 0077's own employee-RLS sweep) has only the three
-- PERMISSIVE is_company_member(company_id) policies 0088 gave it - true for
-- every role including 'employee', and never narrowed since (0104 only
-- added a column, no new policy). Same "added after the sweep, never
-- covered" shape 0117 found in company_subscriptions/company_members, one
-- migration later.
--
-- This one isn't money or a roster leak - it's a WRITE: discovery/preferencesActions.ts's
-- setOpportunityPreferences() is reachable by any company_members row
-- (requireCompanyId() there only checks "has a membership", no role check,
-- its own header comment says explicitly RLS is what's meant to narrow this
-- further) and upserts hide_sanral_board/interested_disciplines/preferred_buyers
-- for the whole company - these gate app/app/pipeline/page.tsx's shared
-- "found" column and app/app/discovery/page.tsx's own sort order for EVERY
-- member, not just the caller. Neither /discovery nor /pipeline is in
-- EMPLOYEE_NAV_ITEMS (nav-items.ts: an employee gets Home + My CV only,
-- "RLS already blocks the data" for everything else) - but as 0117 already
-- showed for /billing, that comment is only true where a RESTRICTIVE policy
-- actually backs it up, and here nothing did.
--
-- Reproduced directly in a disposable scratch database (never the live DB,
-- replay_schema.sh against all 117 prior migrations): one company, one
-- 'owner' member, one 'employee' member. Acting as the employee (set role
-- authenticated; set test.uid = '<employee uuid>'):
--   insert into company_tender_preferences (company_id, hide_sanral_board,
--     interested_disciplines) values (<company>, true, array['roads-and-stormwater'])
--     on conflict (company_id) do update ...
--   -> succeeded (1 row), hide_sanral_board flipped to true for the whole
--      company, confirmed by a follow-up select.
--
-- Fixed the same additive-only, narrow-only way 0077/0117 established: one
-- new RESTRICTIVE policy. For owner/admin/member, is_employee_in_company()
-- is false, so "not is_employee_in_company(...)" is unconditionally true
-- and their access (including the real setOpportunityPreferences() flow) is
-- completely unchanged - re-verified below, not assumed.

create policy "company_tender_preferences: employee has no access" on company_tender_preferences
  as restrictive
  for all to authenticated
  using (not is_employee_in_company(company_id))
  with check (not is_employee_in_company(company_id));
