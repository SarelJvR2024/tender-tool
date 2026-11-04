/**
 * Pure logic tests for matchesInterestedDisciplines() - see
 * opportunityDisciplineMatch.ts's own header comment for the full writeup.
 *
 * Run: node --experimental-strip-types --test app/lib/opportunityDisciplineMatch.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesInterestedDisciplines } from "./opportunityDisciplineMatch.ts";
import type { DisciplineTaxonomy } from "./disciplineTaxonomy.ts";

const TAXONOMY: DisciplineTaxonomy = {
  source: "table",
  error: null,
  categories: [
    { slug: "roads_civil", label: "Roads & Civil", parent_slug: null, sort_order: 10, matched_by_group_tag: true },
    { slug: "road_maintenance", label: "Road maintenance", parent_slug: "roads_civil", sort_order: 11, matched_by_group_tag: true },
    { slug: "bridges", label: "Bridges", parent_slug: "roads_civil", sort_order: 12, matched_by_group_tag: true },
    // matched_by_group_tag off, same shape as the live seed's real
    // rail_infrastructure/roads_civil pair (0058) - standing review, 2026-11-04.
    { slug: "rail_infrastructure", label: "Rail infrastructure", parent_slug: "roads_civil", sort_order: 13, matched_by_group_tag: false },
    { slug: "it_telecoms", label: "IT & Telecoms", parent_slug: null, sort_order: 20, matched_by_group_tag: true },
  ],
};

test("no stated preference -> matches everything", () => {
  assert.equal(matchesInterestedDisciplines(TAXONOMY, [], ["bridges"]), true);
  assert.equal(matchesInterestedDisciplines(TAXONOMY, [], null), true);
});

test("tender has no categories yet -> matches regardless of preference (not punished for a scoring gap)", () => {
  assert.equal(matchesInterestedDisciplines(TAXONOMY, ["roads_civil"], null), true);
  assert.equal(matchesInterestedDisciplines(TAXONOMY, ["roads_civil"], []), true);
});

test("exact slug overlap matches", () => {
  assert.equal(matchesInterestedDisciplines(TAXONOMY, ["bridges"], ["bridges"]), true);
});

test("no overlap at all does not match", () => {
  assert.equal(matchesInterestedDisciplines(TAXONOMY, ["it_telecoms"], ["bridges"]), false);
});

test("company selected the whole group -> matches a tender tagged with one of its children", () => {
  assert.equal(matchesInterestedDisciplines(TAXONOMY, ["roads_civil"], ["road_maintenance"]), true);
});

test("tender tagged only with the group -> matches a company interested in one of its children", () => {
  assert.equal(matchesInterestedDisciplines(TAXONOMY, ["road_maintenance"], ["roads_civil"]), true);
});

test("multiple interests/categories, only one pair needs to overlap", () => {
  assert.equal(matchesInterestedDisciplines(TAXONOMY, ["it_telecoms", "bridges"], ["road_maintenance", "bridges"]), true);
});

// Standing review, 2026-11-04: matched_by_group_tag (0058) must gate which
// children a GROUP interest counts as covering - same distinction
// engine/discovery/taxonomy.py's fit_overlap() already makes between its
// "exact" and "peripheral" buckets (a company tagged professional_services
// is not thereby a property valuer; here, roads_civil is not thereby
// rail_infrastructure).
test("company selected the whole group -> does NOT match a tender tagged with a child whose matched_by_group_tag is off", () => {
  assert.equal(matchesInterestedDisciplines(TAXONOMY, ["roads_civil"], ["rail_infrastructure"]), false);
});

test("company selected the specific child directly -> still matches regardless of its own matched_by_group_tag", () => {
  assert.equal(matchesInterestedDisciplines(TAXONOMY, ["rail_infrastructure"], ["rail_infrastructure"]), true);
});

test("tender tagged only with the group -> STILL matches a company interested in a child whose matched_by_group_tag is off (taxonomy.py's 'broad' bucket, never excluded)", () => {
  assert.equal(matchesInterestedDisciplines(TAXONOMY, ["rail_infrastructure"], ["roads_civil"]), true);
});

test("matched_by_group_tag true child is unaffected by this fix (existing behaviour preserved)", () => {
  assert.equal(matchesInterestedDisciplines(TAXONOMY, ["roads_civil"], ["road_maintenance"]), true);
});
