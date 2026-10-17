// Company experience library: taxonomy + the one query a tender-compliance
// check needs. Schema: supabase/migrations/0012_experience_items.sql.
// Evidence for every list below: docs/specs/Experience-Library-Findings.md.
//
// For whoever builds a tender compliance check (e.g. the readiness report on
// app/app/tenders/[id]/page.tsx): call findMatchingExperience() with the
// tender's discipline categories (engine/discovery/assess_tender.py
// categorize() output - discipline_categories slugs, 0040; widen a group to
// its disciplines with disciplineTaxonomy.ts expandDisciplines()) and, for
// SANRAL-style "3 completed projects of similar scope in the last 10 years"
// (Form B6), completedWithinYears: 10 and asOf: the tender's closing date.
// Only rows a human has tagged are ever returned.

import type { SupabaseClient } from "@supabase/supabase-js";

// What kind of evidence the document is. Order = how tenders weigh it:
// SANRAL B6 scores CIDB performance reports and client reference letters;
// completion certificates / close-out reports prove completion; an award
// letter proves appointment only, not completion.
export const DOCUMENT_TYPES = [
  { value: "reference_letter", label: "Reference letter" },
  { value: "performance_report", label: "CIDB performance report (Annex 1)" },
  { value: "completion_certificate", label: "Completion certificate" },
  { value: "closeout_report", label: "Close-out report" },
  { value: "award_letter", label: "Letter of award / appointment" },
  { value: "project_record", label: "Project record (no document yet)" },
  { value: "other", label: "Other" },
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number]["value"];

// The 7 ORIGINAL discipline groups. Since 0040 the suggested list is the
// discipline_categories table (app/lib/disciplineTaxonomy.ts: 19 groups, 93
// disciplines, growing - Sarel's own maintained list, audit Q3); these 7 are
// its first seven group slugs, kept here only as the fallback when that
// table can't be read. Not a closed list either way (0036): a company can
// still add its own tags (disciplineSlug).
export const DISCIPLINES = [
  { value: "roads_civil", label: "Roads & civil" },
  { value: "water", label: "Water & sanitation" },
  { value: "buildings", label: "Buildings" },
  { value: "electrical_mechanical", label: "Electrical & mechanical" },
  { value: "it_telecoms", label: "IT & telecoms" },
  { value: "professional_services", label: "Professional / consulting services" },
  { value: "security_facilities", label: "Security & facilities" },
] as const;
export type Discipline = (typeof DISCIPLINES)[number]["value"];

/** A company's own discipline tag as stored (0036 format check: lower-case slug). */
export function disciplineSlug(text: string): string | null {
  const slug = text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[0-9_]+/, "").slice(0, 63);
  return slug.length > 0 ? slug : null;
}

/** Label for a discipline tag: the suggested label, else the tag in words. */
export function disciplineLabel(value: string): string {
  const known = DISCIPLINES.find((d) => d.value === value);
  if (known) return known.label;
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// SANRAL's own client codes (Form B1/B2 "CLIENT (coded)"), scored in the
// managerial-knowledge "Client" criterion. Same values projects.client_type holds.
export const CLIENT_TYPES = [
  "National Roads Authority",
  "Concessionaire",
  "Provincial Authority",
  "Relevant SOE",
  "Metro Council",
  "Municipality",
  "Private",
  "Other",
] as const;

// Stages from CIDB Annex 1 "PSP Performance Report" - which services the
// company delivered on the project.
export const SERVICE_STAGES = [
  { value: "initiation", label: "Project initiation" },
  { value: "inception", label: "Inception" },
  { value: "concept_viability", label: "Concept & viability" },
  { value: "design_development", label: "Design development" },
  { value: "documentation_procurement", label: "Documentation & procurement" },
  { value: "construction", label: "Construction (monitoring / supervision)" },
  { value: "close_out", label: "Close-out" },
] as const;

// Reference letter / CIDB report rating; SANRAL scores 1 / 3 / 4 / 5.
export const PERFORMANCE_RATINGS = [
  { value: "excellent", label: "Excellent" },
  { value: "good", label: "Good" },
  { value: "adequate", label: "Adequate" },
  { value: "poor", label: "Poor" },
] as const;

// SANRAL project-type codes - the COMPLETE list SANRAL publishes, not the
// handful seen in one company's projects. Source: the "Proj Relevance Codes"
// sheet of SANRAL's own Consultant Technical Submission workbook, which Book 1
// itself names as the authority ("For a comprehensive list of matrixes please
// refer to the Consultant Technical Submission Spreadsheet. Below are
// examples", R.396-010-2025/1F p. T-25). That sheet is byte-identical in all 7
// workbooks on hand (the six 2025 Conventional tenders and the 2023 RRM
// X.002-188-2023/1F) - 46 codes, verbatim below, each with the matrices
// (= key positions) it scores on. The last 6 are in Book 1's printed matrices
// (T-20 Geometrics, T-23 Engineering Geologist) but not in the workbook's
// sheet. Which codes a given position's Form B1 accepts is that position's
// matrix ("appliesTo"); a code can be right for one position and not offered
// for another (sanral_fill.py projects_for_block). Offered as suggestions:
// other buyers don't code project types, so the column stays free text.
export const SANRAL_PROJECT_TYPES: { code: string; label: string; appliesTo: string[] }[] = [
  { code: "MO/MA", label: "Maintenance Opertations and Adhoc Maintenance", appliesTo: ["PL, CE, RE - CONVENTIONAL"] },
  { code: "MP/MS", label: "Periodic Maintenance and Special Maintenance", appliesTo: ["PL, CE, RE - CONVENTIONAL", "CE, RM/ARM - RRM", "DS - Pavement and Materials"] },
  { code: "DS", label: "Development Strengthening", appliesTo: ["PL, CE, RE - CONVENTIONAL", "CE, RM/ARM - RRM", "DS - Pavement and Materials"] },
  { code: "DI", label: "Development Improvement", appliesTo: ["PL, CE, RE - CONVENTIONAL", "CE, RM/ARM - RRM"] },
  { code: "DN", label: "Development New Facilities", appliesTo: ["PL, CE, RE - CONVENTIONAL", "CE, RM/ARM - RRM"] },
  { code: "CD", label: "Community Development", appliesTo: ["PL, CE, RE - CONVENTIONAL", "CE, RM/ARM - RRM"] },
  { code: "RRM", label: "Routine Road Maintenance", appliesTo: ["CE, RM/ARM - RRM"] },
  { code: "MO/MA (Excl. RRM)", label: "Maintenance Operations and Adhoc Maintenance (Excl. RRM Projects)", appliesTo: ["CE, RM/ARM - RRM"] },
  { code: "MSC", label: "Special Maintenance Concrete", appliesTo: ["DS - Pavement and Materials"] },
  { code: "DI/DN", label: "Development Improvement / New Facilities", appliesTo: ["DS - Pavement and Materials"] },
  { code: "MSB", label: "Maintenance Special Bridge", appliesTo: ["DS - Structures"] },
  { code: "DIB", label: "Development Improvement Bridge", appliesTo: ["DS - Structures"] },
  { code: "DNB", label: "Development New Bridge", appliesTo: ["DS - Structures"] },
  { code: "MSS", label: "Maintenance Special Structures", appliesTo: ["DS - Structures"] },
  { code: "DIS", label: "Development Improvement Structures", appliesTo: ["DS - Structures"] },
  { code: "DNS", label: "Development New Structures", appliesTo: ["DS - Structures"] },
  { code: "STREET LIGHTING", label: "Steet Lighting", appliesTo: ["DS - Electrical"] },
  { code: "TRAFFIC LIGHTS", label: "Traffic Lights", appliesTo: ["DS - Electrical"] },
  { code: "BUILDING RETICULATION", label: "Building Reticulation", appliesTo: ["DS - Electrical"] },
  { code: "INTERSECTION IMPROVEMENTS", label: "Intersection Improvements", appliesTo: ["DS - Geometrics"] },
  { code: "CAPACITY IMPROVEMENT", label: "Capacity Improvement", appliesTo: ["DS - Geometrics"] },
  { code: "ADDITIONAL LANES", label: "Additional Lanes", appliesTo: ["DS - Geometrics", "DS - GEOTECHNICAL"] },
  { code: "INTERCHANGE DESIGN", label: "Interchange Design", appliesTo: ["DS - Geometrics"] },
  { code: "H/V RE-ALIGNMENT", label: "Horizontal / Vertical Re-Alignment", appliesTo: ["DS - Geometrics"] },
  { code: "NEW ALIGNMENT", label: "New Alignment", appliesTo: ["DS - Geometrics"] },
  { code: "Strategic modelling/ demand forecasting", label: "Strategic modelling/ demand forecasting", appliesTo: ["DS - TRAFFIC AND TRANSPORTATION"] },
  { code: "Static (meso) network simulation models", label: "Static (meso) network simulation models", appliesTo: ["DS - TRAFFIC AND TRANSPORTATION"] },
  { code: "Dynamic (micro) simulation modelling", label: "Dynamic (micro) simulation modelling", appliesTo: ["DS - TRAFFIC AND TRANSPORTATION"] },
  { code: "Traffic impact studies / local intersections", label: "Traffic impact studies / local intersections", appliesTo: ["DS - TRAFFIC AND TRANSPORTATION"] },
  { code: "NMT and PT operations", label: "NMT and PT operations", appliesTo: ["DS - TRAFFIC AND TRANSPORTATION"] },
  { code: "Transport economic studies", label: "Transport economic studies", appliesTo: ["DS - TRAFFIC AND TRANSPORTATION"] },
  { code: "Transport policy development", label: "Transport policy development", appliesTo: ["DS - TRAFFIC AND TRANSPORTATION"] },
  { code: "ITS systems", label: "ITS systems", appliesTo: ["DS - TRAFFIC AND TRANSPORTATION"] },
  { code: "FOUNDATIONS (PILING, PILE CAPS)", label: "FOUNDATIONS (PILING, PILE CAPS)", appliesTo: ["DS - GEOTECHNICAL"] },
  { code: "DEEP EXCAVATIONS (DEEP CUTS/HIGH FILLS)", label: "DEEP EXCAVATIONS (DEEP CUTS/HIGH FILLS)", appliesTo: ["DS - GEOTECHNICAL"] },
  { code: "RETAINING STRUCTURES", label: "RETAINING STRUCTURES", appliesTo: ["DS - GEOTECHNICAL"] },
  { code: "ROCK ANCHORS (MOUNTAIN PASSES)", label: "ROCK ANCHORS (MOUNTAIN PASSES)", appliesTo: ["DS - GEOTECHNICAL"] },
  { code: "MATERIAL & ROCK SOURCES", label: "MATERIAL & ROCK SOURCES", appliesTo: ["DS - GEOTECHNICAL"] },
  { code: "ENGINEERING GEOPHYSICS", label: "ENGINEERING GEOPHYSICS", appliesTo: ["DS - GEOTECHNICAL"] },
  { code: "REMOTE SENSING (GIS)", label: "REMOTE SENSING (GIS)", appliesTo: ["DS - GEOTECHNICAL"] },
  { code: "ENGINEERING GEOLOGICAL MAPPING", label: "ENGINEERING GEOLOGICAL MAPPING", appliesTo: ["DS - GEOTECHNICAL"] },
  { code: "SUBSURFACE DRAINING (GEOHYDROLOGY)", label: "SUBSURFACE DRAINING (GEOHYDROLOGY)", appliesTo: ["DS - GEOTECHNICAL"] },
  { code: "MAJOR TCC (WEIGH BRIDGES)", label: "Major Traffic Control Centres (Weighbridge)", appliesTo: ["DS - ELECTRONIC SYSTEMS"] },
  { code: "TOLLS", label: "Tolls", appliesTo: ["DS - ELECTRONIC SYSTEMS"] },
  { code: "FMS", label: "Freeway Managment Systems", appliesTo: ["DS - ELECTRONIC SYSTEMS"] },
  { code: "MINOR TCC (BASIC WEIGH BRIDGE)", label: "Minor Traffic Control Centres (Basic Weighbridge)", appliesTo: ["DS - ELECTRONIC SYSTEMS"] },
  { code: "ROUTE DETERMINATION", label: "Route Determination", appliesTo: ["DS - Geometrics (Book 1 T-20 only)"] },
  { code: "GEOHAZARD INVESTIGATION (SLOPE STABILITY)", label: "Geohazard Investigation (Slope Stability)", appliesTo: ["DS - Engineering Geologist (Book 1 T-23 only)"] },
  { code: "GEOHAZARD INVESTIGATION (SUBSIDENCE)", label: "Geohazard Investigation (Subsidence)", appliesTo: ["DS - Engineering Geologist (Book 1 T-23 only)"] },
  { code: "GEOTECHNICAL INVESTIGATION (CL, QUARRY & BP MATERIALS RELATED)", label: "Geotechnical Investigation (CL, Quarry & BP Materials Related)", appliesTo: ["DS - Engineering Geologist (Book 1 T-23 only)"] },
  { code: "GEOTECHNICAL INVESTIGATION (TUNNELLING)", label: "Geotechnical Investigation (Tunnelling)", appliesTo: ["DS - Engineering Geologist (Book 1 T-23 only)"] },
  { code: "GEOPHYSICAL INVESTIGATION (GROUND BASED & AIRBORNE)", label: "Geophysical Investigation (Ground Based & Airborne)", appliesTo: ["DS - Engineering Geologist (Book 1 T-23 only)"] },
];

export type ExperienceItem = {
  id: string;
  company_id: string;
  project_name: string;
  document_type: DocumentType;
  storage_path: string | null;
  original_filename: string | null;
  client_name: string | null;
  contract_number: string | null;
  client_type: string | null;
  disciplines: string[];
  project_type: string | null;
  scope_summary: string | null;
  service_stages: string[];
  value_rm: number | null;
  start_date: string | null;
  completion_date: string | null;
  performance_rating: string | null;
  reference_contact_name: string | null;
  reference_contact_phone: string | null;
  reference_contact_email: string | null;
  notes: string | null;
  tagged_at: string | null;
  created_at: string;
};

export type ExperienceFilters = {
  disciplines?: string[];
  projectTypes?: string[];
  clientTypes?: string[];
  minValueRm?: number;
  /** SANRAL Form B6 uses 10. Excludes items with no completion date. */
  completedWithinYears?: number;
  /** Normally the tender's closing date (YYYY-MM-DD). Defaults to today. */
  asOf?: string;
};

/**
 * "Does this company have experience matching tender requirement X?"
 * Thin wrapper over the experience_matches() SQL function (0012) - tagged
 * rows only, every filter optional. Use `.length` for a count.
 */
export async function findMatchingExperience(
  supabase: SupabaseClient,
  companyId: string,
  f: ExperienceFilters = {}
): Promise<{ items: ExperienceItem[]; error: string | null }> {
  const { data, error } = await supabase.rpc("experience_matches", {
    p_company_id: companyId,
    p_disciplines: f.disciplines ?? null,
    p_project_types: f.projectTypes ?? null,
    p_client_types: f.clientTypes ?? null,
    p_min_value_rm: f.minValueRm ?? null,
    p_completed_within_years: f.completedWithinYears ?? null,
    ...(f.asOf ? { p_as_of: f.asOf } : {}),
  });
  return { items: (data ?? []) as ExperienceItem[], error: error?.message ?? null };
}

export function labelFor<T extends { value: string; label: string }>(list: readonly T[], value: string | null): string {
  if (!value) return "";
  return list.find((x) => x.value === value)?.label ?? value;
}

/** Evidence SANRAL B6 actually scores (the rest prove completion/appointment only). */
export function isScoreableEvidence(t: string): boolean {
  return t === "reference_letter" || t === "performance_report";
}
