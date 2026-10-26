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
