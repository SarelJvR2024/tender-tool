-- Tender deal economics (feature list items 26 and 27, Phase 3):
--   26. "Record who on the team submitted each tender, and any revenue-share
--       or commission tied to that person"
--   27. "Record the company's own submitted price per tender, building an
--       internal pricing history by tender type, client and sector"
--
-- Where it lives, and why columns on tender_packs rather than a new table:
-- both facts are one value per company per tender, which is exactly what
-- tender_packs already is (unique (company_id, tender_id), tenant RLS "all"
-- verbs via is_company_member). 0021 put the pipeline stage on the same row
-- for the same reason, and the submitted price is captured at that stage's
-- submitted/won/lost transition (/pipeline). No new table, no new policy.
-- Checked first that nothing already holds a price: tenders has no amount
-- column (shared, buyer-side data), pack_generation_jobs only records
-- whether a Financial workbook was printed (the pricing itself is typed into
-- the .xlsm by hand after the pack is built - System-Status Gap #12), and
-- discovered_opportunities.score_outlook deliberately never estimates price.
--
-- Credit goes to people(id), NOT company_members - same reasoning 0011
-- (tender_tasks.assigned_to) documented: company_members has no display name
-- and no UI surface, and people is the company's real roster (People page),
-- which is also what the position confirmation (tender_pack_assignments.
-- confirmed_person_id) points at. ON DELETE SET NULL: removing a person must
-- never silently delete the pricing record.
--
-- Commission is deliberately simple: a percentage OR a flat rand amount
-- (not both), plus a free-text note. No calculation engine.
--
-- Tender type and client already exist on the tender (tenders.family,
-- tenders.buyer / SANRAL for the SANRAL families). Sector does not: the only
-- discipline signal is discovered_opportunities.categories (per company,
-- only for tenders that came through the scored feed), so price_sector is
-- stored here, prefilled from that signal by the form and editable. Values
-- are exactly assess_tender.py DISCIPLINE_KEYWORDS keys (same set as
-- experience_items.disciplines in 0012 and app/lib/experience.ts).
alter table tender_packs
  add column submitted_price_zar numeric(16, 2) check (submitted_price_zar is null or submitted_price_zar >= 0),
  -- SA tender prices are normally quoted VAT-inclusive; recorded so a mixed
  -- history isn't compared like-for-like by accident.
  add column submitted_price_incl_vat boolean not null default true,
  add column submitted_by_person_id uuid references people(id) on delete set null,
  add column commission_percent numeric(5, 2) check (commission_percent is null or (commission_percent >= 0 and commission_percent <= 100)),
  add column commission_amount_zar numeric(16, 2) check (commission_amount_zar is null or commission_amount_zar >= 0),
  add column commission_note text,
  add column price_sector text check (price_sector is null or price_sector in (
    'roads_civil', 'water', 'buildings', 'electrical_mechanical', 'it_telecoms',
    'professional_services', 'security_facilities'
  )),
  add column price_note text,
  add column price_recorded_at timestamptz,
  add constraint tender_packs_commission_one_kind
    check (commission_percent is null or commission_amount_zar is null);

comment on column tender_packs.submitted_price_zar is
  'The company''s own submitted tender price in rand (item 27). Null until priced/submitted; editable later when the final figure differs. Internal pricing intelligence only - never shown to a buyer.';
comment on column tender_packs.submitted_by_person_id is
  'Who on the team gets credit for this submission (item 26). people.id, not company_members - see 0011.';
comment on column tender_packs.commission_percent is
  'Revenue-share/commission tied to submitted_by_person_id, as a percentage of the submitted price. Mutually exclusive with commission_amount_zar. A record, not a calculation.';
comment on column tender_packs.price_sector is
  'Sector/discipline for the pricing history (assess_tender.py DISCIPLINE_KEYWORDS key). Prefilled from Discovery categories, editable.';

-- The credited person must belong to the same company as the pack row. RLS
-- already hides other companies' people from a member, but an FK alone would
-- accept a guessed id from another tenant.
create or replace function tender_packs_check_credit_person()
returns trigger
language plpgsql
as $$
begin
  if new.submitted_by_person_id is not null and not exists (
    select 1 from people p
    where p.id = new.submitted_by_person_id and p.company_id = new.company_id
  ) then
    raise exception 'submitted_by_person_id must be a person in the same company'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger tender_packs_check_credit_person
  before insert or update of submitted_by_person_id, company_id on tender_packs
  for each row execute function tender_packs_check_credit_person();

create index tender_packs_company_priced_idx on tender_packs (company_id)
  where submitted_price_zar is not null;
