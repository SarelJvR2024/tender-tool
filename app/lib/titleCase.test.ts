/**
 * Coverage for displayTenderTitle() - "clean title casing, not raw scraped
 * ALL-CAPS" (Phase 2 Opportunities brief, 2026-10-23).
 *
 * Run: node --experimental-strip-types --test app/lib/titleCase.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { displayTenderTitle } from "./titleCase.ts";

test("displayTenderTitle: null stays null", () => {
  assert.equal(displayTenderTitle(null), null);
});

test("displayTenderTitle: a title that already has normal mixed case is left completely alone", () => {
  const title = "Supply and Install PH30 and PH120 Cabling at Rand Water Rietvlei";
  assert.equal(displayTenderTitle(title), title);
});

test("displayTenderTitle: a fully shouted title is title-cased - an unlisted short initialism (ZK) is an accepted, honest limitation, not chased with a rule that would make ordinary short words (WAR) worse", () => {
  assert.equal(
    displayTenderTitle("MAINTENANCE AND REFURBISHMENT OF ZK SCHOOL AND WAR ON LEAKS AT RAND WATER ZWARTKOPJES"),
    "Maintenance and Refurbishment of Zk School and War on Leaks at Rand Water Zwartkopjes",
  );
});

test("displayTenderTitle: known acronyms stay fully capitalised, not Title-Cased into gibberish", () => {
  assert.equal(
    displayTenderTitle("APPOINTMENT OF A CONSULTING ENGINEER FOR SANRAL ROUTINE MAINTENANCE"),
    "Appointment of a Consulting Engineer for SANRAL Routine Maintenance",
  );
});

test("displayTenderTitle: a reference code with digits is left exactly as-is", () => {
  assert.equal(displayTenderTitle("CONTRACT R.396-010-2025/1F MAINTENANCE WORKS"), "Contract R.396-010-2025/1F Maintenance Works");
});

test("displayTenderTitle: a title with no letters at all (edge case) is returned unchanged, not crashed on", () => {
  assert.equal(displayTenderTitle("12345"), "12345");
});

test("displayTenderTitle: a hyphenated word (RE-ADVERTISED, CO-ORDINATION) is title-cased on BOTH sides of the hyphen, not just the first - a real, reachable gov-source shape (state/seen_tenders.json has a live 'RE-ADVERTISED' title)", () => {
  assert.equal(displayTenderTitle("SCMU 03 - 2026 2027 RE-ADVERTISED"), "Scmu 03 - 2026 2027 Re-Advertised");
  assert.equal(
    displayTenderTitle("APPOINTMENT OF SERVICE PROVIDER FOR CO-ORDINATION OF WORKS"),
    "Appointment of Service Provider for Co-Ordination of Works",
  );
});

test("displayTenderTitle: a mid-title letter+digit code whose bare letters collide with a stop word (A1/A2, a real SANRAL road-section shape) is left exactly as-is, same digit guarantee as a reference code - QA pass, 2026-11-11 (previously 'Upgrade of Section a1 to a2': the digit check ran AFTER the mid-title lowercase rule, so it never got a chance to protect this shape)", () => {
  assert.equal(displayTenderTitle("UPGRADE OF SECTION A1 TO A2"), "Upgrade of Section A1 to A2");
});

test("displayTenderTitle: AT2/ON3/OR5-shaped codes (every LOWERCASE_MID_WORDS entry paired with a digit) all keep their digit exactly, not just A1/A2", () => {
  assert.equal(displayTenderTitle("MAINTENANCE OF AT2 PUMP STATION"), "Maintenance of AT2 Pump Station");
  assert.equal(displayTenderTitle("REPAIRS TO ON3 SUBSTATION AND OR5 VALVE"), "Repairs to ON3 Substation and OR5 Valve");
});
