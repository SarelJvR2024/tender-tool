-- Close a cross-tenant reference gap on narrative_documents (0087), the
-- cover-letter/methodology-statement generator - this table was added well
-- after the cross-tenant-integrity audit (0043, docs/specs/
-- POPIA-Security-Audit.md) and was never given the tt_same_company guard
-- every other *_tender_id-bearing tenant table already has (tender_tasks,
-- tender_packs, tender_answers, financial_captures, generated_documents,
-- generated_cvs, pack_generation_jobs, tender_comments,
-- tender_private_documents).
--
-- Reproduced live before fixing, not assumed: replayed every migration
-- (0001-0096) onto a scratch Postgres, confirmed tt_tender_visible_to()
-- itself correctly says company A cannot see company B's PRIVATE tender,
-- then inserted a narrative_documents row with company_id = A (A's own row,
-- passes RLS trivially - is_company_member(company_id) has no opinion on
-- tender_id) and tender_id pointing straight at B's private tender. The
-- insert succeeded. Real impact, same shape 0043's own header describes for
-- every other table it covers: the always-on worker (service role, bypasses
-- RLS by design) reads the referenced tender's own details - buyer,
-- description, closing date - to ground the AI-drafted cover letter/
-- methodology text; a company holding only B's tender UUID (not a secret -
-- a URL in a screenshot or an old e-mail is enough, same standing threat
-- model as 0043) could use this to confirm a private tender exists and pull
-- its details into its own generated document. It would also pollute
-- narrative_documents_tender_kind_ready_idx - the exact index the
-- uniqueness/anti-collusion check (0087's own stated reason for existing)
-- queries "every ready document of this kind for this tender, across all
-- companies" against - with a row tied to a tender the injecting company
-- was never supposed to know about, which could falsely similarity-flag the
-- tender's real owner's own later, legitimate draft.
--
-- Fix: the exact same mechanism every sibling table already uses - add
-- narrative_documents to tt_check_same_company()'s tender-visibility branch
-- and attach the trigger on (company_id, tender_id), the only two columns
-- this table needs guarded (no person_id/tender_pack_id reference here to
-- also cover, unlike generated_cvs/pack_generation_jobs). Re-verified
-- against the same replayed database after this fix: the identical insert
-- now fails with "narrative_documents: this tender is another company's
-- private tender" (42501); a narrative_documents row on a SHARED tender, or
-- on the requesting company's own private tender, still succeeds -
-- confirmed both, so this doesn't over-block the feature's real use.
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
                       'narrative_documents') then
    if not tt_tender_visible_to(new.tender_id, v_company) then
      raise exception '%: this tender is another company''s private tender', tg_table_name using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger tt_same_company before insert or update of company_id, tender_id on narrative_documents
  for each row execute function tt_check_same_company();
