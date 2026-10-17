-- Tender pipeline board (feature list item 10: "Tender pipeline board: found,
-- bidding, submitted, won, lost; submitted and won history").
--
-- Where the stage lives, and why it is a new column rather than a reuse of an
-- existing status (checked against every status-like column first):
--
--   - tenders.status ('open' | 'closed' | 'awarded' | 'cancelled', 0001) is the
--     BUYER's public status of the tender. tenders is a shared table, one row
--     for every company, written only by the discovery pipeline - it cannot
--     hold "we bid on this and lost", which is different per company.
--   - tender_packs.status ('suggested' | 'confirmed' | 'filled', 0001) is the
--     key-person suggest/confirm gate for pack generation (has a human
--     confirmed every position?). A tender can be 'confirmed' and never be
--     submitted, or be won with the pack still 'suggested' if it was built
--     outside the app - the two answer different questions.
--   - tender_tasks.kind ('closing' | 'briefing' | 'clarification' |
--     'submission', 0009) tags dated milestones on the task timeline; only
--     'closing' is ever auto-seeded, and a milestone row says when something
--     is due, not whether the company submitted, won or lost.
--
-- None of them can be derived into found/bidding/submitted/won/lost (won/lost
-- in particular exist nowhere). The stage is per company per tender, which is
-- exactly what tender_packs already is (unique (company_id, tender_id),
-- tenant RLS) - so it goes on tender_packs instead of a new table. Existing
-- RLS ("tender_packs: tenant isolation", all verbs) already covers it.
alter table tender_packs
  add column pipeline_stage text not null default 'found'
    check (pipeline_stage in ('found', 'bidding', 'submitted', 'won', 'lost')),
  add column stage_changed_at timestamptz not null default now(),
  -- First time the tender reached submitted (or won/lost directly). Kept when
  -- it later moves on to won/lost, so the submitted history keeps its date.
  add column submitted_at timestamptz;

comment on column tender_packs.pipeline_stage is
  'This company''s business stage on the tender (pipeline board, /pipeline): found -> bidding -> submitted -> won | lost. Not tenders.status (the buyer''s public status) and not tender_packs.status (the key-person confirm gate).';

create or replace function tender_packs_stage_stamp()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.pipeline_stage is distinct from old.pipeline_stage then
    new.stage_changed_at := now();
    if new.pipeline_stage in ('submitted', 'won', 'lost') and new.submitted_at is null then
      new.submitted_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger tender_packs_stage_stamp
  before insert or update of pipeline_stage on tender_packs
  for each row execute function tender_packs_stage_stamp();

create index tender_packs_company_stage_idx on tender_packs (company_id, pipeline_stage);
