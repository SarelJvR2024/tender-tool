-- Standing review finding, 2026-11-09: a prior pass's own write-up (Finding
-- 236) flagged that create_company_invite_checked() (0113) never validates
-- p_linked_person_id belongs to p_company_id, but judged it "dead-but-sloppy,
-- not exploitable" because redeem_company_invite()'s own LATER, unconditional
-- `update people ... where id = v_invite.linked_person_id and company_id =
-- v_invite.company_id` already silently matches zero rows on a cross-company
-- mismatch. That write-side claim is correct - but it is only half the
-- function. This migration found that the EARLIER read in the same function
-- (0122's own `select linked_user_id into v_person_owner from people where
-- id = v_invite.linked_person_id for update`) has NO such company_id filter,
-- unlike the update right below it, and its result directly gates a `raise
-- exception 'That roster entry is already linked to a different account.'`
-- This is a real cross-tenant information-disclosure oracle, not a
-- non-exploitable loose end: any signed-in user who is owner/admin of ANY
-- company (including one they just created for this purpose) can call
-- create_company_invite_checked() directly via supabase.rpc() - bypassing
-- whatever the UI's own roster picker restricts client-side - naming a
-- COMPLETE STRANGER's real people.id from a different company as
-- p_linked_person_id, then redeem that invite themselves (a second mailbox
-- they control) to learn, from whether the call raises or succeeds, whether
-- that stranger's people row already has a linked user account - with zero
-- legitimate relationship to that company.
--
-- Reproduced live in a disposable scratch database (engine/security/
-- replay_schema.sh, never this app's live DB), against the real, unmodified
-- 0122 function body, as the real `authenticated` role (never service_role):
-- a Company-A owner created two invites naming two different Company-B
-- people rows - one already linked to a real Company-B user, one not -
-- then redeemed each with a different account of their own. RED (current,
-- pre-fix behaviour, confirmed): invite #1 (targets the ALREADY-LINKED
-- person) raised exactly `That roster entry is already linked to a
-- different account.` and rolled back entirely (no company_members row for
-- that redeemer); invite #2 (targets the NOT-yet-linked person) raised
-- nothing and fully committed (company_members row inserted, invite marked
-- accepted) - the two outcomes exactly mirror the hidden linked/unlinked
-- state of an unrelated company's own person records. Company B's actual
-- `people` rows were never written to in either case (confirming the
-- existing update-side filter already works as documented) - the gap is
-- read-only disclosure, not a write-side takeover.
--
-- Two changes, both defense-in-depth, matching this schema's own existing
-- convention for every other "child row references a specific row owned by
-- a specific company" relationship (0043/0050/0034/0097/0137's own
-- signatory_scopes fix):
--
--   1. create_company_invite_checked() now validates p_linked_person_id (if
--      given) actually belongs to p_company_id BEFORE inserting the invite
--      row at all - closing this at the root, the same input-validation
--      tightening the prior pass's own write-up left open as "Sarel's own
--      call". An invite naming a stranger's person_id can now never be
--      created in the first place, through the UI or through a direct RPC
--      call.
--   2. redeem_company_invite()'s own gating SELECT is now scoped by
--      `company_id = v_invite.company_id` too, matching the filter its own
--      neighbouring UPDATE already uses - belt-and-suspenders, so even a
--      row that somehow predates fix #1 (or a future caller that bypasses
--      it) can't resurrect the oracle: a cross-company linked_person_id now
--      reads as "not found" (no row, no exception) on BOTH the read and the
--      write, consistently, instead of leaking real state on the read while
--      safely no-op'ing on the write.
--
-- Verified GREEN against this migration, same scratch database, same two
-- invites replayed with the OLD function bodies swapped for these: invite
-- #1 (the already-linked stranger) now raises NOTHING and commits normally
-- (correctly reads as "not found", since the linked_person_id's company
-- never matched) - the two previously-divergent outcomes now agree, and
-- neither leaks the other company's real linked-status.
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
  v_person_company uuid;
begin
  if not tt_is_company_admin(p_company_id) then
    raise exception 'Only an owner or admin of this company can create invites.';
  end if;

  -- 2026-11-09: reject up front if p_linked_person_id names a person who
  -- isn't actually on THIS company's own roster - the same cross-tenant
  -- integrity check every other "references a row owned by a specific
  -- company" column in this schema already has (0043/0050/0034/0097/0137).
  if p_linked_person_id is not null then
    select company_id into v_person_company from people where id = p_linked_person_id;
    if v_person_company is null or v_person_company <> p_company_id then
      raise exception 'company_invites: linked_person_id must be a person in the same company' using errcode = '23514';
    end if;
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
  'Creates a company_invites row after checking the caller is an owner/admin (tt_is_company_admin, 0050), that p_linked_person_id (if given) belongs to p_company_id (2026-11-09 - rejects a cross-company person_id before insert), and the company''s seat cap (company_subscriptions.max_users, 0083) is not already met by members + pending invites. Locks the subscription row (for update, 2026-11-04) for the duration so two concurrent invites for the same company can''t both slip past the seat check. invited_by is always auth.uid(), never a parameter, the same "never trust a caller-supplied identity" pattern as redeem_company_invite() (0077/0107).';

-- redeem_company_invite(): identical to 0122's body except the gating
-- SELECT below is now scoped by company_id too, matching its own
-- neighbouring UPDATE - belt-and-suspenders alongside the fix above, so a
-- cross-company linked_person_id (however it got there) can't leak another
-- company's real linked-status through this function's exception path.
create or replace function redeem_company_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite company_invites;
  v_uid uuid := auth.uid();
  v_person_owner uuid;
  v_existing_company uuid;
begin
  if v_uid is null then
    raise exception 'Sign in before accepting this invite.';
  end if;

  -- for update (0107): locks this row for the rest of the transaction, so
  -- a second concurrent redemption of the same token blocks here until
  -- this one commits or rolls back, instead of racing it to the
  -- accepted_at check below.
  select * into v_invite from company_invites where token = p_token for update;
  if v_invite.id is null then
    raise exception 'This invite link is not valid.';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'This invite has already been used.';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'This invite has expired. Ask whoever sent it for a new one.';
  end if;

  -- 2026-11-04 (0116): a user already in a DIFFERENT company can't also
  -- join this one - company_members_user_id_key would now reject the
  -- insert below anyway; this just turns that into a clear message
  -- instead of a raw constraint-violation string.
  select company_id into v_existing_company from company_members where user_id = v_uid;
  if v_existing_company is not null and v_existing_company <> v_invite.company_id then
    raise exception 'You already belong to a different company - sign out and accept this invite from a new account, or ask an owner there to remove you first.' using errcode = 'P0004';
  end if;

  -- Join the company. A user who somehow already belongs to THIS one
  -- (re-opens an old link, or was separately added in the meantime) has
  -- their role updated to the one this invite offers rather than erroring -
  -- redeeming a valid invite should never dead-end on "you're already in",
  -- and the inviter clearly intends this role for them.
  insert into company_members (company_id, user_id, role)
  values (v_invite.company_id, v_uid, v_invite.role)
  on conflict (company_id, user_id) do update set role = excluded.role;

  if v_invite.linked_person_id is not null then
    -- for update (2026-11-07, 0122): locks this people row for the rest of
    -- the transaction, so a second concurrent redemption of a DIFFERENT
    -- invite token naming the SAME linked_person_id blocks here until this
    -- one commits, then re-reads the now-current linked_user_id instead of
    -- racing it on a stale snapshot. Scoped by company_id too (2026-11-09,
    -- this migration) - matching the UPDATE right below, so a
    -- linked_person_id that doesn't actually belong to this invite's own
    -- company (should no longer be possible to create at all, per the
    -- fix above, but this function must not rely on that being the only
    -- way such a row could exist) reads as "no such person" rather than
    -- leaking whether a stranger in a different company is already linked.
    select linked_user_id into v_person_owner
    from people
    where id = v_invite.linked_person_id and company_id = v_invite.company_id
    for update;
    if v_person_owner is not null and v_person_owner <> v_uid then
      -- Don't silently steal someone else's roster link.
      raise exception 'That roster entry is already linked to a different account.';
    end if;
    update people set linked_user_id = v_uid where id = v_invite.linked_person_id and company_id = v_invite.company_id;
  end if;

  update company_invites
  set accepted_at = now(), accepted_by = v_uid
  where id = v_invite.id;

  return v_invite.company_id;
end;
$$;
comment on function redeem_company_invite(text) is
  'Redeems a company_invites token for the signed-in user: joins company_members with the invite''s role, links people.linked_user_id if the invite named a person, marks the invite accepted. The only way the token is ever looked up - never a direct table read, since the token is a bearer credential. Locks the invite row (for update, 0107) for the duration of the redemption so two concurrent redemptions of the same single-use token can''t both succeed. Rejects (0116) a user who already belongs to a DIFFERENT company before the insert. Locks the linked person''s row too (for update, 2026-11-07), now also scoped by company_id (2026-11-09) to match the UPDATE beside it, so two concurrent redemptions of DIFFERENT invite tokens naming the same linked_person_id can''t silently race each other for ownership of that roster link, and a cross-company linked_person_id can''t leak another company''s real linked-status via the exception path.';
revoke all on function redeem_company_invite(text) from public;
grant execute on function redeem_company_invite(text) to authenticated;
