/**
 * Regression test for tender-readiness.ts - the pure readiness-score /
 * Verify-Provide-Fix flattening behind the tender workspace's unified
 * header. No network, no database, same spirit as pack-review-logic.test.ts.
 *
 * Run: node --experimental-strip-types --test app/app/tenders/[id]/tender-readiness.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeTenderReadiness } from "./tender-readiness.ts";
import type { ReviewSection } from "./pack-review-data";

function section(overrides: Partial<ReviewSection>): ReviewSection {
  return { key: "s", title: "Section", changeHref: "#s", changeLabel: "Change", items: [], error: null, ...overrides };
}

test("no sections at all is 100% ready, nothing left", () => {
  const r = computeTenderReadiness([]);
  assert.deepEqual(r, { score: 100, totalCount: 0, confirmedCount: 0, thingsLeft: 0, fix: [], provide: [], verify: [] });
});

test("a section that failed to load contributes nothing to the count", () => {
  const r = computeTenderReadiness([section({ error: "Couldn't load this section: boom", items: [{ key: "x", label: "X", value: null, status: "confirmed", note: null }] })]);
  assert.equal(r.totalCount, 0);
  assert.equal(r.score, 100);
});

test("every item confirmed is a 100% score, nothing left", () => {
  const sections = [
    section({ key: "company", title: "Company master data", changeHref: "/company", changeLabel: "Open company profile", items: [
      { key: "legal_name", label: "Legal name", value: "Klipcorp (Pty) Ltd", status: "confirmed", note: null },
    ] }),
  ];
  const r = computeTenderReadiness(sections);
  assert.equal(r.score, 100);
  assert.equal(r.thingsLeft, 0);
  assert.equal(r.verify.length, 1);
  assert.equal(r.verify[0].confirmed, true);
  assert.equal(r.verify[0].sourceLabel, "Company master data");
  assert.equal(r.verify[0].changeHref, "/company");
});

test("a mix of statuses buckets correctly and the score is the confirmed fraction", () => {
  const sections = [
    section({
      key: "documents",
      title: "Supporting & vault documents",
      changeHref: "#tender-templates",
      items: [
        { key: "csd", label: "CSD registration", value: "On file", status: "confirmed", note: null }, // verify, confirmed
        { key: "bbee", label: "B-BBEE certificate", value: null, status: "missing", note: "Expired on file" }, // fix (missing)
        { key: "bank", label: "Bank confirmation letter", value: null, status: "needs_input", note: "Not on file" }, // provide
        { key: "tax", label: "SARS tax compliance", value: "PIN on file", status: "assumed_default", note: "Confirm it's still valid" }, // verify, unconfirmed
      ],
    }),
  ];
  const r = computeTenderReadiness(sections);
  assert.equal(r.totalCount, 4);
  assert.equal(r.confirmedCount, 1);
  assert.equal(r.score, 25); // 1 of 4
  assert.equal(r.thingsLeft, 3);
  assert.equal(r.fix.length, 1);
  assert.equal(r.fix[0].key, "bbee");
  assert.equal(r.provide.length, 1);
  assert.equal(r.provide[0].key, "bank");
  assert.equal(r.verify.length, 2);
  assert.ok(r.verify.some((i) => i.key === "csd" && i.confirmed));
  assert.ok(r.verify.some((i) => i.key === "tax" && !i.confirmed));
});

test("score rounds to the nearest whole number", () => {
  const items = Array.from({ length: 3 }, (_, i) => ({ key: `k${i}`, label: `K${i}`, value: null, status: (i === 0 ? "confirmed" : "missing") as const, note: null }));
  const r = computeTenderReadiness([section({ items })]);
  assert.equal(r.totalCount, 3);
  assert.equal(r.confirmedCount, 1);
  assert.equal(r.score, 33); // 1/3 = 33.33... -> rounds to 33
});
