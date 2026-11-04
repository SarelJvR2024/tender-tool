-- Standing review finding, 2026-11-04: app/app/company/team/actions.ts's
-- setMemberRole() and removeMember() both enforce "the company must always
-- have at least one owner" by counting owners, THEN updating/deleting -
-- three plain client-side queries with no lock between the count and the
-- write. Same shape as createInvite()'s own seat-limit race, already fixed
-- this way in 0113.
--
-- Reproduced directly in a disposable scratch database (not this app's live
-- DB): a company with exactly 2 owners; two concurrent sessions each running
-- removeMember()'s old shape (count owners, check > 1, delete) for a
-- DIFFERENT owner each. Both read owner_count=2 (comfortably > 1) before
-- either committed, both deleted - company_members ended with ZERO owners,
-- a real lockout (nobody left who can invite, change roles, or remove
-- anyone - requireCompanyAdmin() needs role owner/admin on every one of
-- these actions). The identical race applies to setMemberRole() demoting
-- two different owners at once.
--
-- Fixed the same way as 0113: move the whole check-then-write into one
-- SECURITY DEFINER function per action, locking company_subscriptions'
-- row (`for update`) for the company for the duration, so a second
-- concurrent caller for the SAME company blocks on the lock instead of
-- racing the first to the owner count. Re-ran the same concurrency test
-- against these functions: the first caller's lock makes the second block
-- until the first commits, then correctly see owner_count=1 (not > 1) and
-- raise instead of deleting/demoting - exactly one owner removed, one
-- left, never zero.
--
-- Ownership (tt_is_company_admin, 0050) and the two self-lockout guards
-- (can't change/remove your own membership) are enforced here too, not
-- just in the Server Action - both functions are granted to authenticated
-- and therefore callable directly via supabase.rpc(), not only through
-- this app's own createInvite()-style wrapper. auth.uid() is read directly
-- for the "is this the caller's own membership" check, never trusted from
-- a parameter.

create or replace function set_member_role_checked(
  p_member_id uuid, p_target_user_id uuid, p_new_role text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_current_role text;
  v_owner_count int;
begin
  if p_target_user_id = auth.uid() then
    raise exception 'You can''t change your own role - ask another owner or admin.' using errcode = 'P0005';
  end if;

  select company_id, role into v_company_id, v_current_role
    from company_members where id = p_member_id and user_id = p_target_user_id;
  if v_company_id is null then
    raise exception 'That team member wasn''t found.' using errcode = 'P0002';
  end if;

  if not tt_is_company_admin(v_company_id) then
    raise exception 'Only an owner or admin of the company can manage the team.' using errcode = 'P0001';
  end if;

  -- for update: locks this company's subscription row for the rest of the
  -- transaction (same row 0113 already locks for the seat-cap check), so a
  -- second concurrent role/removal change for the SAME company blocks here
  -- until this one commits, instead of racing it to the owner count below.
  perform 1 from company_subscriptions where company_id = v_company_id for update;

  if v_current_role = 'owner' and p_new_role <> 'owner' then
    select count(*) into v_owner_count from company_members where company_id = v_company_id and role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'The company must always have at least one owner - promote someone else to owner first.' using errcode = 'P0004';
    end if;
  end if;

  update company_members set role = p_new_role where id = p_member_id and company_id = v_company_id;
end;
$$;
revoke all on function set_member_role_checked(uuid, uuid, text) from public;
grant execute on function set_member_role_checked(uuid, uuid, text) to authenticated;
comment on function set_member_role_checked(uuid, uuid, text) is
  'Changes a company_members row''s role after checking the caller is an owner/admin (tt_is_company_admin, 0050), is not changing their own role, and - when demoting the company''s only owner - that at least one owner remains. Locks company_subscriptions (for update, 2026-11-04) for the duration so two concurrent role changes for the same company can''t both slip past the last-owner check, the same race createInvite()''s seat-cap check had (0113).';

create or replace function remove_member_checked(
  p_member_id uuid, p_target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company_id uuid;
  v_current_role text;
  v_owner_count int;
begin
  if p_target_user_id = auth.uid() then
    raise exception 'You can''t remove yourself - ask another owner or admin.' using errcode = 'P0005';
  end if;

  select company_id, role into v_company_id, v_current_role
    from company_members where id = p_member_id and user_id = p_target_user_id;
  if v_company_id is null then
    raise exception 'That team member wasn''t found.' using errcode = 'P0002';
  end if;

  if not tt_is_company_admin(v_company_id) then
    raise exception 'Only an owner or admin of the company can manage the team.' using errcode = 'P0001';
  end if;

  -- for update: see set_member_role_checked() above - same per-company lock.
  perform 1 from company_subscriptions where company_id = v_company_id for update;

  if v_current_role = 'owner' then
    select count(*) into v_owner_count from company_members where company_id = v_company_id and role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'The company must always have at least one owner - promote someone else to owner before removing this one.' using errcode = 'P0004';
    end if;
  end if;

  delete from company_members where id = p_member_id and company_id = v_company_id;
end;
$$;
revoke all on function remove_member_checked(uuid, uuid) from public;
grant execute on function remove_member_checked(uuid, uuid) to authenticated;
comment on function remove_member_checked(uuid, uuid) is
  'Removes a company_members row after checking the caller is an owner/admin (tt_is_company_admin, 0050), is not removing themselves, and - when removing the company''s only owner - that at least one owner remains. Locks company_subscriptions (for update, 2026-11-04) for the duration so two concurrent removals for the same company can''t both slip past the last-owner check, the same race createInvite()''s seat-cap check had (0113).';
