-- Close a cross-tenant reference gap on pack_review_confirmations (0059),
-- the "I've reviewed this" Pack Review gate - this table was added well
-- after the cross-tenant-integrity audit (0043, docs/specs/
-- POPIA-Security-Audit.md) and was never given the tt_same_company guard
-- every other *_tender_id-bearing tenant table already has (tender_tasks,
-- tender_packs, tender_answers, financial_captures, generated_documents,
-- generated_cvs, pack_generation_jobs, tender_comments,
-- tender_private_documents, narrative_documents - the last one closed by
-- 0097 for the exact same reason this migration exists; pack_review_
-- confirmations was simply the one sibling 0097's own sweep didn't reach).
--
-- Reproduced live before fixing, not assumed: replayed every migration
-- (0001-0124) onto a scratch Postgres, seeded a PRIVATE tender owned by
-- company Beta and a company Acme with no relationship to it, then as Acme:
--   1. select on tenders for Beta's tender id - 0 rows, genuinely invisible
--      (the baseline RLS protection works as intended).
--   2. insert into pack_review_confirmations (company_id = Acme's own,
--      tender_id = Beta's invisible tender) - SUCCEEDED (is_company_member
--      (company_id) has no opinion on tender_id, so this table's own RLS
--      policy doesn't stop it, and until this migration no trigger did
--      either).
--   3. the identical shape against tender_comments (already 0043-protected)
--      - correctly refused with 42501 "this tender is another company's
--      private tender", confirming this isn't a general RLS hole, just this
--      one table.
--   4. the same insert against a tender_id that doesn't exist AT ALL failed
--      differently - 23503 FK violation, not 42501. That distinction is
--      itself a live, usable existence oracle: without this fix, any
--      signed-in company can learn whether an arbitrary tender UUID
--      corresponds to a real (if invisible/private) tender at all, purely
--      by trying to insert a pack_review_confirmations row for it and
--      reading which error code (or none) comes back - no other access to
--      the tenders table required. A private/manual tender's id is not
--      published, but it isn't a secret either (a URL, a screenshot, an old
--      e-mail is enough) - the same standing threat model 0043/0097 both
--      use. This also pollutes the table itself: an orphaned confirmation
--      row tied to a tender the inserting company has no real business with.
--
-- Fix: the exact same mechanism every sibling table already uses - add
-- pack_review_confirmations to tt_check_same_company()'s tender-visibility
-- branch and attach the trigger on (company_id, tender_id), the only two
-- columns this table needs guarded (no person_id/tender_pack_id reference
-- here to also cover, same shape as narrative_documents). Re-verified
-- against the same replayed database after this fix: the identical insert
-- now fails with "pack_review_confirmations: this tender is another
-- company's private tender" (42501); a confirmation row on a SHARED tender,
-- or on the requesting company's own private tender, still succeeds -
-- confirmed both, so this doesn't over-block the feature's real use
-- (confirmPackReview()/confirmGeneralPackReview(), actions.ts/
-- general-pack-review-actions.ts, never pass a tender_id the caller doesn't
-- already have a legitimate pack-review reason to see).
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
                       'narrative_documents', 'pack_review_confirmations') then
    if not tt_tender_visible_to(new.tender_id, v_company) then
      raise exception '%: this tender is another company''s private tender', tg_table_name using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger tt_same_company before insert or update of company_id, tender_id on pack_review_confirmations
  for each row execute function tt_check_same_company();
