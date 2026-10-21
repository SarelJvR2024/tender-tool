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
  cidbNameMismatchWarning,
  DOCUMENT_KINDS,
  isFieldPersisted,
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

// QA-Edge-Case-Findings.md, 2026-10-18 (thirteenth run): several KIND_FIELDS
// entries (cidb_registration/registration_number+contractor_name,
// bbbee_certificate/entity_name, bank_confirmation_letter/bank_name+
// account_holder, iso_9001_certificate/certified_entity_name) had no
// companies column at all - confirmVaultDocument silently dropped them while
// the review screen showed a tick-box and "Confirm and file" exactly like
// a field that IS saved. isFieldPersisted() is what review.tsx uses to tell
// the two apart; this pins its answer for every real field so a future
// column addition (or removal) is caught here, not discovered by a
// reviewer whose confirmed value silently vanished.
test("isFieldPersisted: every VAULT_FIELD_COLUMNS mapping is persisted", () => {
  for (const kind of VAULT_KINDS) {
    for (const field of Object.keys(VAULT_FIELD_COLUMNS[kind])) {
      assert.ok(isFieldPersisted(kind, field), `${kind}.${field} is in VAULT_FIELD_COLUMNS but isFieldPersisted says no`);
    }
  }
});

test("isFieldPersisted: bee_level is persisted despite not being a VAULT_FIELD_COLUMNS key (companies.bee_level is a plain int column, applied as a special case in actions.ts)", () => {
  assert.ok(isFieldPersisted("bbbee_certificate", "bee_level"));
});

// Migration 0069 closed every one of the thirteenth run's six gaps with a
// real companies column (cidb_registration_number, cidb_contractor_name,
// bee_entity_name, bank_confirmation_bank_name,
// bank_confirmation_account_holder, iso_9001_certified_entity_name) - these
// now persist, which is the whole point of adding the columns.
test("isFieldPersisted: the six previously-orphaned fields are now persisted (migration 0069)", () => {
  assert.equal(isFieldPersisted("cidb_registration", "registration_number"), true);
  assert.equal(isFieldPersisted("cidb_registration", "contractor_name"), true);
  assert.equal(isFieldPersisted("bbbee_certificate", "entity_name"), true);
  assert.equal(isFieldPersisted("bank_confirmation_letter", "bank_name"), true);
  assert.equal(isFieldPersisted("bank_confirmation_letter", "account_holder"), true);
  assert.equal(isFieldPersisted("iso_9001_certificate", "certified_entity_name"), true);
});

test("VAULT_FIELD_COLUMNS: the six newly-persisted fields map onto the real migration-0069 column names", () => {
  assert.equal(VAULT_FIELD_COLUMNS.cidb_registration.registration_number, "cidb_registration_number");
  assert.equal(VAULT_FIELD_COLUMNS.cidb_registration.contractor_name, "cidb_contractor_name");
  assert.equal(VAULT_FIELD_COLUMNS.bbbee_certificate.entity_name, "bee_entity_name");
  assert.equal(VAULT_FIELD_COLUMNS.bank_confirmation_letter.bank_name, "bank_confirmation_bank_name");
  assert.equal(VAULT_FIELD_COLUMNS.bank_confirmation_letter.account_holder, "bank_confirmation_account_holder");
  assert.equal(VAULT_FIELD_COLUMNS.iso_9001_certificate.certified_entity_name, "iso_9001_certified_entity_name");
});

test("isFieldPersisted: every KIND_FIELDS entry for every vault kind is accounted for as persisted or not (never throws, never silently undefined)", () => {
  for (const kind of VAULT_KINDS) {
    for (const field of KIND_FIELDS[kind]) {
      assert.equal(typeof isFieldPersisted(kind, field), "boolean", `${kind}.${field} should resolve to a real boolean`);
    }
  }
});

// ---------------------------------------------------------------------------
// cidbNameMismatchWarning() - the one genuinely new feature in this pass
// (QA-Edge-Case-Findings.md, thirteenth run: "a mismatched contractor_name
// on a CIDB certificate is a real compliance signal, not just metadata").
// Never a blocker - these tests only pin when it warns vs. stays silent.
// ---------------------------------------------------------------------------

test("cidbNameMismatchWarning: exact match - no warning", () => {
  assert.equal(cidbNameMismatchWarning("Klipcorp Construction (Pty) Ltd", "Klipcorp Construction (Pty) Ltd"), null);
});

test("cidbNameMismatchWarning: formatting-only difference (missing/extra legal suffix) - no warning", () => {
  assert.equal(cidbNameMismatchWarning("Klipcorp Construction Pty Ltd", "Klipcorp Construction (Pty) Ltd"), null);
  assert.equal(cidbNameMismatchWarning("Klipcorp Construction", "Klipcorp Construction (Pty) Ltd"), null);
  assert.equal(cidbNameMismatchWarning("KLIPCORP CONSTRUCTION (PTY) LTD.", "klipcorp construction pty ltd"), null);
  assert.equal(cidbNameMismatchWarning("Acme Trading CC", "Acme Trading Close Corporation"), null);
});

test("cidbNameMismatchWarning: real mismatch - warns, names both values, never throws", () => {
  const warning = cidbNameMismatchWarning("Klipcorp Construction (Pty) Ltd", "Acme Builders (Pty) Ltd");
  assert.ok(warning, "expected a warning for two unrelated names");
  assert.ok(warning!.includes("Klipcorp Construction"));
  assert.ok(warning!.includes("Acme Builders"));
});

test("cidbNameMismatchWarning: missing input never warns (nothing to compare)", () => {
  assert.equal(cidbNameMismatchWarning(null, "Klipcorp Construction (Pty) Ltd"), null);
  assert.equal(cidbNameMismatchWarning("Klipcorp Construction (Pty) Ltd", null), null);
  assert.equal(cidbNameMismatchWarning(null, null), null);
  assert.equal(cidbNameMismatchWarning("", ""), null);
});

test("cidbNameMismatchWarning: partial/trading-name overlap below the threshold still warns (surfaced, not silently accepted)", () => {
  assert.ok(cidbNameMismatchWarning("Klipcorp Trading", "Klipcorp Construction (Pty) Ltd"));
});
