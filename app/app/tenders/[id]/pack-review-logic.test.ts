/**
 * Regression test for pack-review-logic.ts - the pure classification rules
 * behind the Pack Review card (pack-review.tsx). No network, no database,
 * same "real logic, no mocks" spirit as engine/test_form_field_audit.py.
 *
 * Run: node --experimental-strip-types --test app/app/tenders/[id]/pack-review-logic.test.ts
 * (Node 22's built-in test runner + type-stripping - no extra test
 * dependency needed; there is no jest/vitest in this repo yet, and the
 * assembly function itself is a thin Supabase-reading shell around these
 * pure helpers, which is where the actual classification decisions live.)
 *
 * Covers the two scenarios the build task asked for:
 *   - everything confirmed (all green)
 *   - missing CV / missing signatory / a B7 warning (mixed statuses)
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  b7Status,
  docItemStatus,
  fieldStatus,
  humanizeFieldKey,
  positionStatus,
  provenanceStatus,
  reviewStatusToBidTask,
  signatureStatus,
} from "./pack-review-logic.ts";

test("fieldStatus: a required field on file is confirmed", () => {
  assert.deepEqual(fieldStatus("Klipcorp (Pty) Ltd", true), { status: "confirmed", note: null });
});

test("fieldStatus: a required field missing is 'missing', an optional one is 'needs_input'", () => {
  assert.equal(fieldStatus(null, true).status, "missing");
  assert.equal(fieldStatus(null, false).status, "needs_input");
  assert.equal(fieldStatus(undefined, true).status, "missing");
  assert.equal(fieldStatus("", true).status, "missing");
});

test("fieldStatus: 0 is a real value, not empty", () => {
  assert.equal(fieldStatus(0, false).status, "confirmed");
});

test("provenanceStatus maps field_provenance's four statuses", () => {
  assert.equal(provenanceStatus("confirmed"), "confirmed");
  // QA finding, 2026-10-26: "computed" (mechanically derived, no human
  // judgment call - 0002_field_provenance.sql's own table comment) must NOT
  // collapse into "confirmed" (a human entered/approved it) - that silently
  // fed tender-readiness.ts's confirmedCount/score from values nobody ever
  // looked at. It maps to "assumed_default" instead - same Verify bucket,
  // excluded from the confirmed count.
  assert.equal(provenanceStatus("computed"), "assumed_default");
  assert.equal(provenanceStatus("assumed_default"), "assumed_default");
  assert.equal(provenanceStatus("missing"), "missing");
  assert.equal(provenanceStatus("something_unexpected"), "needs_input");
});

test("docItemStatus maps compliance-data.ts's have/check/missing onto the review + checklist vocabularies", () => {
  assert.deepEqual(docItemStatus("have"), { reviewStatus: "confirmed", checklistStatus: "included" });
  assert.deepEqual(docItemStatus("check"), { reviewStatus: "needs_input", checklistStatus: "included_warning" });
  assert.deepEqual(docItemStatus("missing"), { reviewStatus: "missing", checklistStatus: "not_included" });
});

test("positionStatus: no confirmed person is 'missing', not included", () => {
  const r = positionStatus({ hasConfirmedPerson: false, hasCv: false, fitWarning: null });
  assert.equal(r.reviewStatus, "missing");
  assert.equal(r.checklistStatus, "not_included");
});

test("positionStatus: confirmed person, no CV yet is confirmed but flagged with a warning note", () => {
  const r = positionStatus({ hasConfirmedPerson: true, hasCv: false, fitWarning: null });
  assert.equal(r.reviewStatus, "confirmed");
  assert.equal(r.checklistStatus, "included_warning");
  assert.match(r.note ?? "", /No CV on file/);
});

test("positionStatus: confirmed person with CV and no fit warning is fully included", () => {
  const r = positionStatus({ hasConfirmedPerson: true, hasCv: true, fitWarning: null });
  assert.deepEqual(r, { reviewStatus: "confirmed", checklistStatus: "included", note: null });
});

test("positionStatus: a role-fit warning overrides CV status", () => {
  const r = positionStatus({ hasConfirmedPerson: true, hasCv: true, fitWarning: "Not tagged for this role - confirm by hand." });
  assert.equal(r.reviewStatus, "warning");
  assert.equal(r.checklistStatus, "included_warning");
  assert.equal(r.note, "Not tagged for this role - confirm by hand.");
});

test("signatureStatus: no one eligible at all is missing", () => {
  const r = signatureStatus({ chosenId: null, chosenPerson: null, fallback: null });
  assert.equal(r.reviewStatus, "missing");
  assert.equal(r.checklistStatus, "not_included");
});

test("signatureStatus: nobody chosen but a fallback exists needs input, still included with a warning", () => {
  const r = signatureStatus({ chosenId: null, chosenPerson: null, fallback: { name: "Jane Soap", signatory_capacity: "Director" } });
  assert.equal(r.reviewStatus, "needs_input");
  assert.equal(r.checklistStatus, "included_warning");
  assert.match(r.note ?? "", /default to Jane Soap/);
});

// Finding (standing solution-architect review pass, 2026-11-12):
// `fallback` must always be whoever engine/pack/process_pack_jobs.py will
// ACTUALLY sign with if nobody chooses for this tender - its own
// `signatories[0]` (the company's first signatory on file, oldest
// created_at first; that engine never reads signatory_scopes at all). Both
// real callers used to pass the migration-0061 region/industry/discipline
// scope match (signatory-logic.ts's pickDefaultSignatory()) as `fallback`
// itself - so whenever a company had more than one signatory and a scope
// row made a non-first one score higher, this card's "Who signs this bid"
// value/note named a DIFFERENT person than who the real submitted pack
// would sign with, a false promise about a document the company submits.
test("signatureStatus: the true pack fallback (first signatory on file) is shown, even when a scope-matched suggestion differs", () => {
  const r = signatureStatus({
    chosenId: null,
    chosenPerson: null,
    fallback: { name: "Jane Soap", signatory_capacity: "Director" }, // signers[0] - who the pack will actually sign with
    suggestion: { name: "Henning Botha", signatory_capacity: "Regional Director" }, // the scope match - a different person
  });
  assert.equal(r.reviewStatus, "needs_input");
  assert.equal(r.checklistStatus, "included_warning");
  // The real fallback's name, never the suggestion's - this is who the pack build will actually name.
  assert.equal(r.value, "Jane Soap - Director");
  assert.match(r.note ?? "", /default to Jane Soap/);
  assert.match(r.note ?? "", /first signatory on file/);
  // The suggestion is a separate, honestly-labelled recommendation, not folded into the same claim.
  assert.match(r.note ?? "", /Henning Botha looks like a better match/);
});

test("signatureStatus: a scope-matched suggestion that agrees with the true fallback adds no redundant note", () => {
  const r = signatureStatus({
    chosenId: null,
    chosenPerson: null,
    fallback: { name: "Jane Soap", signatory_capacity: "Director" },
    suggestion: { name: "Jane Soap", signatory_capacity: "Director" },
  });
  assert.equal(r.value, "Jane Soap - Director");
  assert.doesNotMatch(r.note ?? "", /better match/);
});

test("signatureStatus: an explicit choice matching the fallback is confirmed", () => {
  const r = signatureStatus({
    chosenId: "person-1",
    chosenPerson: { name: "Jane Soap", signatory_capacity: "Director" },
    fallback: { name: "Jane Soap", signatory_capacity: "Director" },
  });
  assert.deepEqual(r, { reviewStatus: "confirmed", checklistStatus: "included", value: "Jane Soap - Director", note: null });
});

// QA pass, 2026-11-08: signatureStatus() used to show the FALLBACK's own
// name/capacity for `value` whenever ANY chosenId was set, never the
// actually-chosen person's - this is the one scenario that distinguishes
// the two (chosen and fallback are different people), which the previous
// version of this test file never constructed (its own fixture reused the
// same name for both, masking the bug).
test("signatureStatus: an explicit choice DIFFERENT from the suggested fallback shows the chosen person, not the fallback", () => {
  const r = signatureStatus({
    chosenId: "person-2",
    chosenPerson: { name: "Henning Botha", signatory_capacity: "Managing Director" },
    fallback: { name: "Jane Soap", signatory_capacity: "Director" },
  });
  assert.deepEqual(r, { reviewStatus: "confirmed", checklistStatus: "included", value: "Henning Botha - Managing Director", note: null });
});

test("signatureStatus: a chosenId that no longer resolves to a real person (deleted, or lost their signatory capacity) is missing, not a stale fallback name", () => {
  const r = signatureStatus({ chosenId: "deleted-person", chosenPerson: null, fallback: { name: "Jane Soap", signatory_capacity: "Director" } });
  assert.deepEqual(r, { reviewStatus: "missing", checklistStatus: "not_included", value: null, note: "The chosen signatory can no longer be found - choose again." });
});

test("b7Status: does not apply", () => {
  const r = b7Status({ appliesStatus: "not_required", blocker: null, warnings: [], planMode: null });
  assert.equal(r.applies, false);
  assert.equal(r.reviewStatus, "confirmed");
  assert.equal(r.checklistStatus, "not_included");
});

test("b7Status: applies and unanswered is a hard 'missing' blocker", () => {
  const r = b7Status({ appliesStatus: "required", blocker: "Form B7 applies and hasn't been answered.", warnings: [], planMode: null });
  assert.equal(r.applies, true);
  assert.equal(r.reviewStatus, "missing");
  assert.equal(r.checklistStatus, "not_included");
  assert.equal(r.value, "Not answered");
});

test("b7Status: applies, answered, but with a warning is 'warning' / included_warning", () => {
  const r = b7Status({ appliesStatus: "required", blocker: null, warnings: ["Targeted Enterprise's B-BBEE proof has expired"], planMode: "subcontract" });
  assert.equal(r.reviewStatus, "warning");
  assert.equal(r.checklistStatus, "included_warning");
  assert.equal(r.value, "subcontract");
  assert.match(r.note ?? "", /expired/);
});

test("b7Status: applies, answered cleanly is confirmed / included", () => {
  const r = b7Status({ appliesStatus: "unknown", blocker: null, warnings: [], planMode: "waived_by_tender" });
  assert.equal(r.applies, true);
  assert.deepEqual(r, { applies: true, reviewStatus: "confirmed", checklistStatus: "included", value: "waived_by_tender", note: null });
});

test("humanizeFieldKey drops the owning-script prefix and title-cases the rest", () => {
  assert.equal(humanizeFieldKey("a_forms.A8.litigation"), "A8 Litigation");
  assert.equal(humanizeFieldKey("financial_hours.Roadworks.A.PL"), "Roadworks A PL");
  assert.equal(humanizeFieldKey("signatory_person_id"), "Signatory Person Id");
});

test("reviewStatusToBidTask: confirmed and assumed_default are Verify, missing is Fix, needs_input and warning are Provide", () => {
  assert.equal(reviewStatusToBidTask("confirmed"), "verify");
  assert.equal(reviewStatusToBidTask("assumed_default"), "verify");
  assert.equal(reviewStatusToBidTask("missing"), "fix");
  assert.equal(reviewStatusToBidTask("needs_input"), "provide");
  assert.equal(reviewStatusToBidTask("warning"), "provide");
});

// --- Scenario coverage required by the build task -------------------------

test("scenario: everything confirmed renders all-green across every classifier", () => {
  const position = positionStatus({ hasConfirmedPerson: true, hasCv: true, fitWarning: null });
  const signature = signatureStatus({ chosenId: "p1", chosenPerson: { name: "Jane Soap", signatory_capacity: "Director" }, fallback: { name: "Jane Soap", signatory_capacity: "Director" } });
  const doc = docItemStatus("have");
  // Form B7 doesn't apply to this (hypothetical) tender at all - that's a
  // "confirmed, nothing to do" state, correctly rendered "not_included" on
  // the checklist (it genuinely isn't in the pack), not a gap.
  const b7 = b7Status({ appliesStatus: "not_required", blocker: null, warnings: [], planMode: null });
  // And an answered-cleanly B7 that DOES apply - fully "included".
  const b7Applies = b7Status({ appliesStatus: "required", blocker: null, warnings: [], planMode: "waived_by_tender" });
  const company = fieldStatus("Klipcorp (Pty) Ltd", true);

  for (const r of [position.reviewStatus, signature.reviewStatus, doc.reviewStatus, b7.reviewStatus, b7Applies.reviewStatus, company.status]) {
    assert.equal(r, "confirmed");
  }
  assert.equal(b7.checklistStatus, "not_included"); // doesn't apply - correctly excluded, not a gap
  for (const c of [position.checklistStatus, signature.checklistStatus, doc.checklistStatus, b7Applies.checklistStatus]) {
    assert.equal(c, "included");
  }
});

test("scenario: missing CV / missing signatory / a B7 warning shows the right mixed statuses", () => {
  // Confirmed position, no CV yet - not "missing" (a person IS confirmed), but flagged.
  const position = positionStatus({ hasConfirmedPerson: true, hasCv: false, fitWarning: null });
  assert.equal(position.reviewStatus, "confirmed");
  assert.equal(position.checklistStatus, "included_warning");

  // No one at all with a signatory capacity on file.
  const signature = signatureStatus({ chosenId: null, chosenPerson: null, fallback: null });
  assert.equal(signature.reviewStatus, "missing");
  assert.equal(signature.checklistStatus, "not_included");

  // Form B7 applies, answered, but with an outstanding warning.
  const b7 = b7Status({ appliesStatus: "required", blocker: null, warnings: ["One Targeted Enterprise's proof has lapsed"], planMode: "subcontract" });
  assert.equal(b7.reviewStatus, "warning");
  assert.equal(b7.checklistStatus, "included_warning");

  // Not every status in this mixed scenario is "confirmed" - the mix is real.
  const statuses = [position.reviewStatus, signature.reviewStatus, b7.reviewStatus];
  assert.ok(statuses.includes("missing"));
  assert.ok(statuses.includes("warning"));
  assert.ok(!statuses.every((s) => s === "confirmed"));
});
