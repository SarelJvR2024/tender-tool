/**
 * Regression test for tenderScope.ts's scopeNeedsHumanReview() - whether a
 * tender_scope_records row's AI-extracted scope_summary is still flagged as
 * unverified (engine/discovery/scope_llm.py's mandatory review loop, per
 * docs/specs/AI-Call-Quality-Standard.md). Pure, no Supabase, same
 * `node --experimental-strip-types --test` pattern as compileReadiness.test.ts.
 *
 * Run: node --experimental-strip-types --test app/lib/tenderScope.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { scopeNeedsHumanReview } from "./tenderScope.ts";

test("null source_note (no enrichment row, or the regex/description-text path) - not flagged", () => {
  assert.equal(scopeNeedsHumanReview(null), false);
});

test("undefined source_note - not flagged (same honest default as null)", () => {
  assert.equal(scopeNeedsHumanReview(undefined), false);
});

test("empty-string source_note - not flagged", () => {
  assert.equal(scopeNeedsHumanReview(""), false);
});

test("a plain value-band note with no scope note at all - not flagged", () => {
  assert.equal(
    scopeNeedsHumanReview('Stated in the tender\'s own text: "estimated at R12 million".'),
    false,
  );
});

test("a clean LLM-extracted note (review loop found nothing wrong) - not flagged", () => {
  assert.equal(scopeNeedsHumanReview("LLM-extracted scope summary (1 review pass(es))."), false);
});

test("the real shape tender_enrichment.py's run() actually writes when the review loop still found an issue on the last pass - flagged", () => {
  const note =
    'LLM-extracted scope summary (3 review pass(es)). NEEDS HUMAN REVIEW (3 pass(es) run) - ' +
    'Quote "upgrade of a 12km gravel road" could not be matched to the source text.';
  assert.equal(scopeNeedsHumanReview(note), true);
});

test("the real shape when it's the programmatic evidence-quote check (not the model's own review pass) that fails - still flagged", () => {
  const note =
    "LLM-extracted scope summary (1 review pass(es)). NEEDS HUMAN REVIEW (1 pass(es) run) - " +
    "Programmatic check: at least one evidence_quotes entry could not be found in the document text.";
  assert.equal(scopeNeedsHumanReview(note), true);
});

test("source_note combined with a value-band note first (source_note = value_note | scope_note, per tender_enrichment.enrich()) - still flagged", () => {
  const note =
    'Stated in the tender\'s own text: "R12 million". | LLM-extracted scope summary (3 review pass(es)). ' +
    "NEEDS HUMAN REVIEW (3 pass(es) run) - reads generic.";
  assert.equal(scopeNeedsHumanReview(note), true);
});
