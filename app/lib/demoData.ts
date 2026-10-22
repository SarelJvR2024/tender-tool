import { expiryStatus } from "./dates";
import { suggestForPosition, type CandidateScore } from "./positionSuggestions";
import type { RoleTag } from "./tenderRoles";
import type { ChecklistRow } from "@/app/tenders/[id]/pack-checklist";

/**
 * Hand-built sample data for the no-signup demo (spec §6: "a clearly
 * labelled sample company + sample tender... real capabilities with sample
 * data, not simulated success"). Every value here is invented for this
 * demo - not read from any real customer, since none exist to read from -
 * but every piece of DISPLAY LOGIC around it (expiryStatus(), ChipBadge,
 * suggestForPosition()/whySuggested(), PackChecklist, CvCompareView,
 * CoverPagePreview) is the same real function/component the authenticated
 * app uses, not a separate mockup. Reuses the same company identity as the
 * existing seeded signed-in demo/trial company ("Mzansi Roads & Civils
 * (Pty) Ltd", lib/demoCompany.ts/engine/seed_demo_company.py) for narrative
 * consistency - this is the one house demo identity, not a new invented
 * customer.
 */

export const DEMO_COMPANY = {
  legal_name: "Mzansi Roads & Civils (Pty) Ltd",
  logo_storage_path: null as string | null,
};

export const DEMO_TENDER = {
  contract_no: "SANRAL/N7/2026-014",
  nra_reference: "NRA N.007-070-2026/1",
  description: "Rehabilitation of National Route N7 Section 3 between Vanrhynsdorp and Klawer, Western Cape",
  buyer: "The South African National Roads Agency SOC Limited",
  closing_date: "2026-11-27T12:00:00+02:00",
};

export const DEMO_REQUIREMENTS: { label: string; detail?: string; quote: string; fromOcr?: boolean; status: ReturnType<typeof expiryStatus> }[] = [
  {
    label: "CIDB contractor grading",
    detail: "Minimum 7CE required for a tender of this value",
    quote: "Tenderers must be registered with the CIDB in a contractor grading of 7CE or higher at closing date.",
    status: { label: "On file", tone: "success" },
  },
  {
    label: "Tax clearance (Tax Compliance Status PIN)",
    quote: "A valid Tax Compliance Status PIN, obtainable from SARS eFiling, must be submitted with the tender.",
    status: { label: "On file", tone: "success" },
  },
  {
    // Genuinely real: expiryStatus() called with a past date produces this
    // "Expired" tone through the exact same logic the authenticated vault
    // uses - not a hand-picked destructive chip.
    label: "COID Letter of Good Standing",
    detail: "Required for every key position working on site",
    quote: "A valid Letter of Good Standing issued under the Compensation for Occupational Injuries and Diseases Act must accompany the tender.",
    fromOcr: true,
    status: expiryStatus("2026-08-15"),
  },
];

// Fed straight into suggestForPosition() - the real ranking/wording logic,
// not a hand-written "why" string - so the demo's suggestion card says
// exactly what the real app would say for this data.
const RESIDENT_ENGINEER_CANDIDATES: CandidateScore[] = [
  {
    person_id: "demo-person-1",
    name: "Nokuthula Dlamini",
    score: 92,
    years_experience: 11,
    ecsa_level: "Professional Engineering Technologist",
    matched: ["road rehabilitation", "surfacing", "geotechnical"],
    missing: null,
    specialism_warning: false,
    rationale: "",
  },
  {
    person_id: "demo-person-2",
    name: "Johan van der Merwe",
    score: 78,
    years_experience: 4,
    ecsa_level: "Candidate Engineer",
    matched: ["road rehabilitation"],
    missing: ["surfacing", "geotechnical"],
    specialism_warning: true,
    rationale: "",
  },
];
const RESIDENT_ENGINEER_TAGS: RoleTag[] = [
  { person_id: "demo-person-1", role_code: "resident_engineer", notes: null },
  { person_id: "demo-person-2", role_code: "resident_engineer", notes: null },
];

export const DEMO_POSITION_SUGGESTIONS = suggestForPosition({
  positionCode: "RE-1",
  description: "Resident Engineer",
  candidateScores: RESIDENT_ENGINEER_CANDIDATES,
  tags: RESIDENT_ENGINEER_TAGS,
  peopleIds: new Set(["demo-person-1", "demo-person-2"]),
});

export const DEMO_POSITION_PEOPLE = [
  { id: "demo-person-1", name: "Nokuthula Dlamini" },
  { id: "demo-person-2", name: "Johan van der Merwe" },
];

export const DEMO_CV_ORIGINAL = { filename: "N_Dlamini_CV_2026.pdf" };
export const DEMO_CV_TAILORED = {}; // no real file to download in a demo - CvCompareView shows "Sample" in place of a link

export const DEMO_PACK_CHECKLIST: ChecklistRow[] = [
  { no: 1, title: "SBD 1 - Invitation to bid", envelope: "Technical envelope", status: "included", pages: "1", note: null },
  { no: 2, title: "CIDB registration certificate", envelope: "Technical envelope", status: "included", pages: "2-3", note: null },
  { no: 3, title: "Tax Compliance Status PIN", envelope: "Technical envelope", status: "included", pages: "4", note: null },
  { no: 4, title: "COID Letter of Good Standing", envelope: "Technical envelope", status: "included_warning", pages: "5", note: "On file, but expired - replace before you submit" },
  {
    no: 5,
    title: "Form B7 - subcontracting plan, signed",
    envelope: "Technical envelope",
    status: "not_included",
    pages: null,
    note: "Needs a director's signature - never guessed or auto-signed",
  },
];
