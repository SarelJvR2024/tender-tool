/**
 * Pin spec v3 Batch 2's new VAULT_KIND_TO_DOCUMENT_KIND mapping: which of
 * the 7 Document Vault rows (DocumentRow.tsx) route through the AI
 * classify-and-review pipeline instead of the old direct-to-column upload.
 *
 * Run: node --experimental-strip-types --test lib/vaultDocuments.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { VAULT_DOCUMENTS, VAULT_KIND_TO_DOCUMENT_KIND, sarsTcsPinOnFile, vaultDocumentMismatchWarning, vaultDocumentOnFile } from "./vaultDocuments.ts";
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

// Real incident, 2026-10-28 (Reviewer Civils & Consulting) - see
// vaultDocumentMismatchWarning's own comment for the full story.
test("vaultDocumentMismatchWarning flags the real misfiled-COID case", () => {
  const warning = vaultDocumentMismatchWarning("coid", "4b38b265-8ac8-4a8d-b115-bae49821d125-BBBEE_Affidavit.docx");
  assert.ok(warning?.includes("B-BBEE Affidavit"));
});

test("vaultDocumentMismatchWarning passes a correctly-named document for its own slot", () => {
  assert.equal(vaultDocumentMismatchWarning("coid", "COID_Letter_of_Good_Standing.pdf"), null);
  assert.equal(vaultDocumentMismatchWarning("bee_proof", "BBBEE_Sworn_Affidavit.pdf"), null);
  assert.equal(vaultDocumentMismatchWarning("sars_tcs_pin", "SARS_Tax_Compliance_PIN.pdf"), null);
});

test("vaultDocumentMismatchWarning flags a bee_proof/sars_tcs_pin filename with no matching keyword at all", () => {
  assert.ok(vaultDocumentMismatchWarning("bee_proof", "scan0042.pdf"));
  assert.ok(vaultDocumentMismatchWarning("sars_tcs_pin", "scan0042.pdf"));
});

test("vaultDocumentMismatchWarning has no rule for a kind the brief didn't ask for (pi_insurance, iso_9001, bank_letter, cidb)", () => {
  for (const kind of ["pi_insurance", "iso_9001", "bank_letter", "cidb"] as const) {
    assert.equal(vaultDocumentMismatchWarning(kind, "anything_at_all.pdf"), null);
  }
});

// Standing review, 2026-11-09, Finding 240: nothing at all on file -> false,
// exactly like every one of the three real "something IS on file" shapes
// below, each individually sufficient (a PIN typed in with no document and
// no expiry date yet is a completely normal in-progress state, not "missing").
test("sarsTcsPinOnFile: nothing at all -> false", () => {
  assert.equal(sarsTcsPinOnFile({ sars_tcs_pin_document_path: null, sars_tcs_pin: null, sars_tcs_pin_expiry: null }), false);
});

test("sarsTcsPinOnFile: a document path alone is enough", () => {
  assert.equal(sarsTcsPinOnFile({ sars_tcs_pin_document_path: "companies/x/sars.pdf", sars_tcs_pin: null, sars_tcs_pin_expiry: null }), true);
});

test("sarsTcsPinOnFile: the PIN typed in with no document and no expiry date yet is enough - the real bug this guards against (dashboard setup checklist used to call this 'not on file')", () => {
  assert.equal(sarsTcsPinOnFile({ sars_tcs_pin_document_path: null, sars_tcs_pin: "1234567890", sars_tcs_pin_expiry: null }), true);
});

test("sarsTcsPinOnFile: an expiry date alone is enough", () => {
  assert.equal(sarsTcsPinOnFile({ sars_tcs_pin_document_path: null, sars_tcs_pin: null, sars_tcs_pin_expiry: "2027-01-01" }), true);
});

// Standing review, 2026-11-09, Finding 249: page.tsx's own VaultProgressSummary
// count used a path-only check for all 7 kinds, silently disagreeing with
// ComplianceDocumentsSection's/ReadOnlyView's own already-correct per-kind
// rule (a document was uploaded OR the matching text/level/date field was
// typed in) rendered directly below it on the same page. vaultDocumentOnFile()
// centralises that rule so page.tsx can't drift from it independently again.
const NOTHING_ON_FILE = {
  coid_letter_document_path: null,
  cidb_document_path: null,
  cidb_grading: null,
  cidb_expiry: null,
  sars_tcs_pin_document_path: null,
  sars_tcs_pin: null,
  sars_tcs_pin_expiry: null,
  pi_insurance_document_path: null,
  pi_insurance_policy_number: null,
  iso_9001_document_path: null,
  iso_9001_certified: null,
  bank_confirmation_letter_path: null,
  bank_confirmation_letter_date: null,
  bee_proof_document_path: null,
  bee_level: null,
};

test("vaultDocumentOnFile: nothing on file at all -> false for every one of the 7 kinds", () => {
  for (const kind of Object.keys(VAULT_DOCUMENTS) as (keyof typeof VAULT_DOCUMENTS)[]) {
    assert.equal(vaultDocumentOnFile(kind, NOTHING_ON_FILE), false, `${kind} should be false`);
  }
});

test("vaultDocumentOnFile: coid only counts an uploaded document, never a typed-in substitute (there isn't one)", () => {
  assert.equal(vaultDocumentOnFile("coid", { ...NOTHING_ON_FILE, coid_letter_document_path: "x/coid.pdf" }), true);
});

test("vaultDocumentOnFile: cidb - a typed-in grading alone is enough, matching ComplianceDocumentsSection's own row", () => {
  assert.equal(vaultDocumentOnFile("cidb", { ...NOTHING_ON_FILE, cidb_grading: "7CE" }), true);
  assert.equal(vaultDocumentOnFile("cidb", { ...NOTHING_ON_FILE, cidb_expiry: "2027-01-01" }), true);
  assert.equal(vaultDocumentOnFile("cidb", { ...NOTHING_ON_FILE, cidb_document_path: "x/cidb.pdf" }), true);
});

test("vaultDocumentOnFile: sars_tcs_pin delegates to sarsTcsPinOnFile (a typed-in PIN alone is enough)", () => {
  assert.equal(vaultDocumentOnFile("sars_tcs_pin", { ...NOTHING_ON_FILE, sars_tcs_pin: "1234567890" }), true);
});

test("vaultDocumentOnFile: pi_insurance - a typed-in policy number alone is enough", () => {
  assert.equal(vaultDocumentOnFile("pi_insurance", { ...NOTHING_ON_FILE, pi_insurance_policy_number: "POL-999" }), true);
});

test("vaultDocumentOnFile: bank_letter - a typed-in date alone is enough", () => {
  assert.equal(vaultDocumentOnFile("bank_letter", { ...NOTHING_ON_FILE, bank_confirmation_letter_date: "2026-11-01" }), true);
});

test("vaultDocumentOnFile: bee_proof - a typed-in B-BBEE level alone is enough", () => {
  assert.equal(vaultDocumentOnFile("bee_proof", { ...NOTHING_ON_FILE, bee_level: 2 }), true);
});

test("vaultDocumentOnFile: iso_9001 needs BOTH certified===true AND an uploaded document - certified alone, or a stray document path while not (yet) certified, are each not enough", () => {
  assert.equal(vaultDocumentOnFile("iso_9001", { ...NOTHING_ON_FILE, iso_9001_certified: true }), false);
  assert.equal(vaultDocumentOnFile("iso_9001", { ...NOTHING_ON_FILE, iso_9001_document_path: "x/iso.pdf" }), false);
  assert.equal(vaultDocumentOnFile("iso_9001", { ...NOTHING_ON_FILE, iso_9001_certified: false, iso_9001_document_path: "x/iso.pdf" }), false);
  assert.equal(
    vaultDocumentOnFile("iso_9001", { ...NOTHING_ON_FILE, iso_9001_certified: true, iso_9001_document_path: "x/iso.pdf" }),
    true,
  );
});

test("vaultDocumentOnFile: the real repro - 5 of 7 kinds typed in but not uploaded all read as on file, matching ComplianceDocumentsSection/ReadOnlyView rather than the old path-only count of 0", () => {
  const row = {
    ...NOTHING_ON_FILE,
    cidb_grading: "7CE",
    sars_tcs_pin: "1234567890",
    pi_insurance_policy_number: "POL-999",
    bank_confirmation_letter_date: "2026-11-01",
    bee_level: 2,
  };
  const onFileCount = (Object.keys(VAULT_DOCUMENTS) as (keyof typeof VAULT_DOCUMENTS)[]).filter((k) => vaultDocumentOnFile(k, row)).length;
  assert.equal(onFileCount, 5);
});
