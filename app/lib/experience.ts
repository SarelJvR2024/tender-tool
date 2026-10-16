// Company experience library: taxonomy + the one query a tender-compliance
// check needs. Schema: supabase/migrations/0012_experience_items.sql.
// Evidence for every list below: docs/specs/Experience-Library-Findings.md.
//
// For whoever builds a tender compliance check (e.g. the readiness report on
// app/app/tenders/[id]/page.tsx): call findMatchingExperience() with the
// tender's discipline categories (engine/discovery/assess_tender.py
// categorize() output - DISCIPLINES below uses exactly those keys) and, for
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

// Exactly engine/discovery/assess_tender.py DISCIPLINE_KEYWORDS keys, so a
// discovered tender's categories match this column directly. Do not add a key
// here without adding it there (and to the 0012 check constraint).
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

// SANRAL project-type codes, verbatim from a real tender's Book 1
// (R.396-010-2025/1F, "lists with ... different project types"). Offered as
// suggestions only - other buyers don't code project types, so the column is
// free text.
export const SANRAL_PROJECT_TYPES: { code: string; label: string }[] = [
  { code: "MO/MA", label: "Maintenance Operations and Ad-hoc Maintenance (excl. RRM)" },
  { code: "MP/MS", label: "Periodic Maintenance and Special Maintenance" },
  { code: "DS", label: "Development Strengthening" },
  { code: "DI", label: "Development Improvement" },
  { code: "DN", label: "Development New Facilities" },
  { code: "CD", label: "Community Development" },
  { code: "RRM", label: "Routine Road Maintenance" },
  { code: "MSC", label: "Special Maintenance Concrete" },
  { code: "MSB", label: "Maintenance Special Bridge" },
  { code: "DIB", label: "Development Improvement Bridge" },
  { code: "DNB", label: "Development New Bridge" },
  { code: "MSS", label: "Maintenance Special Structures" },
  { code: "DIS", label: "Development Improvement Structures" },
  { code: "DNS", label: "Development New Structures" },
  { code: "STREET LIGHTING", label: "Street Lighting" },
  { code: "TRAFFIC LIGHTS", label: "Traffic Lights" },
  { code: "BUILDING RETICULATION", label: "Building Reticulation" },
  { code: "INTERSECTION IMPROVEMENTS", label: "Intersection Improvements" },
  { code: "CAPACITY IMPROVEMENT", label: "Capacity Improvement" },
  { code: "ADDITIONAL LANES", label: "Additional Lanes" },
  { code: "INTERCHANGE DESIGN", label: "Interchange Design" },
  { code: "H/V RE-ALIGNMENT", label: "Horizontal / Vertical Re-Alignment" },
  { code: "NEW ALIGNMENT", label: "New Alignment" },
  { code: "ROUTE DETERMINATION", label: "Route Determination" },
  { code: "TOLLS", label: "Tolls" },
  { code: "FMS", label: "Freeway Management Systems" },
  { code: "ITS systems", label: "ITS systems" },
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
