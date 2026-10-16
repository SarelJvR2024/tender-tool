-- Non-SANRAL tender preparation: get a discovered eTenders tender into the
-- Tender Workspace, record what ITS documents require, capture the answers only
-- a human can give, and request a generated submission pack.
--
-- Closes System-Status known gap #1 ("the general SBD engine still has zero
-- path into the web app"). Evidence for every column below:
-- docs/specs/General-Tender-Engine-Findings.md (6 buyers) and
-- docs/specs/General-Tender-Preparation-Findings.md (round 3: 24 real
-- non-SANRAL tenders, incl. 9 with editable .docx SBD editions).
--
-- 1. tenders: where a non-SANRAL tender came from (eTenders OCDS release) and
--    the requirement manifest engine/general/requirements.py reads from its
--    documents. Still SHARED data - the manifest describes the tender's own
--    documents, not any company - written by the service role (the bridge
--    engine/general/process_general_jobs.py) or by pursue_discovered_opportunity()
--    below, never by a client directly. Same rule as 0001/0016.
-- 2. companies: SBD 1 asks for the bidder's TELEPHONE NUMBER, CELLPHONE NUMBER
--    and E-MAIL ADDRESS (every SBD 1 edition sampled - Treasury, DSTI, SSA,
--    SITA, Mthashana, SALB, QCTO) and a CIDB grading (Treasury RT83, uMlalazi,
--    TNPA, SITA...). 0001 had no column for any of them, which is why
--    fill_sbd_docx.py has logged them "missing" since it was written.
-- 3. tender_answers: the per-tender answers and uploads the Tender Workspace
--    asks for (signatory, total bid price, SBD 1 Part B, SBD 4 and SBD 8
--    declarations, SBD 6.1 points claimed, briefing attended, JV...) - only the
--    questions the manifest says THIS tender's forms need. Tenant-scoped.
-- 4. tender_engine_jobs: request/status rows for work the web app can't do
--    itself (Python + LibreOffice - Vercel can't run either), fulfilled
--    out-of-band. Same shape and reasoning as generated_cvs (0008) and
--    engine/cv/process_cv_jobs.py. The SANRAL side's pack_generation_jobs
--    (0017, landed concurrently) is pack-only and its bridge
--    (engine/pack/process_pack_jobs.py) claims EVERY 'requested' row in it, so
--    general-engine rows can't go there without changing that SANRAL bridge.
--    This table therefore mirrors pack_generation_jobs' status vocabulary and
--    result columns (storage_path_pdf, output_files, page_count, manifest) and
--    adds `engine` + `kind`, so the two can be folded into one table later by
--    adding `engine` to pack_generation_jobs - see System-Status.
--    Packs go to 0017's private 'submission-packs' bucket under the same
--    "<company_id>/tenders/<tender_id>/<job_id>/<file>" convention.
-- 5. pursue_discovered_opportunity(): the one controlled way a signed-in user
--    turns a discovered opportunity into a shared `tenders` row + their own
--    tender_pack + a requirements-extraction job.

-- ---------------------------------------------------------------------------
-- 1. tenders
-- ---------------------------------------------------------------------------
alter table tenders add column buyer text;
alter table tenders add column ocid text;
alter table tenders add column source text not null default 'sanral' check (source in ('sanral', 'etenders_ocds'));
alter table tenders add column document_urls jsonb not null default '[]'::jsonb;
alter table tenders add column document_requirements jsonb;
create unique index tenders_ocid_key on tenders (ocid) where ocid is not null;

comment on column tenders.document_requirements is
  'Requirement manifest read from THIS tender''s own documents by engine/general/requirements.py: which SBD/MBD forms (and whether an editable .docx edition exists), buyer-specific forms, supporting documents (with verbatim quotes), roles, CIDB, briefing, scoring, experience-evidence and locality rules, and the questions a human must answer. Null = not read yet.';
comment on column tenders.document_urls is
  'The buyer''s own published document links ([{url, title}]) from the OCDS release - the extraction job downloads these.';

-- discovered_opportunities never kept the OCDS tender.description (assess_release()
-- didn't pass it through), so a pursued tender would have had only the
-- buyer's reference number as its description.
alter table discovered_opportunities add column description text;

-- ---------------------------------------------------------------------------
-- 2. companies
-- ---------------------------------------------------------------------------
alter table companies add column telephone text;
alter table companies add column cellphone text;
alter table companies add column email text;
alter table companies add column cidb_grading text; -- e.g. "6CE"; null = none recorded

-- ---------------------------------------------------------------------------
-- 3. tender_answers
-- ---------------------------------------------------------------------------
create table tender_answers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  -- a manifest question key (e.g. 'sbd4.relationship_with_employee',
  -- 'signatory_person_id', 'total_bid_price') or 'upload:<returnable key>'
  -- (e.g. 'upload:municipal_account') for a document attached for this tender.
  field_key text not null,
  value text,
  storage_path text, -- 'company-documents' bucket, "<company_id>/tenders/<tender_id>/<uuid>-<filename>"
  original_filename text,
  answered_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, tender_id, field_key),
  check (value is not null or storage_path is not null),
  check ((storage_path is null) = (original_filename is null)),
  check (storage_path is null or storage_path like company_id::text || '/tenders/' || tender_id::text || '/%')
);
comment on table tender_answers is
  'Per-company, per-tender answers to the questions THIS tender''s forms need (keys come from tenders.document_requirements.questions), plus documents uploaded for this tender only. Read by the Tender Workspace and by engine/general/process_general_jobs.py when it fills the forms.';

create index tender_answers_tender_idx on tender_answers (tender_id, company_id);

alter table tender_answers enable row level security;
create policy "tender_answers: tenant isolation" on tender_answers
  for all to authenticated using (is_company_member(company_id)) with check (is_company_member(company_id));

create trigger tender_answers_set_updated_at before update on tender_answers
  for each row execute function set_updated_at();

-- Uploads reuse the private 'company-documents' bucket (0014) and its
-- "<company_id>/..." path-prefix policy - no new bucket or storage policy.
-- Generated packs reuse 0017's 'submission-packs' bucket + policy; the insert
-- below is a no-op when 0017 already created it.
insert into storage.buckets (id, name, public) values ('submission-packs', 'submission-packs', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. tender_engine_jobs
-- ---------------------------------------------------------------------------
create table tender_engine_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  tender_id uuid not null references tenders(id) on delete cascade,
  tender_pack_id uuid references tender_packs(id) on delete set null,
  engine text not null default 'general' check (engine in ('general')),
  kind text not null check (kind in ('extract_requirements', 'generate_pack')),
  status text not null default 'requested' check (status in ('requested', 'generating', 'ready', 'failed')),
  -- generate_pack results, same names as pack_generation_jobs (0017):
  storage_path_pdf text,                           -- merged pack, 'submission-packs' bucket
  output_files jsonb not null default '{}'::jsonb, -- filled .docx forms, provenance, completion guide
  page_count int,
  manifest jsonb,                                  -- sections with page ranges, by-hand / missing items with reasons
  error_message text,
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);
comment on table tender_engine_jobs is
  'Request/status rows for general (non-SANRAL) engine work the web app can''t run (Python + LibreOffice): requirement extraction and submission-pack generation. Clients insert status=requested; engine/general/process_general_jobs.py (service role) claims requested->generating and fulfils them. Same pattern as generated_cvs (0008) and pack_generation_jobs (0017), whose result columns it mirrors.';

-- At most one open job per (company, tender, engine, kind): a double-click
-- or two people pressing "Generate" can't queue two packs.
create unique index tender_engine_jobs_one_open_key
  on tender_engine_jobs (company_id, tender_id, engine, kind) where status in ('requested', 'generating');
create index tender_engine_jobs_status_idx on tender_engine_jobs (status, requested_at);
create index tender_engine_jobs_tender_idx on tender_engine_jobs (tender_id, company_id, requested_at desc);

alter table tender_engine_jobs enable row level security;
create policy "tender_engine_jobs: members can select" on tender_engine_jobs
  for select to authenticated using (is_company_member(company_id));
-- Clients may only queue a request. Status changes, results and paths are
-- written by the bridge via the service role.
create policy "tender_engine_jobs: members can request" on tender_engine_jobs
  for insert to authenticated with check (
    is_company_member(company_id) and status = 'requested' and storage_path_pdf is null and manifest is null
    and output_files = '{}'::jsonb and error_message is null and started_at is null and completed_at is null
  );

-- ---------------------------------------------------------------------------
-- 5. pursue_discovered_opportunity()
-- ---------------------------------------------------------------------------
create or replace function pursue_discovered_opportunity(p_opportunity_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  opp discovered_opportunities%rowtype;
  t_id uuid;
  rules jsonb;
begin
  select * into opp from discovered_opportunities where id = p_opportunity_id;
  if not found or not is_company_member(opp.company_id) then
    raise exception 'opportunity not found' using errcode = 'P0002';
  end if;

  -- The discovery outlook already read this tender's experience-evidence and
  -- locality rules (score_outlook.py) - carry them over so the workspace has
  -- them before the full extraction job runs.
  if opp.score_outlook ? 'experience_evidence' then
    rules := jsonb_build_object(
      'experience_evidence', opp.score_outlook -> 'experience_evidence',
      'locality', jsonb_build_object(
        'rows', coalesce(opp.score_outlook -> 'locality' -> 'rows', '[]'::jsonb),
        'mandatory_local_office', opp.score_outlook -> 'locality' -> 'mandatory_local_office'),
      'source_document', 'discovery outlook (first readable document)',
      'extracted_at', now());
  end if;

  insert into tenders (slug, contract_no, title, description, closing_date, family, status,
                       buyer, ocid, source, document_urls, evaluation_rules)
  values (coalesce(opp.ocid, 'opportunity-' || opp.id::text),
          coalesce(opp.title, opp.contract_number),
          opp.title,
          coalesce(opp.description, opp.title),
          opp.closing_date,
          'General (non-SANRAL)',
          case when opp.closing_date is not null and opp.closing_date < now() then 'closed' else 'open' end,
          opp.buyer, opp.ocid, 'etenders_ocds', opp.document_urls, rules)
  on conflict (slug) do update set last_seen_at = now()
  returning id into t_id;

  insert into tender_packs (company_id, tender_id)
  values (opp.company_id, t_id)
  on conflict (company_id, tender_id) do nothing;

  if not exists (select 1 from tenders where id = t_id and document_requirements is not null) then
    insert into tender_engine_jobs (company_id, tender_id, tender_pack_id, kind, requested_by)
    select opp.company_id, t_id, tp.id, 'extract_requirements', auth.uid()
    from tender_packs tp where tp.company_id = opp.company_id and tp.tender_id = t_id
    on conflict (company_id, tender_id, engine, kind) where status in ('requested', 'generating') do nothing;
  end if;

  return t_id;
end;
$$;
comment on function pursue_discovered_opportunity(uuid) is
  'Signed-in member of the opportunity''s company -> creates (or reuses, by OCDS ocid) the shared tenders row, the company''s tender_pack, and an extract_requirements job. SECURITY DEFINER because tenders is otherwise service-role-write-only; the membership check is the first thing it does.';

revoke all on function pursue_discovered_opportunity(uuid) from public;
grant execute on function pursue_discovered_opportunity(uuid) to authenticated;
