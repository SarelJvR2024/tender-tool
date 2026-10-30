-- Standing review finding, 2026-10-30: redeem_company_invite() (0077) read
-- company_invites with a plain `select ... where token = p_token`, no
-- `for update` - so two concurrent redemptions of the SAME single-use token
-- (two different signed-in accounts opening the same /invite/<token> link at
-- close to the same instant - a genuinely plausible real scenario: a link
-- shared in a WhatsApp/Slack channel instead of to one named person, or two
-- tabs on a slow connection) could both SELECT the row while accepted_at was
-- still null, both pass the "already used" check, and both successfully
-- join company_members with the invite's role before either's own UPDATE
-- marking it accepted had committed. The invite row only has one
-- accepted_by column, so the second writer's update silently overwrote the
-- first's - the audit trail ends up naming only the second account, even
-- though both are now real members.
--
-- Reproduced directly in a disposable scratch database (not this app's
-- live DB): a minimal copy of this function's exact select-then-sleep-then-
-- insert/update shape, invoked by two concurrent psql sessions against the
-- same token, left BOTH callers' user ids in company_members. Adding
-- `for update` to the initial select and re-running the same two-session
-- test left exactly one caller in company_members; the second blocked on
-- the row lock until the first committed, then correctly raised "This
-- invite has already been used."
--
-- Fixed the real function the same way: `for update` on the select. No
-- other behavior changes - every existing check, the re-join-with-updated-
-- role path, and the linked_person_id guard are all unchanged, verbatim
-- from 0077. create or replace function, not alter - the same pattern this
-- repo already uses to replace a function body whole (0105/0106 and
-- others).

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
begin
  -- Caller must be signed in. The calling Server Action is responsible for
  -- sending a signed-out visitor to /login?next=/invite/<token> first - this
  -- function only ever runs as an authenticated role, so it raises rather
  -- than silently doing nothing if that ever isn't true.
  if v_uid is null then
    raise exception 'Sign in before accepting this invite.';
  end if;

  -- for update (0107): locks this row for the rest of the transaction, so a
  -- second concurrent redemption of the same token blocks here until this
  -- one commits or rolls back, instead of racing it to the accepted_at
  -- check below.
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

  -- Join the company. A user who somehow already belongs (re-opens an old
  -- link, or was separately added in the meantime) has their role updated
  -- to the one this invite offers rather than erroring - redeeming a valid
  -- invite should never dead-end on "you're already in", and the inviter
  -- clearly intends this role for them.
  insert into company_members (company_id, user_id, role)
  values (v_invite.company_id, v_uid, v_invite.role)
  on conflict (company_id, user_id) do update set role = excluded.role;

  if v_invite.linked_person_id is not null then
    select linked_user_id into v_person_owner from people where id = v_invite.linked_person_id;
    if v_person_owner is not null and v_person_owner <> v_uid then
      -- Don't silently steal someone else's roster link - this would only
      -- happen if the same person row were pointed at by two accepted
      -- invites, which createInvite's own form doesn't offer, but the
      -- function stays safe against it regardless.
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
  'Redeems a company_invites token for the signed-in user: joins company_members with the invite''s role, links people.linked_user_id if the invite named a person, marks the invite accepted. The only way the token is ever looked up - never a direct table read, since the token is a bearer credential. Locks the invite row (for update, 0107) for the duration of the redemption so two concurrent redemptions of the same single-use token can''t both succeed.';
revoke all on function redeem_company_invite(text) from public;
grant execute on function redeem_company_invite(text) to authenticated;
