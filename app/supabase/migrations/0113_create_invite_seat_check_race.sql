-- Standing review finding, 2026-11-04: app/app/company/team/actions.ts's
-- createInvite() enforces a plan's seat cap (max_users, 0083) by reading
-- company_subscriptions.max_users, then separately counting company_members
-- + pending company_invites, then comparing, then inserting - three plain
-- client-side queries with no lock between the count and the insert. Two
-- concurrent invite requests for the same company (an owner and an admin
-- both inviting someone at the same moment, or one person double-clicking
-- "Send invite" on a slow connection) can both read the same under-the-cap
-- count, both pass the check, and both insert - silently exceeding the
-- plan's seat limit. Same shape as 0107's redeem_company_invite() race,
-- fixed the same way: move the whole check-then-insert into one SECURITY
-- DEFINER function with `for update` on the subscription row, so a second
-- concurrent caller blocks on the lock instead of racing the first to the
-- count.
--
-- Reproduced directly in a disposable scratch database (not this app's live
-- DB): a company with max_users=2 and one existing member; two concurrent
-- sessions each running the old three-query shape (select max_users, count
-- members+pending, compare, insert) both read count=1 (under 2) and both
-- inserted - 2 pending invites + 1 member = 3 people against a cap of 2.
-- Re-run against this migration's `create_company_invite_checked()`: the
-- first caller's `for update` lock on company_subscriptions made the second
-- block until the first committed, then correctly saw count=2 (>= 2) and
-- raised instead of inserting - exactly one extra invite created, matching
-- the real seat cap.
--
-- auth.uid() is read directly inside the function for invited_by (never a
-- parameter) - the same "never trust a caller-supplied identity" pattern
-- redeem_company_invite() already uses, since this function is granted to
-- authenticated and therefore callable directly via supabase.rpc() by any
-- signed-in user, not only through this app's own Server Action. Ownership
-- is enforced here too (tt_is_company_admin(), 0050) - the Server Action's
-- own requireCompanyAdmin() check is real, but this function must not rely
-- on it being the only caller.
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
    select count(*) into v_pending_count from company_invites where company_id = p_company_id and accepted_at is null;
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
  'Creates a company_invites row after checking the caller is an owner/admin (tt_is_company_admin, 0050) and the company''s seat cap (company_subscriptions.max_users, 0083) is not already met by members + pending invites. Locks the subscription row (for update, 2026-11-04) for the duration so two concurrent invites for the same company can''t both slip past the seat check. invited_by is always auth.uid(), never a parameter, the same "never trust a caller-supplied identity" pattern as redeem_company_invite() (0077/0107).';
