/**
 * Regression test for lib/experienceEvidence.ts's itemQualifiesForRule() -
 * QA pass, 2026-11-09 (non-SANRAL pack rotation, Finding 234). Pure, no
 * Supabase, same `node --experimental-strip-types --test` pattern as
 * compileReadiness.test.ts.
 *
 * Run: node --experimental-strip-types --test app/lib/experienceEvidence.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateEvidence, itemQualifiesForRule, type EvidenceRule } from "./experienceEvidence.ts";

const sinceRule: EvidenceRule = {
  projects_required: 3,
  scored_per_project: false,
  window_years: null,
  since_year: 2020,
  accepted_evidence: ["completion_certificate"],
  requires_appointment_and_completion: false,
  practical_completion_excluded: false,
  scope: null,
  consequence: "points",
  quote: "completion certificates since 2020",
};

const item = (completion_date: string | null, document_type = "completion_certificate") => ({
  document_type,
  performance_rating: null,
  completion_date,
});

test("itemQualifiesForRule: right type, before the rule's since_year, does not qualify", () => {
  assert.equal(itemQualifiesForRule(sinceRule, item("2015-01-01")), false);
});

test("itemQualifiesForRule: right type, on or after since_year, qualifies", () => {
  assert.equal(itemQualifiesForRule(sinceRule, item("2020-01-01")), true);
});

test("itemQualifiesForRule: wrong document type never qualifies, since_year aside", () => {
  assert.equal(itemQualifiesForRule(sinceRule, item("2024-01-01", "award_letter")), false);
});

test("itemQualifiesForRule: a rule with no since_year accepts any date for an accepted type", () => {
  const noSince: EvidenceRule = { ...sinceRule, since_year: null };
  assert.equal(itemQualifiesForRule(noSince, item("1999-01-01")), true);
});

// The real bug: two items of the accepted type pre-date the rule's own
// since_year cutoff, so only 1 of 3 genuinely qualifies - evaluateEvidence()
// must agree with itemQualifiesForRule() on exactly that count, since every
// renderer (general-pack-review-data.ts's displayed value, compliance-
// report.tsx's chip and per-item badges) is required to use one or the
// other, never its own independent type-only filter.
test("evaluateEvidence's own qualifying count matches itemQualifiesForRule for each item, even with a since_year cutoff", () => {
  const items = [item("2023-01-01"), item("2023-06-01"), item("2015-01-01")];
  const result = evaluateEvidence({ rule: sinceRule, source: "tender_document", otherRules: 0 }, items, false);
  const expected = items.filter((i) => itemQualifiesForRule(sinceRule, i)).length;
  assert.equal(result.qualifying, 2);
  assert.equal(result.qualifying, expected);
  assert.equal(result.status, "missing");
  assert.ok(result.detail.includes("Only 2 of 3"));
});

// The real bug: score_outlook.py's _parse_evidence_window() sets `consequence`
// to "points" whenever a scoring table/ladder is found, even when the SAME
// window also matches CONSEQUENCE_DISQUALIFY_RE (e.g. Transnet-shaped text: a
// per-project points ladder PLUS "submitted with no proof at all will be
// deemed non-responsive/disqualified") - that second signal is kept in the
// rule's own `disqualification_mentioned` field, but evaluateEvidence()'s
// "missing" branch only ever read `consequence`, so a shortfall under a
// scored rule that ALSO disqualifies showed only the points framing, with no
// hint the bid could be thrown out entirely.
test("evaluateEvidence's shortfall message also flags disqualification_mentioned when consequence is 'points', not just consequence === 'disqualify'", () => {
  const rule: EvidenceRule = { ...sinceRule, scored_per_project: true, consequence: "points", disqualification_mentioned: true };
  const items = [item("2023-01-01")];
  const result = evaluateEvidence({ rule, source: "tender_document", otherRules: 0 }, items, false);
  assert.equal(result.status, "missing");
  assert.ok(result.detail.includes("disqualification"));
});

test("evaluateEvidence's shortfall message does not double up when consequence is already 'disqualify'", () => {
  const rule: EvidenceRule = { ...sinceRule, consequence: "disqualify", disqualification_mentioned: true };
  const items = [item("2023-01-01")];
  const result = evaluateEvidence({ rule, source: "tender_document", otherRules: 0 }, items, false);
  assert.equal(result.status, "missing");
  assert.ok(result.detail.includes("The tender is non-responsive without it."));
  assert.ok(!result.detail.includes("confirm whether that applies"));
});

test("evaluateEvidence's shortfall message is unchanged when disqualification_mentioned is not set", () => {
  const rule: EvidenceRule = { ...sinceRule, consequence: "points" };
  const items = [item("2023-01-01")];
  const result = evaluateEvidence({ rule, source: "tender_document", otherRules: 0 }, items, false);
  assert.equal(result.status, "missing");
  assert.ok(!/disqualif|non-responsive/i.test(result.detail));
});
