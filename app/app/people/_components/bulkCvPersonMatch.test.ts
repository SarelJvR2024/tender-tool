/**
 * Regression test for bulkCvPersonMatch.ts - Finding 492:
 * bestPersonMatch() used raw substring matching, so a short name that is a
 * literal prefix of a different, longer person's name false-positive
 * matched a CV filename meant for the longer name (e.g. "Pieter Nel"'s own
 * "nel" part matching inside "Pieter_Nelson_CV.pdf").
 *
 * Run: node --experimental-strip-types --test "app/app/people/_components/bulkCvPersonMatch.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { bestPersonMatch } from "./bulkCvPersonMatch.ts";

test("no people at all: no match", () => {
  assert.equal(bestPersonMatch("Pieter_Nelson_CV.pdf", []), null);
});

test("a straightforward exact-name filename matches", () => {
  const people = [{ id: "p1", name: "Pieter Nelson" }];
  assert.equal(bestPersonMatch("Pieter_Nelson_CV.pdf", people)?.id, "p1");
});

test("the real bug: a short name that is a substring of a longer one no longer false-positive matches", () => {
  const people = [
    { id: "nel", name: "Pieter Nel" },
    { id: "nelson", name: "Pieter Nelson" },
  ];
  // Before the fix: "nel" is a substring of "nelson", so "Pieter Nel" (sorted
  // first) wrongly won this match every time, regardless of order.
  assert.equal(bestPersonMatch("Pieter_Nelson_CV.pdf", people)?.id, "nelson");
});

test("the real bug, same shape, the short name still correctly matches its OWN exact filename", () => {
  const people = [
    { id: "nel", name: "Pieter Nel" },
    { id: "nelson", name: "Pieter Nelson" },
  ];
  assert.equal(bestPersonMatch("Pieter_Nel_CV.pdf", people)?.id, "nel");
});

test("separators (underscore, hyphen, dot, space) are all treated as word breaks", () => {
  const people = [{ id: "p1", name: "Jane Smith" }];
  assert.equal(bestPersonMatch("jane-smith.cv.pdf", people)?.id, "p1");
  assert.equal(bestPersonMatch("JANE SMITH CV.docx", people)?.id, "p1");
});

test("a filename missing one real name part doesn't match", () => {
  const people = [{ id: "p1", name: "Jane Smith" }];
  assert.equal(bestPersonMatch("Jane_Resume.pdf", people), null);
});

test("a single-word person name (one part <= 2 chars ignored, matches on the rest)", () => {
  const people = [{ id: "p1", name: "Jo Anderson" }];
  // "Jo" is <= 2 chars and excluded from the required parts - "anderson" alone decides it.
  assert.equal(bestPersonMatch("Anderson_CV.pdf", people)?.id, "p1");
});

test("first match wins when a filename could plausibly match more than one person", () => {
  const people = [
    { id: "p1", name: "Jane Smith" },
    { id: "p2", name: "Jane Smithson" },
  ];
  assert.equal(bestPersonMatch("Jane_Smith_CV.pdf", people)?.id, "p1");
});
