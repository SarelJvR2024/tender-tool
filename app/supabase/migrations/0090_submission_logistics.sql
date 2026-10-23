-- Tender Command Center (Sarel's own brief, 2026-10-24): physical submission
-- logistics. South African public tenders overwhelmingly require physical
-- box delivery by a stated time; compiling, printing, binding and signing
-- takes hours, and getting the pack to the box takes more - the REAL
-- operational cutoff is well before the tender's own closing time, and nothing
-- in this schema tracked that gap at all.
--
-- Lives on tender_packs, not tenders: tenders is the shared, buyer-written
-- table (one row for every company, same reasoning 0021's own header comment
-- gives for pipeline_stage) - submission logistics are this COMPANY's own
-- plan for getting ITS pack there, same as pipeline_stage/submitted_at
-- already are. Existing RLS ("tender_packs: tenant isolation", all verbs)
-- already covers every column added here - no new policy needed.
--
-- Deliberately NOT stored here (computed instead, in app code, from real
-- data - see lib/dispatchTriage.ts):
--   - print_sign_deadline: closing_date - estimated_print_hours -
--     estimated_transit_hours is arithmetic, not a fact - storing it would
--     drift the moment either input changed, the same reason
--     closingCountdown()/computeTenderReadiness() are computed, never stored.
--   - blocking_items: this tender's own Disqualification Guard
--     (disqualification-guard.tsx) and readiness report already compute
--     exactly this list from the real compliance/key-position data - a
--     second, manually-set text[] column could disagree with the one real
--     answer, which is exactly the "never a second number that could
--     disagree" rule this whole app already follows everywhere else.
--   - decision_needed: only partially derivable from real data today (a
--     compulsory briefing not yet acknowledged; the Guard reporting a real
--     "Fix" item close to closing) - no GO_NO_GO or PRICING_SIGNOFF workflow
--     exists anywhere in this schema (financial_captures, 0001, is
--     deliberately still just draft/complete, no sign-off state), so
--     fabricating a 4-value stored enum here would be inventing data this
--     app cannot back up. lib/dispatchTriage.ts derives what's honestly
--     derivable and says so for what isn't - see its own header comment.
alter table tender_packs
  add column submission_type text not null default 'physical_box'
    check (submission_type in ('physical_box', 'etenders_portal', 'email', 'other_digital')),
  -- Free text, not geocoded - no distance/mapping integration exists in this
  -- app, so a real address is only ever what a human on this company types
  -- in; nothing here infers a travel time from it.
  add column delivery_location text,
  -- Hours, not a timestamp - these are durations the company itself sets
  -- (reasonable defaults from Sarel's own brief: courier/drive time, and a
  -- print/bind/sign buffer), combined with the real closing_date at read
  -- time to get the actual cutoff. Numeric, not integer: half-hour estimates
  -- are a real thing ("2.5h drive from JHB").
  add column estimated_transit_hours numeric not null default 2,
  add column estimated_print_hours numeric not null default 4,
  add column dispatch_status text not null default 'not_ready'
    check (dispatch_status in ('not_ready', 'compiling', 'print_ready', 'printed_and_bound', 'out_for_delivery', 'submitted_and_receipted')),
  -- Lane C's own checklist needs somewhere real to put this - not in the
  -- brief's own §1.1 list, but its §2 Lane C UI asks for it directly and
  -- nothing else in this schema holds it.
  add column courier_contact text;

comment on column tender_packs.submission_type is
  'How this company will actually submit this tender - defaults to physical_box, the SA public-tender norm this whole feature exists for.';
comment on column tender_packs.delivery_location is
  'Free-text delivery address, typed by a human on this company - never geocoded or distance-estimated (no mapping integration exists here).';
comment on column tender_packs.estimated_transit_hours is
  'This company''s own estimate of courier/drive time to delivery_location, hours. Default 2 (Sarel''s own brief).';
comment on column tender_packs.estimated_print_hours is
  'This company''s own estimate of compile/print/bind/sign time before dispatch, hours. Default 4 (Sarel''s own brief).';
comment on column tender_packs.dispatch_status is
  'Manually-advanced physical-submission checklist state (not_ready -> compiling -> print_ready -> printed_and_bound -> out_for_delivery -> submitted_and_receipted) - the one thing here nothing else can derive, same as pipeline_stage.';
comment on column tender_packs.courier_contact is
  'Free-text name/contact for whoever is physically delivering the pack - Lane C''s own "Assigned Driver / Courier" field.';
