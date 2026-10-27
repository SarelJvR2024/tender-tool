/**
 * minimumRequirementFor()'s specialistOf() helper decides whether a SANRAL
 * key position is checked against an engineering-geologist's own SACNASP
 * requirement (Pr Sci.Nat, SAIEG, 5 years) rather than the generic ECSA
 * Pr Eng/Pr Tech Eng minimum every other position falls back to. Covers the
 * 2026-10-27 fix: specialistOf() used to test only `/geolog/i`, a narrower,
 * separately-maintained copy of the same-purpose SACNASP_POSITION_RE
 * personCredentials.ts already exports and relies on elsewhere - so a
 * position described without the literal word "geolog" (e.g. "Natural
 * Scientist", or naming "Pr Sci.Nat" directly) fell through to the wrong
 * requirement.
 *
 * Run: node --experimental-strip-types --test app/lib/tenderCompliance.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { minimumRequirementFor, SANRAL_MIN_REQUIREMENTS } from "./tenderCompliance.ts";

test("a position literally naming 'Geologist' resolves to the SACNASP requirement (unchanged by the fix)", () => {
  const req = minimumRequirementFor("DS1", "Design Specialist 1 - Engineering Geologist");
  assert.equal(req?.registration, "pr_sci_nat");
  assert.equal(req?.years, 5);
});

test("a position described as 'Natural Scientist' (no 'geolog' substring) now also resolves to the SACNASP requirement", () => {
  const req = minimumRequirementFor("DS2", "Design Specialist 2 - Natural Scientist");
  assert.equal(req?.registration, "pr_sci_nat", "should use the engineering-geologist SACNASP minimum, not fall back to generic ECSA");
  assert.equal(req?.years, 5);
});

test("a position naming 'Pr Sci.Nat' directly (no 'geolog' substring) also resolves to the SACNASP requirement", () => {
  const req = minimumRequirementFor("DS3", "Design Specialist 3 - registered Pr Sci.Nat required");
  assert.equal(req?.registration, "pr_sci_nat");
});

test("a position with neither 'geolog' nor a SACNASP phrasing still falls back to the generic SANRAL table (no regression)", () => {
  const req = minimumRequirementFor("RE", "Resident Engineer");
  assert.equal(req, SANRAL_MIN_REQUIREMENTS.RE);
  assert.equal(req?.registration, "pr_eng_or_tech");
});

test("a quantity surveyor position is still checked against SACQSP, not SACNASP (ordering preserved)", () => {
  const req = minimumRequirementFor("DS4", "Design Specialist 4 - Quantity Surveyor");
  assert.equal(req?.registration, "sacqsp");
});

test("a surveyor position is still checked against SAGC, not SACNASP (ordering preserved)", () => {
  const req = minimumRequirementFor("DS5", "Design Specialist 5 - Land Surveyor");
  assert.equal(req?.registration, "sagc");
});
