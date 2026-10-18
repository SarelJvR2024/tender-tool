-- Discovery fit-scoring regression fix (2026-10-18, docs/specs/System-Status.md).
--
-- What went wrong: 0040 kept the 7 original discipline buckets as GROUP slugs
-- so old tags still resolve, and taught Discovery that "a company tagged with
-- a group matches every discipline in it". But two of those groups grew far
-- past what the old bucket meant:
--   professional_services: 4 engineering-PSP keywords ("consulting engineer",
--     "design specialist", "psp", "professional service provider") became a
--     13-discipline group that also holds property valuation, management
--     consulting, laboratories, feasibility/research, town planning, ...
--   roads_civil: gained rail infrastructure and ports & marine works.
-- Every tag written before 0040 silently widened with them. Klipcorp's real
-- tags [roads_civil, professional_services] came out strong_fit on 456 of the
-- 2 211 tenders live on eTenders on 2026-10-18 (valuation panels, ethics risk
-- assessments, stevedoring, railway torches & latex gloves) - and 12 of the 14
-- strong_fit releases of a real 5-day daily watch run were wrong.
--
-- The fix: a per-discipline switch, matched_by_group_tag. Off = a company
-- tagged only with the group is NOT counted as doing this discipline
-- (engine/discovery/taxonomy.py fit_overlap: "peripheral" -> needs_review,
-- never strong_fit/possible); a company that ticked the discipline itself is
-- matched as before. Turned off below for the disciplines each legacy group
-- gained in 0040 that its old bucket keywords never covered. Groups added in
-- 0040 (no older tags to widen) keep every discipline on.
--
-- Plus keyword precision on the same categories (identical to the edits in
-- config/discipline_taxonomy.json, the seed): generic "multidisciplinary"
-- (artists, health & wellness) and "* engineer*" matching contractors'
-- "civil engineering works" in consulting_engineering; buyer names ("Roads
-- Agency Limpopo", "Department of Roads and Transport") read as road works;
-- "George drainage area" (an oncology referral area) read as stormwater;
-- airport "passenger loading bridges" read as bridges; "mobility" alone.
-- Written as array edits, not overwrites, so an admin's own changes to these
-- rows (/admin/taxonomy, 0054) survive.

alter table discipline_categories
  add column if not exists matched_by_group_tag boolean not null default true;

comment on column discipline_categories.matched_by_group_tag is
  'Does a company tagged with this discipline''s GROUP count as doing it? false = only a company that tagged the discipline itself is matched; a group-tagged company sees such a tender as needs_review, never strong_fit/possible (0058, 2026-10-18 Discovery regression). Ignored on group rows.';

update discipline_categories set matched_by_group_tag = false
where slug in (
  -- roads_civil (old bucket: road, bridge, pavement, route, highway, civil engineering, rehabilitation, stormwater, earthworks)
  'rail_infrastructure', 'ports_marine_works',
  -- professional_services (old bucket: professional service provider, consulting engineer, design specialist, psp)
  'town_planning_urban_design', 'environmental_assessment', 'surveying_gis', 'property_valuation',
  'feasibility_research_advisory', 'management_consulting', 'laboratory_scientific', 'project_construction_management',
  -- water (old bucket: water treatment, sanitation, sewer, pump station, borehole, reticulation)
  'water_meters_revenue',
  -- buildings (old bucket: building, renovation, refurbishment, construction of, roofing)
  'plumbing', 'demolition', 'fencing_gates',
  -- security_facilities (old bucket: security services, cleaning, facilities management)
  'fire_protection', 'pest_control', 'gardening_landscaping'
);

-- append each value not already present, keeping the existing order
create or replace function pg_temp.tt_append(arr text[], extra text[]) returns text[]
language sql immutable as $$
  select coalesce(arr, '{}') || coalesce(array(select e from unnest(extra) with ordinality u(e, n)
                                               where e <> all(coalesce(arr, '{}')) order by n), '{}')
$$;

update discipline_categories set keywords = pg_temp.tt_append(
    array_replace(array_replace(array_replace(array_replace(
      array_remove(array_remove(keywords, 'multidisciplinary'), 'multi disciplinary'),
      'structural engineer*', 'structural engineer'), 'electrical engineer*', 'electrical engineer'),
      'mechanical engineer*', 'mechanical engineer'), 'civil engineer*', 'civil engineer'),
    array['multidisciplinary & engineer*', 'multi disciplinary & engineer*',
          'multidisciplinary & built environment', 'multi disciplinary & built environment',
          'built environment service provider*', 'engineering professional service*',
          'structural engineering service*', 'structural engineering design', 'engineering & consultan*'])
where slug = 'consulting_engineering';

update discipline_categories set keywords = pg_temp.tt_append(array_remove(keywords, 'mobility'),
    array['mobility plan*', 'mobility strateg*', 'urban mobility'])
where slug = 'transport_planning_traffic';

update discipline_categories set exclude_keywords = pg_temp.tt_append(exclude_keywords,
    array['department of roads and transport', 'roads and transport department', 'department of public works and roads',
          'public works roads and transport', 'police roads and transport', 'roads agency'])
where slug = 'road_construction_upgrade';

update discipline_categories set exclude_keywords = pg_temp.tt_append(exclude_keywords,
    array['department of roads and transport', 'roads agency'])
where slug = 'road_maintenance';

update discipline_categories set exclude_keywords = pg_temp.tt_append(exclude_keywords, array['drainage area'])
where slug = 'stormwater_drainage';

update discipline_categories set exclude_keywords = pg_temp.tt_append(exclude_keywords, array['loading bridge', 'boarding bridge'])
where slug = 'bridges_structures';
