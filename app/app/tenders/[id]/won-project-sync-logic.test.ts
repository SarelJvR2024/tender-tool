/**
 * Regression test for won-project-sync-logic.ts - QA-Edge-Case-Findings.md,
 * 2026-10-19 (fifteenth run): syncWonProjectToTeam's re-sync left a
 * reassigned-away person's `projects` row behind forever, still claiming
 * they worked the project. staleSyncedProjectRows() is what now finds those
 * rows so actions.ts can delete them before the fresh upsert.
 *
 * Run: node --experimental-strip-types --test "app/app/tenders/[id]/won-project-sync-logic.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { staleSyncedProjectRows } from "./won-project-sync-logic.ts";

test("first sync ever: no existing rows, nothing is stale", () => {
  const confirmed = [{ position_code: "PL", confirmed_person_id: "henning" }];
  assert.deepEqual(staleSyncedProjectRows(confirmed, []), []);
});

test("re-sync with nothing changed: the matching row is NOT stale", () => {
  const confirmed = [{ position_code: "PL", confirmed_person_id: "henning" }];
  const existing = [{ id: "row1", person_id: "henning", position_code: "PL" }];
  assert.deepEqual(staleSyncedProjectRows(confirmed, existing), []);
});

test("the real bug: a position reassigned to a different person leaves the old person's row stale", () => {
  const confirmed = [{ position_code: "PL", confirmed_person_id: "jane" }]; // reassigned from henning to jane
  const existing = [{ id: "row1", person_id: "henning", position_code: "PL" }];
  const stale = staleSyncedProjectRows(confirmed, existing);
  assert.equal(stale.length, 1, "henning's old row for PL must be flagged stale");
  assert.equal(stale[0].id, "row1");
});

test("a position un-confirmed entirely (nobody assigned any more) leaves its old row stale", () => {
  const confirmed: { position_code: string; confirmed_person_id: string }[] = []; // PL un-confirmed
  const existing = [{ id: "row1", person_id: "henning", position_code: "PL" }];
  const stale = staleSyncedProjectRows(confirmed, existing);
  assert.equal(stale.length, 1);
});

test("multiple positions: only the ones that actually changed are stale, not the whole pack", () => {
  const confirmed = [
    { position_code: "PL", confirmed_person_id: "henning" }, // unchanged
    { position_code: "DS1", confirmed_person_id: "jane" }, // reassigned from mark to jane
  ];
  const existing = [
    { id: "row-pl", person_id: "henning", position_code: "PL" },
    { id: "row-ds1", person_id: "mark", position_code: "DS1" },
  ];
  const stale = staleSyncedProjectRows(confirmed, existing);
  assert.deepEqual(stale.map((r) => r.id), ["row-ds1"]);
});

test("a position with two never-realistic duplicate existing rows: both are checked independently, never assumed unique", () => {
  // Defensive: the partial unique index should prevent this, but the pure
  // function itself must not assume at most one existing row per position.
  const confirmed = [{ position_code: "PL", confirmed_person_id: "jane" }];
  const existing = [
    { id: "row1", person_id: "henning", position_code: "PL" },
    { id: "row2", person_id: "mark", position_code: "PL" },
  ];
  const stale = staleSyncedProjectRows(confirmed, existing);
  assert.deepEqual(stale.map((r) => r.id).sort(), ["row1", "row2"]);
});
