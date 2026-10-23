/**
 * Pure logic tests for the company-level opportunity-preferences PREVIEW
 * store (lib/opportunityPreferencesPreview.ts) - no Supabase, no network, no
 * browser, same "real logic, no mocks" spirit as discoveryPagination.test.ts.
 * `window`/localStorage-touching functions (readStore/writePreferences) are
 * exercised indirectly in the browser via the mounted panel component - only
 * the pure, exported helpers are unit-tested here, same split that file
 * itself documents.
 *
 * Run: node --experimental-strip-types --test app/lib/opportunityPreferencesPreview.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_PREFERENCES, sanitizePreferences, toggleDiscipline } from "./opportunityPreferencesPreview.ts";

test("sanitizePreferences: null/undefined/non-object input degrades to empty defaults", () => {
  assert.deepEqual(sanitizePreferences(null), EMPTY_PREFERENCES);
  assert.deepEqual(sanitizePreferences(undefined), EMPTY_PREFERENCES);
  assert.deepEqual(sanitizePreferences("garbage"), EMPTY_PREFERENCES);
  assert.deepEqual(sanitizePreferences(42), EMPTY_PREFERENCES);
});

test("sanitizePreferences: a well-formed object round-trips", () => {
  const out = sanitizePreferences({ hideSanral: true, disciplines: ["roads_civil", "it_telecoms"] });
  assert.equal(out.hideSanral, true);
  assert.deepEqual(out.disciplines, ["roads_civil", "it_telecoms"]);
});

test("sanitizePreferences: hideSanral only true when literally true (no truthy coercion)", () => {
  assert.equal(sanitizePreferences({ hideSanral: "yes" }).hideSanral, false);
  assert.equal(sanitizePreferences({ hideSanral: 1 }).hideSanral, false);
  assert.equal(sanitizePreferences({ hideSanral: undefined }).hideSanral, false);
});

test("sanitizePreferences: disciplines drops non-string entries and dedupes", () => {
  const out = sanitizePreferences({ disciplines: ["roads_civil", "roads_civil", 5, null, "", "it_telecoms"] });
  assert.deepEqual(out.disciplines, ["roads_civil", "it_telecoms"]);
});

test("sanitizePreferences: disciplines falls back to [] when not an array", () => {
  assert.deepEqual(sanitizePreferences({ disciplines: "roads_civil" }).disciplines, []);
  assert.deepEqual(sanitizePreferences({}).disciplines, []);
});

test("toggleDiscipline: adds a slug not already present", () => {
  assert.deepEqual(toggleDiscipline(["roads_civil"], "it_telecoms"), ["roads_civil", "it_telecoms"]);
});

test("toggleDiscipline: removes a slug already present", () => {
  assert.deepEqual(toggleDiscipline(["roads_civil", "it_telecoms"], "roads_civil"), ["it_telecoms"]);
});

test("toggleDiscipline: empty list in, one slug out", () => {
  assert.deepEqual(toggleDiscipline([], "roads_civil"), ["roads_civil"]);
});

test("toggleDiscipline: does not mutate its input array", () => {
  const input = ["roads_civil"];
  toggleDiscipline(input, "it_telecoms");
  assert.deepEqual(input, ["roads_civil"]);
});
