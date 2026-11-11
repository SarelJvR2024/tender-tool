/**
 * Regression test for position-cv-jobs-logic.ts - Finding 402: page.tsx's
 * own "Key positions" card listed every generated_cvs job matching a
 * position's code, with no check that the job belongs to the CURRENTLY
 * confirmed person for that position - the same "stale reassignment" shape
 * won-project-sync-logic.ts's staleSyncedProjectRows() already fixed for
 * `projects` rows. cvJobsForPosition() is what the card now filters
 * through instead of a bare `.filter((g) => g.position_code === code)`.
 *
 * Run: node --experimental-strip-types --test "app/app/tenders/[id]/position-cv-jobs-logic.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { cvJobsForPosition } from "./position-cv-jobs-logic.ts";

test("no jobs at all: returns empty", () => {
  assert.deepEqual(cvJobsForPosition([], "PL", "henning"), []);
});

test("matching job for the currently confirmed person: returned", () => {
  const jobs = [{ id: "job1", position_code: "PL", person_id: "henning" }];
  assert.deepEqual(cvJobsForPosition(jobs, "PL", "henning"), jobs);
});

test("the real bug: a position reassigned to a different person no longer shows the old person's job", () => {
  // PL was Henning's; it has since been reassigned to Jane, who has no
  // generated CV of her own yet.
  const jobs = [{ id: "job1", position_code: "PL", person_id: "henning" }];
  assert.deepEqual(cvJobsForPosition(jobs, "PL", "jane"), []);
});

test("a position with jobs for both the old and new person: only the new person's job shows", () => {
  const jobs = [
    { id: "job-old", position_code: "PL", person_id: "henning" },
    { id: "job-new", position_code: "PL", person_id: "jane" },
  ];
  assert.deepEqual(cvJobsForPosition(jobs, "PL", "jane").map((j) => j.id), ["job-new"]);
});

test("position currently unconfirmed (nobody assigned): no job shown even if an old one exists", () => {
  const jobs = [{ id: "job1", position_code: "PL", person_id: "henning" }];
  assert.deepEqual(cvJobsForPosition(jobs, "PL", null), []);
});

test("a different position's job with the same person is never mixed in", () => {
  const jobs = [{ id: "job1", position_code: "DS1", person_id: "henning" }];
  assert.deepEqual(cvJobsForPosition(jobs, "PL", "henning"), []);
});

test("multiple historical jobs for the same confirmed person: all of them show (real job history, not just the latest)", () => {
  const jobs = [
    { id: "job1", position_code: "PL", person_id: "henning" },
    { id: "job2", position_code: "PL", person_id: "henning" },
  ];
  assert.deepEqual(cvJobsForPosition(jobs, "PL", "henning").map((j) => j.id).sort(), ["job1", "job2"]);
});
