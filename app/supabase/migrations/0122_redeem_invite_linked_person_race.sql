-- Standing review finding, 2026-11-07: redeem_company_invite() (0077, with
-- the invite-token lock added by 0107 and the one-company-per-user guard
-- added by 0116) reads the roster row it will link
-- (`select linked_user_id into v_person_owner from people where id =
-- v_invite.linked_person_id`) with NO lock, uses it to gate a
-- `raise exception 'That roster entry is already linked to a different
-- account.'` check, then does a SEPARATE, unconditional
-- `update people set linked_user_id = v_uid ...` that never re-verifies the
-- gate's condition still holds at write time - the exact
-- scalar-read/conditional-raise/unconditional-write TOCTOU shape
-- `record_tender_document()` (0043) once had before 0045 closed it, found
-- by re-running this review's own tracing of that shape against every
-- OTHER currently-shipping SECURITY DEFINER function.
--
-- The function's own existing comment already names the scenario ("this
-- would only happen if the same person row were pointed at by two accepted
-- invites") and claims to "stay safe against it regardless" - true only
-- for the SEQUENTIAL case (one invite already accepted before the second
-- is opened). It is not true for the CONCURRENT case, and nothing in this
-- app or its schema stops two invites pointing at the same
-- linked_person_id from existing at once: createInvite()/
-- create_company_invite_checked() (0113) only checks the plan's seat cap,
-- never whether the person already has a pending invite - a double-submit
-- on "Send invite" (the exact double-click scenario 0113's and 0114's own
-- header comments already name for the sibling TOCTOU races they fixed),
-- or an admin deliberately re-inviting the same roster entry after a first
-- link seemingly went nowhere, both leave two live, independently-valid
-- tokens for the same person. If two different real accounts then redeem
-- those two different tokens at close to the same instant, both can read
-- the stale "nobody owns this yet" value before either's own UPDATE
-- commits.
--
-- Reproduced directly in a disposable scratch database (never this app's
-- live DB), replaying the real app/supabase/migrations/*.sql schema via
-- engine/security/replay_schema.sh, not a reduced fixture: one person row,
-- two company_invites rows both with linked_person_id pointing at it, two
-- concurrent redeem_company_invite() calls from two different auth
-- accounts naming the two different tokens. Run twice over against a
-- scratch-only copy of the CURRENT (0116) function body widened with a
-- `pg_sleep()` between the unlocked select and the later update (the same
-- widening technique 0121 used for Finding 178) to make the race land
-- reliably instead of depending on sub-millisecond timing:
--   - RED (both runs): neither call raised - both invites ended up
--     accepted_at/accepted_by set to their OWN real user, both got a real
--     company_members row, but people.linked_user_id silently ended up
--     pointing at only ONE of the two accounts (non-deterministic which -
--     run 1 kept the first caller's write, run 2 kept the second's). The
--     losing side's own invite record disagreed with the actual roster
--     link - accepted_by named one account, linked_user_id named the
--     other - with zero error raised on either side.
--   - GREEN (both runs, after adding `for update` to the people select
--     below): exactly one call succeeded fully (invite accepted, person
--     linked, company_members row inserted); the other blocked on the row
--     lock until the first committed, then correctly re-read the
--     now-current linked_user_id and raised 'That roster entry is already
--     linked to a different account.' - its whole transaction (including
--     its own earlier company_members insert) rolled back atomically, so
--     no half-joined, inconsistent state was left behind either. Which
--     side won varied between the two GREEN runs (same as the two REDs),
--     confirming the fix removes the race rather than just reordering it.
--
-- Fixed the same way as every other instance of this review's two named
-- bug classes in this exact function already (0107's invite-row lock,
-- 0116's seat-cap lock elsewhere): `for update` on the read that feeds the
-- gate. No other behavior changes - every existing check and the
-- re-join-with-updated-role path are unchanged, verbatim from 0116.
-- create or replace function, not alter - this file's own predecessors
-- (0107/0116) already used the same whole-body-replace pattern.
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
    -- for update (2026-11-07, this migration): locks this people row for
    -- the rest of the transaction, so a second concurrent redemption of a
    -- DIFFERENT invite token naming the SAME linked_person_id blocks here
    -- until this one commits, then re-reads the now-current
    -- linked_user_id instead of racing it on a stale snapshot.
    select linked_user_id into v_person_owner from people where id = v_invite.linked_person_id for update;
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
  'Redeems a company_invites token for the signed-in user: joins company_members with the invite''s role, links people.linked_user_id if the invite named a person, marks the invite accepted. The only way the token is ever looked up - never a direct table read, since the token is a bearer credential. Locks the invite row (for update, 0107) for the duration of the redemption so two concurrent redemptions of the same single-use token can''t both succeed. Rejects (0116) a user who already belongs to a DIFFERENT company before the insert. Locks the linked person''s row too (for update, 2026-11-07) so two concurrent redemptions of DIFFERENT invite tokens naming the same linked_person_id can''t silently race each other for ownership of that roster link.';
revoke all on function redeem_company_invite(text) from public;
grant execute on function redeem_company_invite(text) to authenticated;
