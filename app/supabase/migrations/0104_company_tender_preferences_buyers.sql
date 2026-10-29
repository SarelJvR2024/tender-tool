-- Preferred clients/buyers as an Opportunity preference (Sarel, 2026-10-29:
-- "add a list of clients as preferences"), same additive sort-boost role
-- interested_disciplines (0088) already has - never a WHERE clause on
-- discovered_opportunities, never changes verdict (see
-- app/lib/opportunityBuyerMatch.ts's own header comment for the matching
-- logic and why it's a case-insensitive substring check rather than an
-- exact slug comparison: unlike disciplines, buyer names have no canonical
-- taxonomy - discovered_opportunities.buyer is raw text straight from
-- whichever source scraper read it).

alter table company_tender_preferences
  add column preferred_buyers text[] not null default '{}';

create index company_tender_preferences_buyers_idx
  on company_tender_preferences using gin (preferred_buyers);

comment on column company_tender_preferences.preferred_buyers is
  'Free-text client/buyer names this company wants Discovery to prioritise - sanitised shape only (app/lib/opportunityBuyerMatch.ts sanitizePreferredBuyers()), no fixed taxonomy since buyer names aren''t normalised anywhere in this schema. Matched case-insensitively, substring either direction, against discovered_opportunities.buyer - a sort boost, same as interested_disciplines, never a filter and never touches verdict.';
