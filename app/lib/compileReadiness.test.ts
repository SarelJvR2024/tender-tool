/**
 * Regression test for compileReadiness.ts - the honest (never-fabricated)
 * compile-readiness status and banded confidence shown on
 * /admin/discovered-opportunities. Pure, no Supabase, same
 * `node --experimental-strip-types --test` pattern as onboardingScan.test.ts.
 *
 * Run: node --experimental-strip-types --test app/lib/compileReadiness.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessCompileConfidence,
  assessCompileReadiness,
  effectiveConfidence,
  type CompileReadinessInput,
} from "./compileReadiness.ts";

const base: CompileReadinessInput = {
  source: "etenders_portal",
  document_urls: [{ url: "https://example/book1.pdf", title: "Book 1" }],
  categories: ["roads_civils"],
  reasons: ["Matches your civil engineering discipline."],
  score_outlook: { estimable: true },
};

test("flagged: no documents listed at all", () => {
  const r = assessCompileReadiness({ ...base, document_urls: [] });
  assert.equal(r.status, "flagged");
  assert.ok(r.detail.some((d) => d.includes("No documents")));
});

test("flagged: SANRAL source is always called out, even with documents", () => {
  const r = assessCompileReadiness({ ...base, source: "sanral" });
  assert.equal(r.status, "flagged");
  assert.ok(r.detail.some((d) => d.includes("SANRAL")));
});

test("flagged: category not recognised by the taxonomy", () => {
  const r = assessCompileReadiness({ ...base, categories: ["uncategorized"] });
  assert.equal(r.status, "flagged");
  assert.ok(r.detail.some((d) => d.includes("category")));
});

test("flagged: no reasons and no score outlook", () => {
  const r = assessCompileReadiness({ ...base, reasons: [], score_outlook: null });
  assert.equal(r.status, "flagged");
});

test("needs_documents: everything looks fine, but nothing confirms a workbook family", () => {
  const r = assessCompileReadiness(base);
  assert.equal(r.status, "needs_documents");
});

test("looks_ready: a listed document title matches a known SANRAL workbook pattern", () => {
  const r = assessCompileReadiness({
    ...base,
    document_urls: [{ url: "https://example/technical.xlsm", title: "Technical Submission.xlsm" }],
  });
  assert.equal(r.status, "looks_ready");
});

test("looks_ready never claims certainty - its own detail says 'guess'", () => {
  const r = assessCompileReadiness({
    ...base,
    document_urls: [{ url: null, title: "Financial Submission workbook" }],
  });
  assert.equal(r.status, "looks_ready");
  assert.ok(r.detail.join(" ").toLowerCase().includes("guess"));
});

test("confidence: capped at 40 when requirements were never extracted, even with every other signal green", () => {
  const c = assessCompileConfidence(base, null);
  assert.ok(c.level <= 40, c.level);
  assert.equal(c.band, c.level >= 40 ? "medium" : "low");
});

test("confidence: a matched SANRAL family + ok fingerprint scores high", () => {
  const c = assessCompileConfidence(base, {
    status: "extracted", route: "sanral", family: "Conventional Consultant Tender",
    fingerprint_status: "ok", missing: [], unreadable_documents: [], failed_downloads: 0,
  });
  assert.ok(c.level >= 70, c.level);
  assert.equal(c.band, "high");
});

test("confidence: a fingerprint mismatch drags the score down hard, even with a matched family", () => {
  const c = assessCompileConfidence(base, {
    status: "extracted", route: "sanral", family: "Conventional Consultant Tender",
    fingerprint_status: "mismatch", missing: [], unreadable_documents: [], failed_downloads: 0,
  });
  assert.ok(c.level < 50, c.level);
});

test("confidence: missing required documents reduce the score, capped at -30 total", () => {
  const c1 = assessCompileConfidence(base, {
    status: "extracted", route: "sanral", family: "Conventional Consultant Tender",
    fingerprint_status: "ok", missing: ["A-Forms"], unreadable_documents: [], failed_downloads: 0,
  });
  const c5 = assessCompileConfidence(base, {
    status: "extracted", route: "sanral", family: "Conventional Consultant Tender",
    fingerprint_status: "ok", missing: ["A-Forms", "B", "C", "D", "E"], unreadable_documents: [], failed_downloads: 0,
  });
  assert.ok(c1.level > c5.level);
  assert.equal(c1.level - c5.level, 20); // -10 for 1 missing vs the -30 cap for 5 missing
});

test("confidence: a general route scores lower than a matched SANRAL family, all else equal", () => {
  const sanral = assessCompileConfidence(base, {
    status: "extracted", route: "sanral", family: "RRM Consultant Tender",
    fingerprint_status: "ok", missing: [], unreadable_documents: [], failed_downloads: 0,
  });
  const general = assessCompileConfidence(base, {
    status: "extracted", route: "general", family: null,
    fingerprint_status: null, missing: [], unreadable_documents: [], failed_downloads: 0,
  });
  assert.ok(general.level < sanral.level);
});

test("effectiveConfidence: Sarel's override always wins over the computed number", () => {
  const computed = assessCompileConfidence(base, null);
  const eff = effectiveConfidence(computed, { level: 90, note: "Checked by hand, it's fine." });
  assert.equal(eff.level, 90);
  assert.equal(eff.isOverridden, true);
  assert.equal(eff.note, "Checked by hand, it's fine.");
});

test("effectiveConfidence: no override falls back to the computed value untouched", () => {
  const computed = assessCompileConfidence(base, null);
  const eff = effectiveConfidence(computed, null);
  assert.equal(eff.level, computed.level);
  assert.equal(eff.isOverridden, false);
});
