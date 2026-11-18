import { test } from "node:test";
import assert from "node:assert/strict";
import { baseCode, matrixForPosition, sanralRoleCodeForPosition } from "./sanralMatrices.ts";

// Finding 490 (standing review, 2026-11-18): baseCode() used to strip the
// trailing digit AFTER only trimming the string's OWN leading/trailing
// whitespace, so a code with an internal space before that digit ("DS 1")
// left a dangling space behind ("DS ", not "DS") - silently failing every
// exact-match comparison against it in matrixForPosition()/
// sanralRoleCodeForPosition() below, unlike this file's own sibling call
// shape (sanralScoring.ts's `normPositionCode(baseCode(x))`), which already
// strips ALL whitespace and got this right.

test("baseCode: the documented examples still hold (no regression)", () => {
  assert.equal(baseCode("DS1"), "DS");
  assert.equal(baseCode("CE2"), "CE");
  assert.equal(baseCode("PL(T)"), "PL(T)");
  assert.equal(baseCode("PE(E)"), "PE(E)");
});

test("baseCode: the real bug - an internal space before the trailing digit no longer leaves a dangling space", () => {
  assert.equal(baseCode("DS 1"), "DS");
  assert.equal(baseCode("CE 2"), "CE");
});

test("baseCode: lowercase, outer whitespace, and a double internal space are all normalised the same way", () => {
  assert.equal(baseCode(" ds1 "), "DS");
  assert.equal(baseCode("DS  1"), "DS");
});

test("matrixForPosition: the real bug - 'DS 1' (a plausible SETUP-sheet spacing variant) finds the same matrix as 'DS1'", () => {
  const description = "Design Specialist 1 - Pavement and Materials";
  assert.equal(matrixForPosition("DS1", description), "DS_PAVEMENT_MATERIALS");
  assert.equal(matrixForPosition("DS 1", description), "DS_PAVEMENT_MATERIALS");
});

test("matrixForPosition: plain PL/CE/RE still resolve to the conventional matrix, with or without a stray space", () => {
  assert.equal(matrixForPosition("PL", null), "PL_CE_RE_CONVENTIONAL");
  assert.equal(matrixForPosition("CE", null), "PL_CE_RE_CONVENTIONAL");
  assert.equal(matrixForPosition("RE", null), "PL_CE_RE_CONVENTIONAL");
});

test("matrixForPosition: an unrecognised code still returns null, not a false match", () => {
  assert.equal(matrixForPosition("ZZ9", null), null);
});

test("sanralRoleCodeForPosition: the real bug - 'DS 1' no longer writes a broken 'sanral.DS ' role code with a trailing space baked in", () => {
  const description = "Design Specialist 1 - Pavement and Materials";
  assert.equal(sanralRoleCodeForPosition("DS1", description), "sanral.DS.pavement_materials");
  assert.equal(sanralRoleCodeForPosition("DS 1", description), "sanral.DS.pavement_materials");
});

test("sanralRoleCodeForPosition: a DS with no readable specialism in its description is null, not a guess", () => {
  assert.equal(sanralRoleCodeForPosition("DS1", "Design Specialist 1"), null);
  assert.equal(sanralRoleCodeForPosition("DS1", null), null);
});

test("sanralRoleCodeForPosition: a plain position code round-trips to its own sanral.<CODE> role code", () => {
  assert.equal(sanralRoleCodeForPosition("PL", null), "sanral.PL");
  assert.equal(sanralRoleCodeForPosition("CE", null), "sanral.CE");
});
