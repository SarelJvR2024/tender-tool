/**
 * Regression test for signatory-logic.ts - picking a default signatory out
 * of a company's several recorded ones, scored against one tender's region/
 * industry/discipline tags. Pure, no Supabase, same pattern as
 * pack-review-logic.test.ts.
 *
 * Run: node --experimental-strip-types --test app/app/tenders/[id]/signatory-logic.test.ts
 *
 * Covers the build task's required scenarios:
 *   - 0 signatories (no crash, null result)
 *   - 1 signatory (always picked, scoped or not)
 *   - multiple signatories, overlapping/no scoping (right default suggestion)
 *   - free override is always possible (this module never removes anyone -
 *     covered indirectly: pickDefaultSignatory only ever returns one of the
 *     `signers` passed in, it never filters the list itself)
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { pickDefaultSignatory, NO_TENDER_SCOPE, type Signatory, type SignatoryScope } from "./signatory-logic.ts";

const jane: Signatory = { id: "p1", name: "Jane Soap", signatory_capacity: "Managing Director" };
const tom: Signatory = { id: "p2", name: "Tom Brick", signatory_capacity: "Regional Director - Western Cape" };
const amy: Signatory = { id: "p3", name: "Amy Stone", signatory_capacity: "Technical Director" };

test("0 signatories: returns null, no crash", () => {
  const r = pickDefaultSignatory({ signers: [], scopes: [], tender: NO_TENDER_SCOPE });
  assert.equal(r, null);
});

test("1 signatory: always picked, even unscoped", () => {
  const r = pickDefaultSignatory({ signers: [jane], scopes: [], tender: NO_TENDER_SCOPE });
  assert.deepEqual(r, jane);
});

test("1 signatory: picked even when their only scope doesn't match this tender", () => {
  const scopes: SignatoryScope[] = [{ person_id: jane.id, region: "Gauteng", industry_tag: null, discipline_tag: null }];
  const r = pickDefaultSignatory({ signers: [jane], scopes, tender: { region: "Limpopo", industryTags: [], disciplineTags: [] } });
  assert.deepEqual(r, jane);
});

test("multiple signatories, no scoping at all: falls back to list order (first on file)", () => {
  const r = pickDefaultSignatory({ signers: [jane, tom, amy], scopes: [], tender: NO_TENDER_SCOPE });
  assert.deepEqual(r, jane);
});

test("multiple signatories, one region match: the matching one wins over list order", () => {
  const scopes: SignatoryScope[] = [{ person_id: tom.id, region: "Western Cape", industry_tag: null, discipline_tag: null }];
  const r = pickDefaultSignatory({ signers: [jane, tom, amy], scopes, tender: { region: "Western Cape", industryTags: [], disciplineTags: [] } });
  assert.deepEqual(r, tom);
});

test("region match is case/whitespace insensitive", () => {
  const scopes: SignatoryScope[] = [{ person_id: tom.id, region: "  Western Cape  ", industry_tag: null, discipline_tag: null }];
  const r = pickDefaultSignatory({ signers: [jane, tom], scopes, tender: { region: "western cape", industryTags: [], disciplineTags: [] } });
  assert.deepEqual(r, tom);
});

test("a discipline-tag match outranks a broader industry-tag match", () => {
  const scopes: SignatoryScope[] = [
    { person_id: tom.id, region: null, industry_tag: "roads_civil", discipline_tag: null },
    { person_id: amy.id, region: null, industry_tag: null, discipline_tag: "road_maintenance" },
  ];
  const r = pickDefaultSignatory({
    signers: [jane, tom, amy],
    scopes,
    tender: { region: null, industryTags: ["roads_civil"], disciplineTags: ["road_maintenance"] },
  });
  assert.deepEqual(r, amy);
});

test("overlapping scopes (two signatories both match): higher score wins, not just first match", () => {
  const scopes: SignatoryScope[] = [
    { person_id: tom.id, region: null, industry_tag: "roads_civil", discipline_tag: null },
    { person_id: amy.id, region: "Western Cape", industry_tag: "roads_civil", discipline_tag: null },
  ];
  const r = pickDefaultSignatory({
    signers: [jane, tom, amy],
    scopes,
    tender: { region: "Western Cape", industryTags: ["roads_civil"], disciplineTags: [] },
  });
  assert.deepEqual(r, amy); // amy: industry (1) + region (1) = 2, beats tom's industry-only 1
});

test("no scope matches this tender at all: falls back to list order, never crashes", () => {
  const scopes: SignatoryScope[] = [
    { person_id: tom.id, region: "Gauteng", industry_tag: "it_telecoms", discipline_tag: null },
  ];
  const r = pickDefaultSignatory({
    signers: [jane, tom, amy],
    scopes,
    tender: { region: "Limpopo", industryTags: ["water"], disciplineTags: [] },
  });
  assert.deepEqual(r, jane); // no match anywhere -> first on file, same as before 0061
});

test("free override is always possible: the returned pick is always a member of `signers`, never injected or filtered out", () => {
  const scopes: SignatoryScope[] = [{ person_id: amy.id, region: "Western Cape", industry_tag: null, discipline_tag: null }];
  const r = pickDefaultSignatory({ signers: [jane, tom, amy], scopes, tender: { region: "Western Cape", industryTags: [], disciplineTags: [] } });
  assert.ok([jane, tom, amy].some((s) => s.id === r?.id));
  // Nothing about scoping removes jane or tom from being choosable - this
  // module only ever picks a *default*, the caller's own signer list (every
  // person with a signatory_capacity) is untouched.
});
