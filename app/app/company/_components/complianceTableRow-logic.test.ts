/**
 * Regression test for complianceTableRow-logic.ts - Finding 488:
 * ComplianceDocumentsView.tsx's own table row (the new default view) showed
 * only entry.detail (lines[0]) plus a separate Expires column, silently
 * dropping the entity/contractor/account-holder name facts that live at
 * lines[2] for cidb/bank_letter/bee_proof/iso_9001, which card view already
 * rendered. extraTableLines() is what the table row now also renders.
 *
 * Run: node --experimental-strip-types --test "app/app/company/_components/complianceTableRow-logic.test.ts"
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { extraTableLines } from "./complianceTableRow-logic.ts";

test("two-line entry (coid/sars/pi shape, no third fact): nothing extra", () => {
  assert.deepEqual(extraTableLines(["No. 123 · Registration 456", "Expires 2027-01-01"]), []);
});

test("the real bug: cidb's own third line (contractor name on certificate) is surfaced", () => {
  const lines = ["Grading 6CE", "Expires 2027-01-01", "Reg. no. 789 · Contractor name on certificate: Acme Civils (Pty) Ltd"];
  assert.deepEqual(extraTableLines(lines), ["Reg. no. 789 · Contractor name on certificate: Acme Civils (Pty) Ltd"]);
});

test("bee's own third line (entity name on certificate) is surfaced", () => {
  const lines = ["Level 1 B-BBEE certificate", "Expires 2027-06-30", "Entity name on certificate: Acme Holdings (Pty) Ltd"];
  assert.deepEqual(extraTableLines(lines), ["Entity name on certificate: Acme Holdings (Pty) Ltd"]);
});

test("bank letter's own third line (bank/account holder) is surfaced - its second line is 'Usable until...', not 'Expires...', and must not be mistaken for it", () => {
  assert.deepEqual(
    extraTableLines(["Dated 2026-11-01", "Usable until 2027-02-01 (3 months from its date)", "Bank: Standard Bank"]),
    ["Bank: Standard Bank"],
  );
});

test("iso, not certified at all: ComplianceDocumentsSection's own .filter(Boolean) leaves only one line - nothing extra, no crash", () => {
  assert.deepEqual(extraTableLines(["Not ISO 9001 certified (SANRAL B4: in-house QMS scores 5 of 10)"]), []);
});

test("only one line total (defensive - no second/third fact at all): nothing extra, no crash", () => {
  assert.deepEqual(extraTableLines(["Not certified"]), []);
});

test("empty lines array (defensive): nothing extra, no crash", () => {
  assert.deepEqual(extraTableLines([]), []);
});

test("never mutates the input array", () => {
  const lines = ["Grading 6CE", "Expires 2027-01-01", "Reg. no. 789"];
  const before = [...lines];
  extraTableLines(lines);
  assert.deepEqual(lines, before);
});
