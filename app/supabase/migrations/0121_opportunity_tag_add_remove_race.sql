-- Standing review finding, 2026-11-07: set_opportunity_tag() (0089) reads
-- the opportunity row ONCE into a plpgsql variable (`opp`), then, on 'add'/
-- 'remove', computes the new company_tags array with array_append()/
-- array_remove() against that in-memory SNAPSHOT rather than the row's live
-- column value, and writes that back unconditionally. Two concurrent calls
-- for the SAME opportunity (two team members on /discovery tagging the same
-- row at once, or one person double-clicking "+ add tag" before
-- OpportunityQuickActions.tsx's own optimistic UI settles, or two browser
-- tabs) each take their own snapshot before either commits, so the SECOND
-- call's UPDATE silently overwrites the FIRST call's tag with its own
-- stale-based array - exactly a lost update, and exactly the shape the last
-- several standing-review passes have found elsewhere in this app (a write
-- path silently discarding a real value on an unrelated/concurrent save),
-- just rooted in a Postgres function's own read-then-write window rather
-- than a discarded Supabase read error. set_opportunity_interest() (same
-- migration) was checked too: it sets interest_marker purely from its own
-- parameter, never from `opp`'s snapshot, so it has no equivalent race -
-- not touched here.
--
-- Reproduced directly in a disposable scratch database (never this app's
-- live DB; the guardrail on scratch Postgres use applies as always): seeded
-- one discovered_opportunities row with company_tags = '{}', then ran two
-- concurrent calls - add 'foo' and add 'bar' - against a copy of the real
-- function body with a pg_sleep() inserted right after the read (widening
-- the real race window for a deterministic demo; no logic changed). Both
-- calls returned successfully (no error either side). Final company_tags:
-- {foo} only - 'bar' vanished with no trace, no error, nothing in either
-- caller's response to say so. Re-ran the identical two concurrent calls
-- against this migration's fixed body (same pg_sleep() widening): final
-- company_tags: {foo,bar} - both survive.
--
-- Fix, same pattern as 0107's redeem_company_invite() and 0113's
-- create_company_invite_checked(): `for update` on the initial read, so a
-- second concurrent call for the SAME opportunity blocks on that row lock
-- until the first commits, then its own read sees the first call's already-
-- applied change rather than a pre-commit snapshot - no second overwrite,
-- no lost tag. The array_append/array_remove computation itself is
-- unchanged; only the read gained the lock.
create or replace function set_opportunity_tag(p_opportunity_id uuid, p_tag text, p_action text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  opp discovered_opportunities%rowtype;
  tag text;
begin
  select * into opp from discovered_opportunities where id = p_opportunity_id for update;
  if not found or not is_company_member(opp.company_id) then
    raise exception 'Discovery entry not found.';
  end if;
  if p_action not in ('add', 'remove') then
    raise exception 'Invalid action - must be add or remove.';
  end if;

  -- Same normalisation the client already applies (trim, lowercase, collapse
  -- internal whitespace) - repeated here so a direct RPC call (or a future
  -- caller that forgets to normalise) can't silently create a near-duplicate
  -- tag that only differs in case/spacing.
  tag := regexp_replace(btrim(lower(p_tag)), '\s+', ' ', 'g');
  if tag = '' then
    raise exception 'Tag cannot be empty.';
  end if;

  if p_action = 'add' then
    if not (tag = any(opp.company_tags)) then
      update discovered_opportunities set company_tags = array_append(opp.company_tags, tag) where id = p_opportunity_id;
    end if;
  else
    update discovered_opportunities set company_tags = array_remove(opp.company_tags, tag) where id = p_opportunity_id;
  end if;
end;
$$;

revoke all on function set_opportunity_tag(uuid, text, text) from public, anon;
grant execute on function set_opportunity_tag(uuid, text, text) to authenticated;
comment on function set_opportunity_tag(uuid, text, text) is
  'Adds/removes one of this company''s own free-text tags on a discovered_opportunities row (0089). Locks the row (for update, 2026-11-07) for the duration so two concurrent add/remove calls on the SAME opportunity (two team members, a double-click, two tabs) can''t silently lose one tag to the other''s stale-snapshot overwrite - the second caller now blocks on the row lock and sees the first caller''s already-applied change before computing its own.';
