/**
 * Coverage for buildCompanyUpdate() - no dedicated test file existed for
 * this module before this.
 *
 * Finding (2026-10-30): every numeric field only ever rejected a NEGATIVE
 * number - there was no upper bound anywhere in the stack (client NumberInput
 * has no max, this function had none, the DB has no check constraint).
 * black_ownership_pct/bee_procurement_recognition_pct/typical_jv_share_pct
 * are percentages written verbatim onto real tender submission documents
 * (engine/sanral_fill.py's K33/L33, engine/fill_a_forms.py's A12 line,
 * confirm_pack.py's jv_share_pct); bee_level is written straight into
 * SANRAL's own K33 cell, whole 1-9 (9 = "non-compliant contributor",
 * docs/specs/Form-Field-Audit.md). A typo like "500" or "47" would have
 * printed unchanged on a real government bid. Fixed by capping the three
 * percentage fields at 100 and bee_level at 9 (1-9, the real documented
 * range - not 1-8).
 *
 * Run: node --experimental-strip-types --test lib/companyProfileUpdate.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCompanyUpdate } from "./companyProfileUpdate.ts";

function fd(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

test("buildCompanyUpdate: black_ownership_pct of 500 is refused, not silently accepted", () => {
  const { update, error } = buildCompanyUpdate(fd({ black_ownership_pct: "500" }));
  assert.ok(error);
  assert.equal(update.black_ownership_pct, undefined);
});

test("buildCompanyUpdate: black_ownership_pct of exactly 100 (the real ceiling) is accepted", () => {
  const { update, error } = buildCompanyUpdate(fd({ black_ownership_pct: "100" }));
  assert.equal(error, null);
  assert.equal(update.black_ownership_pct, 100);
});

test("buildCompanyUpdate: bee_procurement_recognition_pct over 100 is refused", () => {
  const { error } = buildCompanyUpdate(fd({ bee_procurement_recognition_pct: "101" }));
  assert.ok(error);
});

test("buildCompanyUpdate: typical_jv_share_pct over 100 is refused", () => {
  const { error } = buildCompanyUpdate(fd({ typical_jv_share_pct: "250" }));
  assert.ok(error);
});

test("buildCompanyUpdate: bee_level of 47 is refused, not printed onto a real SANRAL form", () => {
  const { update, error } = buildCompanyUpdate(fd({ bee_level: "47" }));
  assert.ok(error);
  assert.equal(update.bee_level, undefined);
});

test("buildCompanyUpdate: bee_level of 9 (SANRAL's own 'non-compliant contributor' value) is accepted, not treated as out of range", () => {
  const { update, error } = buildCompanyUpdate(fd({ bee_level: "9" }));
  assert.equal(error, null);
  assert.equal(update.bee_level, 9);
});

test("buildCompanyUpdate: bee_level of 10 is refused (one past the real 1-9 range)", () => {
  const { error } = buildCompanyUpdate(fd({ bee_level: "10" }));
  assert.ok(error);
});

test("buildCompanyUpdate: a non-percentage count field (other_offices) is untouched by the new ceiling - still just '0 or more'", () => {
  const { update, error } = buildCompanyUpdate(fd({ other_offices: "500" }));
  assert.equal(error, null);
  assert.equal(update.other_offices, 500);
});

test("buildCompanyUpdate: a negative value is still refused (unchanged pre-existing behaviour)", () => {
  const { error } = buildCompanyUpdate(fd({ black_ownership_pct: "-5" }));
  assert.ok(error);
});

test("buildCompanyUpdate: an absent field is left out of the update entirely (unchanged pre-existing behaviour)", () => {
  const { update } = buildCompanyUpdate(fd({}));
  assert.equal("bee_level" in update, false);
});
