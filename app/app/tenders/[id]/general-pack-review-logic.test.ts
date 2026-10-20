/**
 * Regression test for general-pack-review-logic.ts - the pure classification
 * rules behind the general-tender Pack Review card (general-pack-review.tsx).
 * Mirrors pack-review-logic.test.ts's own coverage shape for the general
 * tender equivalent. No network, no database.
 *
 * Run: node --experimental-strip-types --test app/app/tenders/[id]/general-pack-review-logic.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerStatus,
  localityStatus,
  matchStrengthStatus,
  roleStatus,
  signatureAnswerStatus,
} from "./general-pack-review-logic.ts";
import { docItemStatus } from "./pack-review-logic.ts";

test("answerStatus: answered is confirmed", () => {
  assert.deepEqual(answerStatus(true, false), { status: "confirmed", note: null });
  assert.deepEqual(answerStatus(true, true), { status: "confirmed", note: null });
});

test("answerStatus: unanswered required is missing, unanswered optional is needs_input", () => {
  assert.equal(answerStatus(false, false).status, "missing");
  assert.equal(answerStatus(false, true).status, "needs_input");
});

test("roleStatus: nobody tagged is missing, not included", () => {
  const r = roleStatus({ taggedCount: 0, taggedWithCvCount: 0 });
  assert.equal(r.reviewStatus, "missing");
  assert.equal(r.checklistStatus, "not_included");
});

test("roleStatus: tagged but nobody has a CV is confirmed with a warning", () => {
  const r = roleStatus({ taggedCount: 2, taggedWithCvCount: 0 });
  assert.equal(r.reviewStatus, "confirmed");
  assert.equal(r.checklistStatus, "included_warning");
  assert.match(r.note ?? "", /no CV/);
});

test("roleStatus: some tagged have a CV, some don't - still confirmed, still flagged", () => {
  const r = roleStatus({ taggedCount: 3, taggedWithCvCount: 1 });
  assert.equal(r.reviewStatus, "confirmed");
  assert.equal(r.checklistStatus, "included_warning");
  assert.match(r.note ?? "", /2 of 3/);
});

test("roleStatus: everyone tagged has a CV is fully included", () => {
  const r = roleStatus({ taggedCount: 2, taggedWithCvCount: 2 });
  assert.deepEqual(r, { reviewStatus: "confirmed", checklistStatus: "included", note: null });
});

test("signatureAnswerStatus: nobody chosen, required, is missing", () => {
  const r = signatureAnswerStatus({ chosenId: null, chosenPerson: null, optional: false });
  assert.equal(r.reviewStatus, "missing");
  assert.equal(r.checklistStatus, "not_included");
});

test("signatureAnswerStatus: nobody chosen, optional, needs input but not a hard blocker", () => {
  const r = signatureAnswerStatus({ chosenId: null, chosenPerson: null, optional: true });
  assert.equal(r.reviewStatus, "needs_input");
  assert.equal(r.checklistStatus, "included_warning");
});

test("signatureAnswerStatus: chosen person has no signatory capacity on file is a warning", () => {
  const r = signatureAnswerStatus({ chosenId: "p1", chosenPerson: { name: "Jane Soap", signatory_capacity: null }, optional: false });
  assert.equal(r.reviewStatus, "warning");
  assert.equal(r.checklistStatus, "included_warning");
  assert.equal(r.value, "Jane Soap");
});

test("signatureAnswerStatus: chosen person with a signatory capacity is confirmed", () => {
  const r = signatureAnswerStatus({ chosenId: "p1", chosenPerson: { name: "Jane Soap", signatory_capacity: "Director" }, optional: false });
  assert.deepEqual(r, { reviewStatus: "confirmed", checklistStatus: "included", value: "Jane Soap - Director", note: null });
});

test("localityStatus: matched is confirmed / included", () => {
  const r = localityStatus({ matchStatus: "matched", mandatory: false, disqualifies: false });
  assert.deepEqual(r, { reviewStatus: "confirmed", checklistStatus: "included" });
});

test("localityStatus: unknown (no offices on file) needs input", () => {
  const r = localityStatus({ matchStatus: "unknown", mandatory: false, disqualifies: false });
  assert.equal(r.reviewStatus, "needs_input");
});

test("localityStatus: no match on a mandatory, disqualifying requirement is a hard 'missing'", () => {
  const r = localityStatus({ matchStatus: "no_match", mandatory: true, disqualifies: true });
  assert.equal(r.reviewStatus, "missing");
  assert.equal(r.checklistStatus, "not_included");
});

test("localityStatus: no match but not mandatory is only a warning", () => {
  const r = localityStatus({ matchStatus: "no_match", mandatory: false, disqualifies: false });
  assert.equal(r.reviewStatus, "warning");
  assert.equal(r.checklistStatus, "included_warning");
});

test("matchStrengthStatus: no confidence on the item returns null (nothing to show)", () => {
  assert.equal(matchStrengthStatus(null), null);
  assert.equal(matchStrengthStatus(undefined), null);
});

test("matchStrengthStatus: high score is a strong match", () => {
  assert.deepEqual(matchStrengthStatus(100), { tier: "strong", label: "Strong match" });
  assert.deepEqual(matchStrengthStatus(75), { tier: "strong", label: "Strong match" });
});

test("matchStrengthStatus: mid score says check this", () => {
  assert.deepEqual(matchStrengthStatus(74), { tier: "check", label: "Check this" });
  assert.deepEqual(matchStrengthStatus(40), { tier: "check", label: "Check this" });
});

test("matchStrengthStatus: low score asks for verification, plainly", () => {
  assert.deepEqual(matchStrengthStatus(39), { tier: "low", label: "Low confidence - please verify" });
  assert.deepEqual(matchStrengthStatus(0), { tier: "low", label: "Low confidence - please verify" });
});

// --- Scenario coverage required by the build task -------------------------

test("scenario: everything confirmed renders all-green across every general-tender classifier", () => {
  const company = answerStatus(true, false);
  const question = answerStatus(true, true);
  const role = roleStatus({ taggedCount: 1, taggedWithCvCount: 1 });
  const signature = signatureAnswerStatus({ chosenId: "p1", chosenPerson: { name: "Jane Soap", signatory_capacity: "Director" }, optional: false });
  const doc = docItemStatus("have");
  const locality = localityStatus({ matchStatus: "matched", mandatory: true, disqualifies: true });

  for (const r of [company.status, question.status, role.reviewStatus, signature.reviewStatus, doc.reviewStatus, locality.reviewStatus]) {
    assert.equal(r, "confirmed");
  }
  for (const c of [role.checklistStatus, signature.checklistStatus, doc.checklistStatus, locality.checklistStatus]) {
    assert.equal(c, "included");
  }
});

test("scenario: missing signatory / nobody tagged for a role / no local office shows the right mixed statuses", () => {
  // A required company field never filled in.
  const company = answerStatus(false, false);
  assert.equal(company.status, "missing");

  // Nobody tagged at all for a role the tender names.
  const role = roleStatus({ taggedCount: 0, taggedWithCvCount: 0 });
  assert.equal(role.reviewStatus, "missing");
  assert.equal(role.checklistStatus, "not_included");

  // Nobody chosen to sign yet.
  const signature = signatureAnswerStatus({ chosenId: null, chosenPerson: null, optional: false });
  assert.equal(signature.reviewStatus, "missing");

  // A document the tender asks for isn't in the vault.
  const doc = docItemStatus("missing");
  assert.equal(doc.reviewStatus, "missing");

  // A mandatory local office the company doesn't have, but not disqualifying by itself here - still only a warning.
  const locality = localityStatus({ matchStatus: "no_match", mandatory: true, disqualifies: false });
  assert.equal(locality.reviewStatus, "warning");

  const statuses = [company.status, role.reviewStatus, signature.reviewStatus, doc.reviewStatus, locality.reviewStatus];
  assert.ok(statuses.includes("missing"));
  assert.ok(statuses.includes("warning"));
  assert.ok(!statuses.every((s) => s === "confirmed"));
});
