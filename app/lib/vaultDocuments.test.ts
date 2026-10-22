/**
 * Pin spec v3 Batch 2's new VAULT_KIND_TO_DOCUMENT_KIND mapping: which of
 * the 7 Document Vault rows (DocumentRow.tsx) route through the AI
 * classify-and-review pipeline instead of the old direct-to-column upload.
 *
 * Run: node --experimental-strip-types --test lib/vaultDocuments.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { VAULT_DOCUMENTS, VAULT_KIND_TO_DOCUMENT_KIND } from "./vaultDocuments.ts";
import { VAULT_KINDS } from "./onboardingScan.ts";

test("every VAULT_KIND_TO_DOCUMENT_KIND value is a real onboardingScan vault-routable DocumentKind", () => {
  for (const documentKind of Object.values(VAULT_KIND_TO_DOCUMENT_KIND)) {
    assert.ok(VAULT_KINDS.includes(documentKind as (typeof VAULT_KINDS)[number]), `${documentKind} is not in onboardingScan's VAULT_KINDS`);
  }
});

test("coid is deliberately NOT mapped - the classifier has no document_kind entry for it (see the mapping's own comment)", () => {
  assert.equal(VAULT_KIND_TO_DOCUMENT_KIND.coid, undefined);
});

test("every other Document Vault kind IS mapped - a silent gap here would mean a row quietly keeps the old silent-overwrite behaviour", () => {
  const unmapped = (Object.keys(VAULT_DOCUMENTS) as (keyof typeof VAULT_DOCUMENTS)[]).filter(
    (k) => k !== "coid" && !VAULT_KIND_TO_DOCUMENT_KIND[k],
  );
  assert.deepEqual(unmapped, []);
});

test("the mapping has exactly 6 entries (7 vault kinds minus coid)", () => {
  assert.equal(Object.keys(VAULT_KIND_TO_DOCUMENT_KIND).length, 6);
});
