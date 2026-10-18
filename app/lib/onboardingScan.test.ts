/**
 * Regression test for onboardingScan.ts - the routing-to-existing-table
 * mapping for the bulk onboarding document scan (migration 0063). Pure, no
 * Supabase, same pattern as pack-review-logic.test.ts / signatory-logic.test.ts.
 *
 * What this actually proves: every v1 document kind maps onto a REAL,
 * already-existing companies/* column (never a made-up one), the CIDB
 * correction (companies.cidb_* , not held_registrations) is encoded, the
 * two out-of-scope kinds are excluded from the routable set, and
 * parseBeeLevel() (companies.bee_level is an int; the model returns text
 * like "Level 2") behaves on real and edge-case input.
 *
 * Run: node --experimental-strip-types --test app/lib/onboardingScan.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DOCUMENT_KINDS,
  KIND_FIELDS,
  ROUTABLE_KINDS,
  UNROUTED_KINDS,
  VAULT_DOCUMENT_COLUMN,
  VAULT_FIELD_COLUMNS,
  VAULT_KINDS,
  VAULT_SUBFOLDER,
  parseBeeLevel,
} from "./onboardingScan.ts";

test("every DOCUMENT_KINDS entry is either routable or explicitly unrouted, never neither or both", () => {
  for (const kind of DOCUMENT_KINDS) {
    const routable = ROUTABLE_KINDS.includes(kind);
    const unrouted = UNROUTED_KINDS.includes(kind);
    assert.ok(routable !== unrouted, `${kind}: must be exactly one of routable/unrouted (got routable=${routable}, unrouted=${unrouted})`);
  }
});

test("CIDB routes to companies.cidb_* columns, not held_registrations (the task's own v1 mapping was wrong - see migration 0063's header)", () => {
  assert.equal(VAULT_DOCUMENT_COLUMN.cidb_registration, "cidb_document_path");
  assert.equal(VAULT_FIELD_COLUMNS.cidb_registration.expiry_date, "cidb_expiry");
  assert.equal(VAULT_FIELD_COLUMNS.cidb_registration.grade_class, "cidb_grading");
});

test("every vault kind's field columns are a subset of its own KIND_FIELDS - never writes a field the model wasn't even asked for", () => {
  for (const kind of VAULT_KINDS) {
    const askedFor = new Set(KIND_FIELDS[kind]);
    for (const field of Object.keys(VAULT_FIELD_COLUMNS[kind])) {
      assert.ok(askedFor.has(field), `${kind}: routes field "${field}" that isn't in KIND_FIELDS[${kind}]`);
    }
  }
});

test("every vault kind has exactly one document-path column and one storage subfolder", () => {
  for (const kind of VAULT_KINDS) {
    assert.ok(VAULT_DOCUMENT_COLUMN[kind], `${kind}: missing a document-path column`);
    assert.ok(VAULT_SUBFOLDER[kind], `${kind}: missing a storage subfolder`);
  }
});

test("the real v1 compliance document kinds (everything except id_document/cv/experience_reference_letter, each routed to their own dedicated table) are all vault kinds", () => {
  const nonVaultRoutable = ROUTABLE_KINDS.filter((k) => !VAULT_KINDS.includes(k));
  assert.deepEqual(new Set(nonVaultRoutable), new Set(["id_document", "cv", "experience_reference_letter"]));
});

test("professional_registration_other and unknown are the only unrouted kinds (ECSA/SACPCMP/PSIRA etc. out of v1 scope per the task)", () => {
  assert.deepEqual(new Set(UNROUTED_KINDS), new Set(["professional_registration_other", "unknown"]));
});

test("parseBeeLevel: real-world forms", () => {
  assert.equal(parseBeeLevel("Level 2"), 2);
  assert.equal(parseBeeLevel("Level 1"), 1);
  assert.equal(parseBeeLevel("8"), 8);
});

test("parseBeeLevel: null/empty/non-compliant never crash and never fabricate a level", () => {
  assert.equal(parseBeeLevel(null), null);
  assert.equal(parseBeeLevel(""), null);
  assert.equal(parseBeeLevel("Non-compliant"), null);
});
