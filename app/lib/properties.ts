// Landlord / property tenders (migration 0050 company_properties +
// property_documents; Sarel, Q-MD3: support them). A lease tender asks about
// a BUILDING, so these are per-building records, not company facts.
//
// Only what real open eTenders lease tenders ask for (2026-10-17, quotes in
// docs/specs/Company-Master-Data-List.md §9.3):
//   EC  = EC Agriculture SCMU8-26/27-0143, Joubertina office lease (ocds-9t57fa-174526)
//   NW  = NW Public Works & Roads PWR 39/26, Lichtenburg 154 m2 (ocds-9t57fa-174028)
//   LA  = Legal Aid SA 51/2026, Soweto local office (ocds-9t57fa-174402)
//   RAF = Road Accident Fund PR10118955, Beaufort West (ocds-9t57fa-174264)
// Rent per m2, parking rate, escalation, lease period and availability date
// are priced per tender (pricing schedule), so they are not stored here.

export const OWNERSHIP_BASES = [
  { value: "registered_owner", label: "We are the registered owner (title deed)" },
  { value: "agent_with_mandate", label: "We act for the owner (mandate / letter of authority)" },
  { value: "purchase_or_bond", label: "We are buying it (sale agreement / bond)" },
] as const;

export const SAPOA_GRADES = ["P", "A", "B", "C"] as const;

export type PropertyDocumentType = {
  key: string;
  label: string;
  askedBy: string;
  /** Tender rule on how old the document may be, in months (from its issue date). */
  maxAgeMonths?: number;
  /** Only relevant for this ownership basis. */
  basis?: string;
};

// Same keys as engine/compliance/registration_reminders.py PROPERTY_DOCUMENT_LABELS.
export const PROPERTY_DOCUMENT_TYPES: PropertyDocumentType[] = [
  { key: "title_deed", label: "Title deed", askedBy: "EC, NW, LA, RAF (mandatory at LA phase 2)" },
  { key: "owner_mandate", label: "Owner's mandate / letter of authority", askedBy: "LA 2.2.2, RAF 1.4, EC 10.2", basis: "agent_with_mandate" },
  { key: "purchase_or_bond", label: "Offer to purchase / sale agreement / bond", askedBy: "NW, RAF (registered bond)", basis: "purchase_or_bond" },
  { key: "occupancy_certificate", label: "Occupancy certificate", askedBy: "EC, LA (8 points), RAF" },
  { key: "zoning_certificate", label: "Zoning certificate", askedBy: "LA, NW (original)" },
  { key: "approved_building_plans", label: "Approved building plans", askedBy: "LA, NW" },
  { key: "floor_plan", label: "Floor plan / layout with measurements", askedBy: "NW (tenant layout, site development plans)" },
  { key: "fire_certificate", label: "Fire safety / clearance certificate", askedBy: "EC, LA, NW" },
  { key: "electrical_coc", label: "Electrical certificate of compliance", askedBy: "EC, LA, NW, RAF" },
  { key: "pest_control_certificate", label: "Pest control certificate", askedBy: "LA (issued within 12 months)", maxAgeMonths: 12 },
  { key: "sapoa_grading", label: "SAPOA building grading", askedBy: "NW (not older than 12 months, SAPOA-accredited), RAF (grade B)", maxAgeMonths: 12 },
  { key: "rates_clearance", label: "Municipal rates clearance certificate", askedBy: "EC (contracting stage), NW" },
  { key: "nbr_compliance", label: "National Building Regulations compliance certificate", askedBy: "EC (contracting stage)" },
  { key: "accessibility_compliance", label: "Disability accessibility compliance certificate", askedBy: "EC (contracting stage)" },
  { key: "building_insurance", label: "Building insurance", askedBy: "EC (building insurance information)" },
  { key: "maintenance_plan", label: "Building maintenance plan", askedBy: "LA (2 points + phase 4)" },
];

export type PropertyRow = {
  id: string;
  label: string;
  physical_address: string | null;
  erf_number: string | null;
  town: string | null;
  local_municipality: string | null;
  province: string | null;
  ownership_basis: string | null;
  registered_owner: string | null;
  title_deed_number: string | null;
  gross_lettable_area_m2: number | null;
  parking_bays_covered: number | null;
  parking_bays_open: number | null;
  sapoa_grade: string | null;
  ground_floor_space: boolean | null;
  wheelchair_accessible: boolean | null;
  notes: string | null;
};

export const PROPERTY_COLUMNS =
  "id, label, physical_address, erf_number, town, local_municipality, province, ownership_basis, registered_owner, title_deed_number, gross_lettable_area_m2, parking_bays_covered, parking_bays_open, sapoa_grade, ground_floor_space, wheelchair_accessible, notes";

export type PropertyDocumentRow = {
  id: string;
  property_id: string;
  document_type: string;
  reference_number: string | null;
  issued_on: string | null;
  valid_until: string | null;
  storage_path: string | null;
  original_filename: string | null;
  notes: string | null;
};

export const PROPERTY_DOCUMENT_COLUMNS = "id, property_id, document_type, reference_number, issued_on, valid_until, storage_path, original_filename, notes";

export function isPropertyDocumentType(v: unknown): v is string {
  return typeof v === "string" && PROPERTY_DOCUMENT_TYPES.some((t) => t.key === v);
}

/** Older than the tender rule allows, counted from the issue date. */
export function tooOld(doc: Pick<PropertyDocumentRow, "document_type" | "issued_on">, today = new Date()): string | null {
  const t = PROPERTY_DOCUMENT_TYPES.find((x) => x.key === doc.document_type);
  if (!t?.maxAgeMonths || !doc.issued_on) return null;
  const limit = new Date(doc.issued_on);
  limit.setMonth(limit.getMonth() + t.maxAgeMonths);
  return limit < today ? `Older than ${t.maxAgeMonths} months - ${t.askedBy.split(" (")[0]} won't accept it; get a new one.` : null;
}
