/**
 * Pure logic tests for hasNoTaggedDisciplines() - mirrors exactly what
 * engine/discovery/company_profiles.py's profile_from_company_rows() computes
 * for `known_disciplines`, just read from the app side. See
 * disciplineTaggingNudge.ts's own header comment for the full cross-reference.
 *
 * Run: node --experimental-strip-types --test app/lib/disciplineTaggingNudge.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { hasNoTaggedDisciplines } from "./disciplineTaggingNudge.ts";

test("no experience items at all -> no tagged disciplines", () => {
  assert.equal(hasNoTaggedDisciplines([]), true);
});

test("items exist but none tagged -> no tagged disciplines", () => {
  assert.equal(
    hasNoTaggedDisciplines([
      { tagged_at: null, disciplines: null },
      { tagged_at: null, disciplines: ["roads_civil"] }, // untagged - disciplines on the row don't count yet
    ]),
    true,
  );
});

test("a tagged item with an empty disciplines array still doesn't count", () => {
  assert.equal(hasNoTaggedDisciplines([{ tagged_at: "2026-10-01", disciplines: [] }]), true);
  assert.equal(hasNoTaggedDisciplines([{ tagged_at: "2026-10-01", disciplines: null }]), true);
});

test("one tagged item with a real discipline -> known disciplines exist", () => {
  assert.equal(
    hasNoTaggedDisciplines([
      { tagged_at: null, disciplines: null },
      { tagged_at: "2026-10-01", disciplines: ["roads_civil"] },
    ]),
    false,
  );
});

test("mixed tagged/untagged items, only the tagged one has disciplines", () => {
  assert.equal(
    hasNoTaggedDisciplines([
      { tagged_at: "2026-10-01", disciplines: [] },
      { tagged_at: null, disciplines: ["it_telecoms"] },
      { tagged_at: "2026-10-02", disciplines: ["professional_services"] },
    ]),
    false,
  );
});
