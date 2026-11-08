-- Standing review finding, 2026-11-08 (fresh-angle sweep: quota/"room for
-- one more" check-then-write races outside the already-fixed team-seat
-- (0113/0114) and pack-request (0115) families). company_principals' own
-- 100%-ownership cap (tt_principals_check(), 0050) has the identical TOCTOU
-- shape as those: it SELECTs sum(ownership_pct) across this company's other
-- principals, compares the new row's own share against the 100% cap, then
-- lets the insert/update through - all with no lock between the read and
-- the write. Two concurrent inserts/updates for the SAME company (two team
-- members adding shareholders from different tabs at once, or one person
-- double-clicking "Save" on a slow connection while adding themselves AND a
-- co-shareholder in quick succession) each run their own SELECT before
-- either commits, so both can see the SAME pre-insert total, both pass the
-- "doesn't exceed 100%" check, and both commit - silently exceeding the cap
-- this trigger exists specifically to enforce. Unlike the pack/seat cases,
-- this one isn't billing-critical, but company_principals.ownership_pct is
-- the real input to this company's own specific-goals ownership breakdown
-- (see 0050's own company_specific_goals_ownership view) - the number a
-- B-BBEE/tender submission ultimately quotes, so a silently-impossible
-- >100% total is a real data-integrity defect in exactly the field this
-- table's one real invariant (and this project's own B-BBEE domain) cares
-- about, not a cosmetic one.
--
-- Reproduced directly in a disposable scratch database (never this app's
-- live DB; replayed all 113 migrations through 0123 via
-- engine/security/replay_schema.sh): one company, zero existing principals.
-- Rather than overwrite the real trigger function (which would need
-- restoring), swapped in a throwaway copy with a pg_sleep(2) inserted right
-- after the sum SELECT - the identical widening technique 0121's own
-- migration comment already used for its own demo, to make the real,
-- normally microsecond-scale race window reliably observable; no logic
-- changed. Two concurrent inserts for the SAME company - "Shareholder A"
-- and "Shareholder B", 60% each (each individually well under the 100% cap,
-- together 120%) - both succeeded, no error either side. Final state:
-- sum(ownership_pct) for the company = 120.000, more than 100% - exactly
-- the state tt_principals_check() exists to make impossible. Re-ran the
-- SAME two concurrent inserts (same timing, same starting state) against
-- this migration's fixed body (identical pg_sleep(2) widening, now placed
-- after the lock acquisition rather than the read): the second call blocks
-- on the lock until the first commits, then correctly sees the first
-- call's already-committed 60% before checking its own, and is refused
-- ("shareholdings would add up to 120.000 % - more than 100 %") - exactly
-- one of the two survives, matching the cap.
--
-- Fix, same pattern as 0107/0113/0114/0115/0121: `for update` on this
-- company's own row in `companies` (a plain existence/lock read, not used
-- for any value) before computing the sum, so a second concurrent
-- insert/update for the SAME company blocks on that lock until the first
-- commits or rolls back, instead of racing it to the sum. All three
-- existing checks (person_id same-company, the 100% cap, updated_at) are
-- otherwise byte-for-byte unchanged from 0050's own body.
create or replace function tt_principals_check()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_total numeric;
begin
  if new.person_id is not null and not exists (
    select 1 from people where id = new.person_id and company_id = new.company_id
  ) then
    raise exception 'company_principals: person_id must be a person in the same company' using errcode = '23514';
  end if;

  -- Locks this company's own row for the rest of the transaction, so a
  -- second concurrent insert/update for the SAME company blocks here until
  -- this one commits, instead of racing it to the sum below (see this
  -- migration's own header comment for the reproduced race and fix shape).
  perform 1 from companies where id = new.company_id for update;

  select coalesce(sum(ownership_pct), 0) into v_total
  from company_principals
  where company_id = new.company_id and id <> new.id;
  if v_total + coalesce(new.ownership_pct, 0) > 100.0005 then
    raise exception 'company_principals: shareholdings would add up to % %% - more than 100 %%',
      round(v_total + coalesce(new.ownership_pct, 0), 3) using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
comment on function tt_principals_check() is
  'BEFORE INSERT OR UPDATE trigger on company_principals (0050): refuses a person_id in another company, and refuses a shareholding total over 100% for the company. Locks the company''s own row (for update, 0124) before summing existing shareholdings, so two concurrent writes for the same company can''t both pass the 100% check against the same pre-write total - the same TOCTOU shape 0107/0113/0114/0115/0121 already closed elsewhere, reproduced live for this function (two concurrent 60% inserts both succeeding, 120% total) before this fix.';
