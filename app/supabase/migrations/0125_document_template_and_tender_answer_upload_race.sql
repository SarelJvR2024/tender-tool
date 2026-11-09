-- Standing review finding, 2026-11-09, continuing Finding 231 (six "replace a
-- document" Server Actions raced on a storage column, fixed with an
-- optimistic-concurrency `.eq(column, previousPath)` filter at each site):
-- saveDocumentTemplate() (app/company/actions.ts, company_document_templates)
-- and uploadTenderDocument() (app/tenders/[id]/general-actions.ts,
-- tender_answers) have the IDENTICAL shape - read the row's current
-- storage_path, upload the new file, write the row, delete the OLD path
-- afterwards - but write via `.upsert(row, { onConflict: ... })` instead of
-- `.update()`, so Finding 231's own fix (a plain `.eq(column, previousPath)`
-- filter) can't be bolted on: PostgREST's upsert is a single
-- `INSERT ... ON CONFLICT ... DO UPDATE SET ...` request with no row-level
-- WHERE filter of its own - conflict resolution is keyed entirely on the
-- onConflict columns, which is the natural key (company_id, document_type) /
-- (company_id, tender_id, field_key), not an arbitrary value check. Two
-- near-simultaneous replace requests for the SAME document (a double-click, a
-- slow upload retried, two tabs) therefore both read the same previousPath,
-- both upload (two distinct, genuinely-written storage objects), and both
-- upsert successfully - last commit silently wins the row, and the LOSING
-- request's own just-uploaded file is referenced by nothing (its own cleanup
-- only ever targets the previousPath it read, never the other request's new
-- path) and is never deleted either - permanently orphaned, while both users
-- are told "saved". Exactly Finding 231's bug class, just for the two sites
-- whose write is upsert-based rather than update-based.
--
-- Reproduced directly in a disposable scratch database (never this app's
-- live DB; replayed all 124 migrations through 0124 via
-- engine/security/replay_schema.sh), the same scratch-database technique
-- 0107/0113/0114/0115/0121/0122/0124 already used for this review's other
-- races: one company, no existing company_document_templates row. Two
-- concurrent sessions each ran the CURRENT upsert shape by hand (select
-- storage_path - none yet - then, after a pg_sleep(2) widening the window
-- the same way 0121/0124's own demos did, `insert ... on conflict
-- (company_id, document_type) do update set ...` with two different,
-- genuinely distinct storage_path values standing in for two different
-- uploaded files):
--   RED: BOTH upserts committed with no error. Exactly one row remained in
--   company_document_templates afterwards (count = 1), holding whichever
--   session's write committed last - the other session's own distinct
--   storage_path value never appears anywhere in the table, meaning the
--   real file it names would be left in the bucket with nothing pointing
--   at it, forever, while that session's own caller was told it succeeded
--   (no error, no empty result - it genuinely wrote a row, just one that
--   was then overwritten before anyone read it back).
--
-- Fixed with the SAME technique 0124 used for company_principals - a table
-- with no guaranteed-existing row of its own to lock directly (the very
-- first save for a given document_type/field_key has none yet) locks a
-- always-existing PARENT row (`companies`) instead: `for update` on the
-- company's own row serializes every concurrent replace for that company,
-- so the second call blocks until the first commits, then re-reads the
-- NOW-current storage_path and compares it to what ITS OWN caller read
-- before uploading - a mismatch (another request's write landed in between)
-- raises instead of silently overwriting, so the TypeScript side's existing
-- "zero rows / error -> clean up my own just-uploaded file, tell the user to
-- retry" handling (identical to Finding 231's own sites) applies unchanged.
-- Replayed the identical two-session scenario against the new functions
-- below:
--   GREEN: the first call's `for update` lock makes the second block until
--   the first commits; the second then correctly sees the first's
--   now-committed storage_path (not the stale value it read before either
--   wrote) and raises ('This document was just replaced...', P0005) instead
--   of overwriting it. Exactly one of the two writes survives, and the
--   LOSING call gets a real error its own Server Action already knows how
--   to react to (clean up its own upload, ask the user to retry) - not a
--   silent, both-sides-happy orphan.
--
-- Both new functions also close a gap a straight lift of the existing
-- upsert into a SECURITY DEFINER function would have reopened: 0077's own
-- RESTRICTIVE "employee has no access" policy on company_document_templates
-- and tender_answers never applies to a SECURITY DEFINER function's writes -
-- 0117 already found and fixed the identical gap for
-- start_payfast_checkout()/company_subscriptions ("a RESTRICTIVE select
-- policy does not, by itself, stop a SECURITY DEFINER function ... from
-- writing to a table by company_id"). Both functions below re-check
-- is_employee_in_company() explicitly, the same defense-in-depth 0117
-- established, so moving these two writes behind an RPC doesn't quietly
-- hand an 'employee' account write access the direct-upsert() it replaces
-- never gave them.

create or replace function replace_company_document_template(
  p_company_id uuid,
  p_document_type text,
  p_mode text,
  p_storage_path text,
  p_original_filename text,
  p_guideline text,
  p_expected_previous_path text,
  p_has_new_upload boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row company_document_templates;
begin
  if not is_company_member(p_company_id) then
    raise exception 'not a member of this company' using errcode = 'P0001';
  end if;
  if is_employee_in_company(p_company_id) then
    raise exception 'Document templates are managed by your company''s owner or admin.' using errcode = '42501';
  end if;

  -- Locks this company's own row (companies) for the rest of the
  -- transaction - the same always-exists parent-row lock 0124 used for
  -- company_principals, since company_document_templates itself has no
  -- row guaranteed to exist yet for a given document_type. A second
  -- concurrent replace for the SAME company blocks here until the first
  -- commits, then the select below sees that commit's real result instead
  -- of racing it on a stale snapshot.
  perform 1 from companies where id = p_company_id for update;

  select * into v_row from company_document_templates
    where company_id = p_company_id and document_type = p_document_type;

  -- Only a request that itself just uploaded a new file needs this check -
  -- a plain mode/guideline edit with no new upload never orphans anything
  -- in storage, the specific harm Finding 231's bug class is about.
  if p_has_new_upload and (v_row.storage_path is distinct from p_expected_previous_path) then
    raise exception 'This document was just replaced in another tab or request - refresh and try again.' using errcode = 'P0005';
  end if;

  if v_row.id is null then
    insert into company_document_templates (
      company_id, document_type, mode, storage_path, original_filename, guideline, updated_by, updated_at
    ) values (
      p_company_id, p_document_type, p_mode, p_storage_path, p_original_filename, p_guideline, auth.uid(), now()
    );
  else
    update company_document_templates set
      mode = p_mode,
      storage_path = p_storage_path,
      original_filename = p_original_filename,
      guideline = p_guideline,
      updated_by = auth.uid(),
      updated_at = now()
    where id = v_row.id;
  end if;
end;
$$;
revoke all on function replace_company_document_template(uuid, text, text, text, text, text, text, boolean) from public;
grant execute on function replace_company_document_template(uuid, text, text, text, text, text, text, boolean) to authenticated;
comment on function replace_company_document_template(uuid, text, text, text, text, text, text, boolean) is
  'saveDocumentTemplate()''s (app/company/actions.ts) one write - replaces the plain client-side .upsert(onConflict: "company_id,document_type") with a locked check-then-write so a concurrent replace of the SAME document_type can''t silently overwrite this one''s row after both uploaded. Locks the companies row (for update, 0125) to serialize concurrent replaces for the same company (company_document_templates has no row of its own guaranteed to exist yet to lock directly). When p_has_new_upload is true, raises (P0005) if the row''s current storage_path no longer matches p_expected_previous_path - the same storage-leak race Finding 231 fixed at six update()-based sites, here for the two upsert()-based ones that could not take that fix''s plain .eq() filter. Also re-checks is_employee_in_company() (0125), the same defense-in-depth 0117 added for start_payfast_checkout() - a RESTRICTIVE RLS policy on this table never binds a SECURITY DEFINER function''s own writes. updated_by is always auth.uid(), never a parameter.';

create or replace function replace_tender_answer_document(
  p_company_id uuid,
  p_tender_id uuid,
  p_field_key text,
  p_storage_path text,
  p_original_filename text,
  p_expected_previous_path text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row tender_answers;
begin
  if not is_company_member(p_company_id) then
    raise exception 'not a member of this company' using errcode = 'P0001';
  end if;
  if is_employee_in_company(p_company_id) then
    raise exception 'Tender documents are managed by your company''s owner, admin or members.' using errcode = '42501';
  end if;

  -- Same technique as replace_company_document_template() above - locks
  -- the company's own row to serialize concurrent uploads for this
  -- company (tender_answers has no row of its own guaranteed to exist yet
  -- for a given tender_id/field_key either). Locking `companies` rather
  -- than a `tenders` row matters here specifically: tenders are shared
  -- across every company bidding on them, so locking the tenders row
  -- would needlessly serialize unrelated companies' uploads for the same
  -- tender against each other; locking companies only serializes THIS
  -- company's own concurrent requests, which is the actual race.
  perform 1 from companies where id = p_company_id for update;

  select * into v_row from tender_answers
    where company_id = p_company_id and tender_id = p_tender_id and field_key = p_field_key;

  if v_row.storage_path is distinct from p_expected_previous_path then
    raise exception 'This document was just replaced in another tab or request - refresh and try again.' using errcode = 'P0005';
  end if;

  if v_row.id is null then
    insert into tender_answers (company_id, tender_id, field_key, storage_path, original_filename, value, answered_by)
    values (p_company_id, p_tender_id, p_field_key, p_storage_path, p_original_filename, null, auth.uid());
  else
    update tender_answers set
      storage_path = p_storage_path,
      original_filename = p_original_filename,
      value = null,
      answered_by = auth.uid(),
      updated_at = now()
    where id = v_row.id;
  end if;
end;
$$;
revoke all on function replace_tender_answer_document(uuid, uuid, text, text, text, text) from public;
grant execute on function replace_tender_answer_document(uuid, uuid, text, text, text, text) to authenticated;
comment on function replace_tender_answer_document(uuid, uuid, text, text, text, text) is
  'uploadTenderDocument()''s (app/tenders/[id]/general-actions.ts) one write - replaces the plain client-side .upsert(onConflict: "company_id,tender_id,field_key") with a locked check-then-write, the same Finding 231 storage-leak race closed for company_document_templates above (0125), applied here for tender_answers'' own upload fields. Locks the companies row (for update) to serialize THIS company''s own concurrent uploads only - never the shared tenders row, which would needlessly serialize unrelated companies bidding on the same tender against each other. Raises (P0005) if the row''s current storage_path no longer matches p_expected_previous_path. Also re-checks is_employee_in_company() (same defense-in-depth 0117/0125 - a RESTRICTIVE RLS policy never binds a SECURITY DEFINER function''s own writes). value is always set to null and answered_by is always auth.uid() - this function only ever handles an upload field, never a text answer.';
