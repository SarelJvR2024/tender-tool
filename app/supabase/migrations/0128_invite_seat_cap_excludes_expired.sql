-- Finding 319: an expired, never-accepted company_invites row permanently
-- occupied a seat in create_company_invite_checked()'s own seat-cap count
-- (0113), forever - the function's `v_pending_count` was
-- `where accepted_at is null`, with no `expires_at` check at all, so a dead
-- invite nobody ever accepted (expires_at < now(), 14 days by default, 0077)
-- kept counting toward "people" exactly like a real pending invite that
-- could still be accepted at any moment.
--
-- Reproduced live in a disposable scratch Postgres (replayed through 0127,
-- dropped after): a company with ONE real member (its owner) and ONE
-- company_invites row manually back-dated to expires_at in the past
-- (accepted_at still null - exactly what a real invite link nobody ever
-- clicked looks like after 14 days), on a plan with max_users = 2. Before
-- this fix: create_company_invite_checked() for a second, brand-new invite
-- raised 'Your plan allows 2 people - upgrade on the Billing page to add
-- more.' even though only 1 of the 2 seats was ever actually occupied (the
-- owner) - the error, read by a real admin, says "upgrade your plan" when
-- the true fix is "this invite link already died, ignore it or revoke it".
--
-- /company/team's own "Pending invites" list has the identical gap: its
-- query (`.is("accepted_at", null)`, page.tsx) never checks expires_at
-- either, so the SAME expired, un-clickable invite (confirmed dead by
-- invite_preview()'s own is_expired check, 0077 - /invite/<token> shows
-- "Invite expired" for it) sits there labelled "Pending invites" alongside
-- real, still-acceptable ones, with no visual difference, forever, unless an
-- admin notices the stale created/expires dates and manually revokes it.
-- Fixed in the same change (page.tsx's query only - no new migration needed
-- for that half).
--
-- Fix: "pending" for the seat cap means "could still be accepted", i.e.
-- accepted_at is null AND not yet expired - the same two-part test
-- invite_preview() already uses to decide whether a link still works.
create or replace function create_company_invite_checked(
  p_company_id uuid, p_email text, p_role text, p_linked_person_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_max_users int;
  v_member_count int;
  v_pending_count int;
  v_invite_id uuid;
begin
  if not tt_is_company_admin(p_company_id) then
    raise exception 'Only an owner or admin of this company can create invites.';
  end if;

  -- for update: locks this company's subscription row for the rest of the
  -- transaction, so a second concurrent call for the SAME company blocks
  -- here until this one commits or rolls back, instead of racing it to the
  -- count below. A company with no subscription row (shouldn't happen, but
  -- not asserted here) or a null max_users (Enterprise, 0083 - no fixed
  -- seat cap) skips the check entirely, same as the original code.
  select max_users into v_max_users from company_subscriptions where company_id = p_company_id for update;

  if v_max_users is not null then
    select count(*) into v_member_count from company_members where company_id = p_company_id;
    -- Finding 319: an invite that expired without ever being accepted can
    -- never be redeemed again (redeem_company_invite() itself refuses once
    -- expires_at < now(), 0077/0107/0116/0122) - it is dead, not pending,
    -- and must not keep charging a seat it can no longer fill.
    select count(*) into v_pending_count from company_invites
      where company_id = p_company_id and accepted_at is null and expires_at >= now();
    if v_member_count + v_pending_count >= v_max_users then
      raise exception 'Your plan allows % people - upgrade on the Billing page to add more.', v_max_users using errcode = 'P0004';
    end if;
  end if;

  insert into company_invites (company_id, email, role, linked_person_id, invited_by)
  values (p_company_id, p_email, p_role, p_linked_person_id, auth.uid())
  returning id into v_invite_id;

  return v_invite_id;
end;
$$;
revoke all on function create_company_invite_checked(uuid, text, text, uuid) from public;
grant execute on function create_company_invite_checked(uuid, text, text, uuid) to authenticated;
comment on function create_company_invite_checked(uuid, text, text, uuid) is
  'Creates a company_invites row after checking the caller is an owner/admin (tt_is_company_admin, 0050) and the company''s seat cap (company_subscriptions.max_users, 0083) is not already met by members + invites that could still be accepted (accepted_at is null and not yet expired - Finding 319, 0128). Locks the subscription row (for update, 2026-11-04) for the duration so two concurrent invites for the same company can''t both slip past the seat check. invited_by is always auth.uid(), never a parameter, the same "never trust a caller-supplied identity" pattern as redeem_company_invite() (0077/0107).';
