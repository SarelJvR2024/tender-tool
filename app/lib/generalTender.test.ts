/**
 * checkReturnable()'s "cidb" case never called validityAtClosing() on
 * companies.cidb_expiry the way every other dated vault item in this same
 * switch (tax/bbbee/coid/bank/insurance) does - even though migration 0063
 * added cidb_expiry/cidb_document_path "same pattern as every other
 * Document Vault column", and engine/general/build_general_pack.py's own
 * VAULT_EXPIRY_FOR already keys "cidb" -> "cidb_expiry" when it assembles
 * the real submission pack (QA pass, 2026-11-03). So the actual pack-build
 * engine already treats an expired CIDB certificate as expired, while this
 * review screen (general-pack-review.tsx / submission-plan via
 * checkReturnable()) kept reporting "CIDB grading X on file" with no
 * expiry awareness at all - the one vault item left disagreeing with the
 * engine that actually assembles the document.
 *
 * Found 2026-11-11, QA pass (Finding 419).
 *
 * Run: node --experimental-strip-types --test app/lib/generalTender.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkReturnable, type GeneralCompany } from "./generalTender.ts";
import type { ManifestReturnable } from "./generalTender.ts";

const daysFromNow = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const BASE_COMPANY: GeneralCompany = {
  id: "company-1",
  legal_name: "Test Co", csd_supplier_number: null, income_tax_number: null,
  coid_registration_number: null, coid_letter_of_good_standing_number: null,
  coid_letter_of_good_standing_expiry: null,
  bee_level: null, black_ownership_pct: null, bee_procurement_recognition_pct: null, status: null,
  bank_name: null, bank_branch_code: null, director_name: null,
  coid_letter_document_path: null, sars_tcs_pin: null, sars_tcs_pin_expiry: null, sars_tcs_pin_document_path: null,
  pi_insurance_insurer: null, pi_insurance_policy_number: null, pi_insurance_cover_zar: null, pi_insurance_expiry: null, pi_insurance_document_path: null,
  iso_9001_certified: null, iso_9001_certificate_number: null, iso_9001_expiry: null, iso_9001_document_path: null,
  bank_confirmation_letter_date: null, bank_confirmation_letter_valid_until: null, bank_confirmation_letter_path: null,
  bee_proof_type: null, bee_proof_expiry: null, bee_proof_document_path: null,
  cipc_registration_number: null, vat_number: null, postal_address: null, registered_address: null,
  telephone: null, cellphone: null, email: null,
  cidb_grading: "6CE", cidb_expiry: null, cidb_document_path: null,
};

const CIDB_RETURNABLE: ManifestReturnable = {
  key: "cidb", label: "CIDB registration / grading", vault: "cidb", conditional: null,
  strength: "required", mentions: 1, document: "Tender notice", quote: "CIDB contractor grading of at least 6CE",
};

const cidbCheckFor = (company: GeneralCompany, closingDate: string) =>
  checkReturnable(CIDB_RETURNABLE, company, closingDate, [], null);

test("CIDB grading on file, expiry unset: reports 'check' (unchanged pre-fix behaviour, no regression)", () => {
  const check = cidbCheckFor(BASE_COMPANY, daysFromNow(10));
  assert.equal(check.status, "check");
  assert.match(check.detail, /no expiry date recorded/i);
});

test("CIDB certificate already expired (before this tender's own closing date) is 'missing', not 'have'", () => {
  const company = { ...BASE_COMPANY, cidb_expiry: daysFromNow(-5) };
  const check = cidbCheckFor(company, daysFromNow(10));
  assert.equal(check.status, "missing", "an expired CIDB certificate must not read as satisfied - the real pack-build engine (build_general_pack.py's VAULT_EXPIRY_FOR) already treats it as expired");
  assert.match(check.detail, /expired/i);
});

test("CIDB certificate valid at closing, with a vault copy on file: 'have', not expiring", () => {
  const company = { ...BASE_COMPANY, cidb_expiry: daysFromNow(400), cidb_document_path: "company-1/vault/cidb/cert.pdf" };
  const check = cidbCheckFor(company, daysFromNow(10));
  assert.equal(check.status, "have");
  assert.equal(check.expiring, false);
});

test("CIDB certificate within the 60-day renew-soon window carries the same 'expiring' signal every sibling dated vault item already does", () => {
  const company = { ...BASE_COMPANY, cidb_expiry: daysFromNow(30), cidb_document_path: "company-1/vault/cidb/cert.pdf" };
  const check = cidbCheckFor(company, daysFromNow(10));
  assert.equal(check.status, "have");
  assert.equal(check.expiring, true, "should carry the same renew-soon signal tax/bbbee/coid/bank/insurance already do");
  assert.match(check.detail, /renew soon/i);
});

test("CIDB grading on file but no vault copy and no expiry: 'check', unchanged pre-fix wording path", () => {
  const check = cidbCheckFor(BASE_COMPANY, daysFromNow(10));
  assert.equal(check.vaultLink, true, "with no expiry recorded yet, point the user at the Company page the same way the tax/bbbee/coid siblings do");
});
