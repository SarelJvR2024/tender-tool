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
import { minimumRequirementFor, SANRAL_MIN_REQUIREMENTS, sanralConventionalDocumentChecks, type CompanyVault, type KeyPersonMinimumRow, type KeyPersonMinimums } from "./tenderCompliance.ts";

/** A minimal real-shaped KeyPersonMinimums.rows[] entry (engine/discovery/key_person_minimums.py's own output shape) for one specialist row. */
function ownRow(overrides: Partial<KeyPersonMinimumRow>): KeyPersonMinimums {
  const row: KeyPersonMinimumRow = {
    position: "Occupational Health and Safety Specialist", position_code: null, specialist: null,
    qualification: null, registration: null, bodies: [], years_text: null, years_min: null,
    years_under: null, other: null, alternatives: [], quote: "test fixture row",
    ...overrides,
  };
  return { source: "tender_document", clause: "C3.1.11(d)", rows: [row] };
}

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

/**
 * Finding 416: engine/discovery/key_person_minimums.py's own SPECIALISTS
 * list recognises 9 specialist position types when it reads THIS tender's
 * real C3.1.11 table - the 3 covered above (engineering_geologist,
 * quantity_surveyor, surveyor) plus environmental_practitioner,
 * ohs_specialist, road_safety_audit_team_leader, programmer,
 * materials_technician and trainee_technician - confirmed real on real
 * SANRAL tenders by that module's own test fixtures (R.396/N.011), not
 * hypothetical. specialistOf() here only ever recognised the first 3, so
 * minimumRequirementFor() could never match the tender's OWN already-read
 * row for the other 6, silently falling through to the generic/assumed
 * SANRAL table instead of the real extracted requirement - the exact same
 * failure shape the 2026-10-27 fix above already fixed for "Natural
 * Scientist" (a geologist description without the word "geolog"), just for
 * 6 different position types that fix didn't touch.
 */
test("an OHS Specialist position resolves to THIS tender's own extracted SACPCMP requirement, not the generic fallback", () => {
  const own = ownRow({ position: "OHS Specialist", specialist: "ohs_specialist", registration: "sacpcmp", qualification: "As required by SACPCMP", years_text: null });
  const req = minimumRequirementFor("DS6", "Design Specialist 6 - OHS Specialist", own);
  assert.equal(req?.registration, "sacpcmp");
  assert.equal(req?.source, "tender_document");
});

test("an Environmental Practitioner position resolves to the tender's own row, not 'no minimum requirement on file'", () => {
  const own = ownRow({ position: "Environmental Practitioner", specialist: "environmental_practitioner", registration: "refer", qualification: "Refer to sub-service procurement document" });
  const req = minimumRequirementFor("DS7", "Design Specialist 7 - Environmental Practitioner", own);
  assert.equal(req?.registration, "refer");
  assert.equal(req?.source, "tender_document");
});

test("a Road Safety Audit Team Leader position resolves to the tender's own row", () => {
  const own = ownRow({ position: "Road Safety Audit Team Leader", specialist: "road_safety_audit_team_leader", registration: "pr_eng_or_tech", years_min: 10, years_text: "10" });
  const req = minimumRequirementFor("DS8", "Design Specialist 8 - Road Safety Audit Team Leader", own);
  assert.equal(req?.registration, "pr_eng_or_tech");
  assert.equal(req?.years, 10);
  assert.equal(req?.source, "tender_document");
});

test("a Programmer position resolves to the tender's own row", () => {
  const own = ownRow({ position: "Programmer", specialist: "programmer", registration: "qualification", qualification: "Bachelor's degree in construction management, Civil Engineering, or a related field.", years_min: 5, years_text: "5-10" });
  const req = minimumRequirementFor("DS9", "Design Specialist 9 - Programmer", own);
  assert.equal(req?.registration, "qualification");
  assert.equal(req?.source, "tender_document");
});

test("a Materials Technician position resolves to the tender's own row", () => {
  const own = ownRow({ position: "Materials Technician", specialist: "materials_technician", registration: "qualification", qualification: "National Diploma" });
  const req = minimumRequirementFor("DS10", "Design Specialist 10 - Materials Technician", own);
  assert.equal(req?.registration, "qualification");
  assert.equal(req?.source, "tender_document");
});

test("a Trainee Technician position resolves to the tender's own row, not the generic candidate fallback", () => {
  const own = ownRow({ position: "Trainee Technician", specialist: "trainee_technician", registration: "candidate", qualification: "Candidate Technician", years_min: 0, years_text: "0" });
  const req = minimumRequirementFor("DS11", "Design Specialist 11 - Trainee Technician", own);
  assert.equal(req?.registration, "candidate");
  assert.equal(req?.source, "tender_document");
});

/**
 * sanralConventionalDocumentChecks()'s A20 (COID Letter of Good Standing)
 * check hand-rolls its own valid-at-closing logic instead of calling the
 * shared validityAtClosing() every other dated document here uses - and had
 * never carried a "renew soon" `expiring` signal through at all, unlike tax
 * (A9), B-BBEE (A12), insurance (A17), bank letter (A18) and ISO 9001 (B4)
 * in this same function, and unlike generalTender.ts's own "coid" case
 * (which already calls validityAtClosing() and sets expiring correctly).
 * Found 2026-10-29: a COID letter 1-60 days from expiry showed as plain "On
 * file" on compliance-report.tsx, with no amber "Renew soon" chip, right up
 * to the day it actually lapsed - exactly the kind of "no clear view of the
 * expiry date" gap this codebase's own lib/dates.ts header comment names as
 * the original COID incident this whole renew-soon mechanism exists to
 * prevent, just the opposite failure direction (never warned early, rather
 * than wrongly flagged late).
 *
 * Run: node --experimental-strip-types --test app/lib/tenderCompliance.test.ts
 */
const daysFromNow = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const BASE_COMPANY: CompanyVault = {
  legal_name: "Test Co", csd_supplier_number: "CSD1", income_tax_number: null,
  coid_registration_number: "REG1", coid_letter_of_good_standing_number: "COID1",
  coid_letter_of_good_standing_expiry: null,
  bee_level: null, black_ownership_pct: null, bee_procurement_recognition_pct: null, status: null,
  bank_name: null, bank_branch_code: null, director_name: null,
  coid_letter_document_path: null, sars_tcs_pin: null, sars_tcs_pin_expiry: null, sars_tcs_pin_document_path: null,
  pi_insurance_insurer: null, pi_insurance_policy_number: null, pi_insurance_cover_zar: null, pi_insurance_expiry: null, pi_insurance_document_path: null,
  iso_9001_certified: null, iso_9001_certificate_number: null, iso_9001_expiry: null, iso_9001_document_path: null,
  bank_confirmation_letter_date: null, bank_confirmation_letter_valid_until: null, bank_confirmation_letter_path: null,
  bee_proof_type: null, bee_proof_expiry: null, bee_proof_document_path: null,
};

const coidItemFor = (coidExpiry: string | null, closingDate: string) => {
  const items = sanralConventionalDocumentChecks({
    company: { ...BASE_COMPANY, coid_letter_of_good_standing_expiry: coidExpiry },
    closingDate,
    provenance: [],
    hasPack: false,
    financialCaptureStatus: null,
    briefingTask: null,
    experience: null,
    experienceAvailable: false,
  });
  return items.find((i) => i.key === "coid")!;
};

test("COID letter 30 days from expiry (within the 60-day renew-soon window) is flagged expiring, not shown as plain 'On file'", () => {
  const coid = coidItemFor(daysFromNow(30), daysFromNow(10));
  assert.equal(coid.status, "have");
  assert.equal(coid.expiring, true, "should carry the same renew-soon signal every other dated document (tax/bbbee/insurance/bank/ISO) already does");
  assert.match(coid.detail, /renew soon/i);
});

test("COID letter 400 days from expiry (well outside the renew-soon window) is not flagged expiring", () => {
  const coid = coidItemFor(daysFromNow(400), daysFromNow(10));
  assert.equal(coid.status, "have");
  assert.equal(coid.expiring, false);
});

test("COID letter already expired is still 'missing', not 'expiring' (no regression on the existing expired case)", () => {
  const coid = coidItemFor(daysFromNow(-5), daysFromNow(10));
  assert.equal(coid.status, "missing");
  assert.equal(coid.expiring, false);
});
