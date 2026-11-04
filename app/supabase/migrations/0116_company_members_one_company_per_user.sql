-- Standing review finding, 2026-11-04: create_company_and_join() (0003) checks
-- "does this user already belong to a company" and inserts the new
-- company_members row as two separate steps in the same function, with
-- nothing locking between them - a check-then-insert race, the same shape
-- this session has already found and fixed three times (0113/0114/0115),
-- just with no existing row to lock on here (there's no company yet for a
-- brand-new user).
--
-- Reproduced directly in a disposable scratch database (never the live DB):
-- a single new auth.users row, two concurrent create_company_and_join()
-- calls for that SAME user (modelling a double-click on Screen 1's submit
-- button, or a slow-network retry) - both read "no membership yet" before
-- either committed, both inserted. Result: one user, two real companies,
-- two company_members rows, both role='owner'.
--
-- This is worse than the other three TOCTOU races: company_members has no
-- unique constraint on user_id alone (only the composite
-- unique(company_id, user_id) from 0001), so nothing in the schema stops
-- it, and EVERY page that reads a user's own company - AppShell, /billing,
-- /experience, /my-cv, /onboarding itself, company/officeActions.ts - calls
-- `.eq("user_id", ...).maybeSingle()`. PostgREST's .maybeSingle() errors
-- (not "returns one of them") the moment more than one row matches, so a
-- user caught by this race would get a hard error on every single page in
-- the app from then on, not just onboarding.
--
-- Fixed with a straightforward unique constraint, not a SECURITY DEFINER
-- rewrite like 0113/0114/0115 - the table's own comment (0001) already
-- states "v1 has one company" per the product, and every call site above
-- already hard-assumes exactly one row per user_id, so this formalizes an
-- invariant the whole app already depends on rather than introducing a new
-- one. A concurrent second insert for the same user_id now blocks on the
-- unique index until the first commits, then fails with a 23505 (unique
-- violation) instead of succeeding - caught generically by
-- createCompanyBasics()'s existing `if (error)` branch exactly the same way
-- any other create_company_and_join() failure already is ("Could not create
-- your company - try again"). Because the whole insert runs inside one
-- PL/pgSQL function, the failed transaction rolls back BOTH inserts
-- (companies and company_members) together - no orphaned, member-less
-- company row is left behind by the losing call.
--
-- Re-ran the identical two-concurrent-calls scenario against this
-- constraint: the first call succeeds as before; the second blocks on the
-- unique index, then raises `duplicate key value violates unique
-- constraint "company_members_user_id_key"` instead of inserting - exactly
-- one company_members row for the user, not two.
alter table company_members
  add constraint company_members_user_id_key unique (user_id);

-- redeem_company_invite() (0107) has the same "join a second company" path
-- this new constraint now blocks: a user who already belongs to company A
-- accepting an invite to company B. Before this constraint, that insert
-- silently succeeded as a second company_members row - which the entire
-- app's own `.eq("user_id", ...).maybeSingle()` convention (AppShell,
-- /billing, /experience, /my-cv, /onboarding, company/officeActions.ts)
-- could never actually have supported, so it was already a live landmine,
-- just a different one than the race above. Re-created here with one added
-- check before the insert, so the user gets a clear, friendly rejection
-- (matching this function's own existing error style) instead of a raw
-- "duplicate key value violates unique constraint" message leaking straight
-- to app/invite/actions.ts's acceptInvite(), which redirects with
-- error.message shown as-is. Redeeming an invite for the SAME company
-- (re-opening an old link, a role change) is unaffected - still the
-- existing on-conflict-update-role path below, unchanged.
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

  -- 2026-11-04: a user already in a DIFFERENT company can't also join this
  -- one - company_members_user_id_key (above) would now reject the insert
  -- below anyway; this just turns that into a clear message instead of a
  -- raw constraint-violation string.
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
  'Redeems a company_invites token for the signed-in user: joins company_members with the invite''s role, links people.linked_user_id if the invite named a person, marks the invite accepted. The only way the token is ever looked up - never a direct table read, since the token is a bearer credential. Locks the invite row (for update, 0107) for the duration of the redemption so two concurrent redemptions of the same single-use token can''t both succeed. Rejects (0116) a user who already belongs to a DIFFERENT company before the insert, with a friendly message - company_members_user_id_key (0116) would otherwise reject it anyway, but with a raw constraint-violation string.';
