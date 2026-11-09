-- Close a cross-tenant reference gap on savings_counted_steps (0085), the
-- same tt_same_company tender-visibility bug class the cross-tenant-
-- integrity audit (0043) established and narrative_documents's own retrofit
-- (0097) already fixed once - savings_counted_steps is a second sibling that
-- bug class never reached, found by widening the standing review's own
-- "every table with both a company_id and a tender_id column" cross-check
-- past the single table (pack_review_confirmations) the prior pass found.
--
-- 0085's own header comment is explicit about the semantics this fix
-- depends on: "A tender can be shared/unowned..., so company_id is
-- captured explicitly here rather than inferred by joining through
-- tenders - the company that actually did the work". That's exactly what
-- tt_tender_visible_to(tender_id, company_id) already enforces for every
-- other *_tender_id-bearing tenant table - "the company recording this row
-- must actually be able to see the tender", whether that's because the
-- tender is shared/unowned or because it's that company's own private one.
-- savings_counted_steps was simply never added to that check: its own RLS
-- policy ("savings_counted_steps: tenant isolation", for all, using/with
-- check is_company_member(company_id)) only ever looks at company_id - it
-- has no opinion on tender_id at all, and no tt_same_company trigger was
-- ever attached to this table either (0085 predates 0097 and was never
-- revisited).
--
-- Reproduced live before fixing, not assumed: replayed every migration
-- (0001-0138, the real current PR backlog's highest claimed number, so this
-- doesn't collide with that work) onto a scratch Postgres. Seeded company A
-- and company B's own PRIVATE manual tender (owner_company_id = B). As a
-- real signed-in member of A (role authenticated, auth.uid() set, not a
-- superuser bypassing RLS):
--   * baseline: `select count(*) from tenders where id = <B's private
--     tender>` -> 0 rows - genuinely invisible to A, confirming the setup.
--   * `insert into savings_counted_steps (company_id, tender_id, step_key,
--     hours) values (<A>, <B's private tender>, 'pack_generated', 2)` ->
--     SUCCEEDED, and a follow-up select as A confirmed the row landed (1
--     row) - A can record a "step completed" entry for a tender it has
--     zero real relationship with and cannot otherwise even see exists.
--   * the identical shape against tender_comments (already tt_same_company-
--     protected) -> correctly refused, 42501, "this tender is another
--     company's private tender" - proving this gap is specific to this one
--     table, not a general hole in the probe itself.
--   * the same insert against a tender_id that doesn't exist at all ->
--     failed differently, 23503 FK violation on savings_counted_steps_
--     tender_id_fkey - a live, usable existence oracle: a value picked for
--     company_id = A's own id and an attacker-chosen tender_id lets anyone
--     who can reach recordSavingsStep()'s own RLS boundary (the real
--     Supabase anon/authenticated key, exactly as exposed to every signed-
--     in browser session, not a privileged credential) distinguish "this
--     tender id is real but private" (42501 is never raised - it just
--     succeeds) from "this id doesn't exist at all" (23503), with zero
--     other access to `tenders`. Same existence-oracle shape Finding 276
--     already established for pack_review_confirmations.
--
-- Impact, honestly scoped - same bracket as 0097/Finding 276, narrower
-- still: savings_counted_steps stores no tender details at all (just
-- tender_id, step_key, a snapshot hours figure), is read only by this
-- company's own RLS-scoped dashboard aggregation
-- (lib/savingsCounterData.ts - grepped, zero other callers in app/ or
-- engine/, no service-role worker path touches it), and the aggregation it
-- feeds is already scoped to the caller's own company_id regardless of
-- tender_id's validity - a company can already inflate its own displayed
-- "hours saved" by calling recordSavingsStep() with any step_key for any
-- tender it can already see, so this gap's own incremental effect is
-- narrow: the existence oracle above, plus letting a company fabricate a
-- savings-counter row keyed to a specific stranger's private tender id
-- (polluting its own historical breakdown with a tender_id it has no real
-- claim to, confirmable only by the company itself, since RLS still scopes
-- every read to company_id). Not a data-exfiltration or pack-generation
-- bypass - still a genuine, live-confirmed tenant-isolation gap and
-- existence oracle, the most severe standing class per this track's own
-- guardrail, so opened as a PR, not pushed directly.
--
-- Fix: the exact same mechanism 0097/0125 already established - add
-- savings_counted_steps to tt_check_same_company()'s tender-visibility
-- branch and attach the matching trigger on (company_id, tender_id), the
-- only two columns this table needs guarded (no person_id/tender_pack_id
-- reference here to also cover). Re-verified against the same replayed-
-- plus-fix database: the identical insert from above now fails with
-- "savings_counted_steps: this tender is another company's private
-- tender" (42501), which also collapses the existence oracle, since the
-- trigger's own check now runs before the FK constraint would - both
-- failure modes are now indistinguishable 42501s. Confirmed the fix
-- doesn't over-block the real feature: recording a step for a SHARED
-- tender, and for the company's OWN private tender, both still succeed.
--
-- NOTE for whoever next merges this alongside PR #203 (Finding 276, same
-- function, pack_review_confirmations, migration 0125 on that branch, not
-- yet merged to main): this migration deliberately does NOT reuse the
-- already-collided migration number 0125 (claimed by five other open PR
-- branches - #186/#197/#198/#201/#203, a standing, already-flagged
-- numbering problem this doesn't add a sixth instance of) and intentionally
-- picks up from 0138, the highest migration number any currently open PR
-- branch claims (PR #200). Whichever of PR #203 and this PR merges second
-- will still need to rebase and re-run tt_check_same_company()'s own
-- `create or replace function` once more on top of the first one's new
-- body (standard, already-established practice for this function - 0065,
-- 0066 and 0097 each already did exactly this) so that both
-- pack_review_confirmations AND savings_counted_steps end up listed
-- together in the one, final function body.
create or replace function tt_check_same_company()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
begin
  if tg_table_name = 'tender_pack_assignments' then
    v_company := tt_pack_company(new.tender_pack_id);
    if tg_op = 'INSERT' or new.tender_pack_id is distinct from old.tender_pack_id
       or new.suggested_person_id is distinct from old.suggested_person_id then
      if not tt_person_in_company(new.suggested_person_id, v_company) then
        raise exception 'tender_pack_assignments: the person must belong to the same company as the tender pack'
          using errcode = '23514';
      end if;
    end if;
    if tg_op = 'INSERT' or new.tender_pack_id is distinct from old.tender_pack_id
       or new.confirmed_person_id is distinct from old.confirmed_person_id then
      if not tt_person_in_company(new.confirmed_person_id, v_company) then
        raise exception 'tender_pack_assignments: the person must belong to the same company as the tender pack'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  v_company := new.company_id;

  if tg_table_name in ('projects', 'cv_uploads', 'generated_cvs', 'cv_extraction_results', 'person_role_eligibility') then
    if not tt_person_in_company(new.person_id, v_company) then
      raise exception '%: person_id must be a person in the same company', tg_table_name using errcode = '23514';
    end if;
  end if;

  if tg_table_name = 'projects' then
    if new.source_tender_pack_id is not null then
      if tt_pack_company(new.source_tender_pack_id) is distinct from v_company then
        raise exception 'projects: source_tender_pack_id must be a tender pack belonging to the same company'
          using errcode = '23514';
      end if;
    end if;
  end if;

  if tg_table_name = 'tender_tasks' then
    if not tt_person_in_company(new.assigned_to, v_company) then
      raise exception 'tender_tasks: assigned_to must be a person in the same company' using errcode = '23514';
    end if;
  end if;

  if tg_table_name = 'cv_extraction_results' then
    if not exists (select 1 from cv_uploads u where u.id = new.cv_upload_id
                   and u.company_id = v_company and u.person_id = new.person_id) then
      raise exception 'cv_extraction_results: the CV upload must be this company''s upload for this person' using errcode = '23514';
    end if;
  end if;

  if tg_table_name in ('generated_cvs', 'pack_generation_jobs') then
    if new.tender_pack_id is not null then
      if not exists (select 1 from tender_packs tp where tp.id = new.tender_pack_id
                     and tp.company_id = v_company and tp.tender_id = new.tender_id) then
        raise exception '%: tender_pack_id must be this company''s pack for this tender', tg_table_name using errcode = '23514';
      end if;
    end if;
  end if;

  if tg_table_name in ('tender_packs', 'tender_tasks', 'tender_answers', 'financial_captures', 'generated_documents',
                       'generated_cvs', 'pack_generation_jobs', 'tender_comments', 'tender_private_documents',
                       'narrative_documents', 'savings_counted_steps') then
    if not tt_tender_visible_to(new.tender_id, v_company) then
      raise exception '%: this tender is another company''s private tender', tg_table_name using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger tt_same_company before insert or update of company_id, tender_id on savings_counted_steps
  for each row execute function tt_check_same_company();
