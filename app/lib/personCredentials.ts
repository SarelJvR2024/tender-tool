import type { SupabaseClient } from "@supabase/supabase-js";
import { expiryStatus, type StatusChip } from "./dates.ts";

// Per-person professional registrations that carry an expiry / renewal date
// (migrations 0035, 0040). Mirrors engine/compliance/watch_deadlines.py
// TRACKED_PERSON_EXPIRY_FIELDS - same columns, and the same 60-day
// expiryStatus() threshold as the Document Vault, so the badge here and the
// reminder agree on "renew soon".
//
// `conditional` registrations (SACNASP, SAGC - 0040, audit Q5) are part of the
// record but NOT asked for on every person. Sarel, 2026-10-17: "We can
// accommodate that into the structure, but don't specifically ask for it
// unless the tender requires it." The People page shows their fields only
// when the person already holds one or a tender on the system asks for that
// body (registrationsAskedFor below); otherwise they sit behind a closed
// "add another registration" disclosure.
//
// SACAP, SACPLAN, SACQSP, SACPVP and PSIRA (audit O4) follow the SAME rule but
// are NOT columns: they live in the shared registrations catalog (0050
// registration_types + held_registrations, slug = the body in lower case),
// where a person (or the company, for PSIRA) can hold several. The People
// page shows a body's catalog entries for this person only when a tender on
// the system asks for that body, or the person already holds one; the
// expiry reminder is the catalog's own (registration_reminders.py).
export const PERSON_CREDENTIALS = [
  { body: "ECSA", numberKey: "ecsa_number", levelKey: "ecsa_level", expiryKey: "ecsa_expiry", conditional: false },
  { body: "SACPCMP", numberKey: "sacpcmp_number", levelKey: null, expiryKey: "sacpcmp_expiry", conditional: false },
  { body: "SACNASP", numberKey: "sacnasp_number", levelKey: "sacnasp_category", expiryKey: "sacnasp_expiry", conditional: true },
  { body: "SAGC", numberKey: "sagc_number", levelKey: "sagc_category", expiryKey: "sagc_expiry", conditional: true },
] as const;

export type PersonCredentialFields = {
  ecsa_level?: string | null;
  ecsa_number?: string | null;
  ecsa_expiry?: string | null;
  sacpcmp_number?: string | null;
  sacpcmp_expiry?: string | null;
  sacnasp_category?: string | null; // 0040
  sacnasp_number?: string | null;
  sacnasp_expiry?: string | null;
  sagc_category?: string | null; // 0040
  sagc_number?: string | null;
  sagc_expiry?: string | null;
};

/** Column list for selecting every credential field (0035 + 0040). */
export const PERSON_CREDENTIAL_COLUMNS =
  "ecsa_level, ecsa_number, ecsa_expiry, sacpcmp_number, sacpcmp_expiry, sacnasp_category, sacnasp_number, sacnasp_expiry, sagc_category, sagc_number, sagc_expiry";

export type CredentialExpiry = { body: string; expiry: string | null; status: StatusChip };

// One entry per registration the person actually holds (a number or level on
// file) or has an expiry recorded for. A held registration with no expiry
// recorded is grey "Renewal date not on file" - never treated as expired. A
// conditional body the person doesn't hold produces nothing, so it never
// shows up as a chip or a badge on someone it doesn't apply to.
export function credentialExpiries(p: PersonCredentialFields): CredentialExpiry[] {
  const out: CredentialExpiry[] = [];
  for (const c of PERSON_CREDENTIALS) {
    const expiry = p[c.expiryKey] ?? null;
    const held = !!p[c.numberKey] || (c.levelKey ? !!p[c.levelKey] : false);
    if (!held && !expiry) continue;
    const status = expiry
      ? expiryStatus(expiry)
      : { label: "Renewal date not on file", tone: "muted" as const };
    out.push({ body: c.body, expiry, status });
  }
  return out;
}

export function credentialChipLabel(c: CredentialExpiry): string {
  if (!c.expiry) return `${c.body}: renewal date not on file`;
  const d = new Date(c.expiry).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  if (c.status.label === "Expired") return `${c.body} expired ${d}`;
  if (c.status.label === "Renew soon") return `${c.body} renew by ${d}`;
  return `${c.body} valid to ${d}`;
}

/** Does the person hold (any field of) this conditional registration? */
export function holdsRegistration(p: PersonCredentialFields, body: ConditionalBody): boolean {
  const c = PERSON_CREDENTIALS.find((x) => x.body === body)!;
  return !!p[c.numberKey] || !!p[c.expiryKey] || (c.levelKey ? !!p[c.levelKey] : false);
}

export type ConditionalBody = "SACNASP" | "SAGC";
export const CONDITIONAL_BODIES: ConditionalBody[] = ["SACNASP", "SAGC"];

/** The people columns of a column-held conditional body (0040). */
export function bodyKeys(body: ConditionalBody) {
  const k = body.toLowerCase() as Lowercase<ConditionalBody>;
  return { category: `${k}_category` as const, number: `${k}_number` as const, expiry: `${k}_expiry` as const };
}
/** The SACNASP / SAGC columns, as a literal so supabase-js can type a select. */
export const CONDITIONAL_REGISTRATION_COLUMNS = "sacnasp_category, sacnasp_number, sacnasp_expiry, sagc_category, sagc_number, sagc_expiry" as const;

// Catalog-held bodies (0050 registration_types.slug = lower-case body).
export type CatalogBody = "SACAP" | "SACPLAN" | "SACQSP" | "SACPVP" | "PSIRA";
export const CATALOG_BODIES: CatalogBody[] = ["SACAP", "SACPLAN", "SACQSP", "SACPVP", "PSIRA"];
export const catalogSlug = (b: CatalogBody) => b.toLowerCase();
/** Any body a tender can ask for that is NOT on every person's record. */
export type RequiredBody = ConditionalBody | CatalogBody;
export const REQUIRED_BODIES: RequiredBody[] = [...CONDITIONAL_BODIES, ...CATALOG_BODIES];
export const isColumnBody = (b: string): b is ConditionalBody => (CONDITIONAL_BODIES as string[]).includes(b);
export const isCatalogBody = (b: string): b is CatalogBody => (CATALOG_BODIES as string[]).includes(b);
export const isRequiredBody = (b: string): b is RequiredBody => isColumnBody(b) || isCatalogBody(b);

/** One catalog registration a person holds (held_registrations + its type's slug). */
export type HeldCatalogRegistration = {
  id: string;
  person_id: string | null;
  slug: string;
  registration_number: string | null;
  category: string | null;
  expiry_date: string | null;
};
/** held_registrations rows for these people, with the type's slug (0050). */
export async function loadHeldCatalogRegistrations(supabase: SupabaseClient, personIds: string[]): Promise<HeldCatalogRegistration[]> {
  if (personIds.length === 0) return [];
  const { data } = await supabase
    .from("held_registrations")
    .select("id, person_id, registration_number, category, expiry_date, registration_types!inner(slug)")
    .in("person_id", personIds);
  return ((data ?? []) as unknown as (Omit<HeldCatalogRegistration, "slug"> & { registration_types: { slug: string } })[]).map((r) => ({
    id: r.id,
    person_id: r.person_id,
    slug: r.registration_types.slug,
    registration_number: r.registration_number,
    category: r.category,
    expiry_date: r.expiry_date,
  }));
}

export const REGISTRATION_BODY_INFO: Record<RequiredBody, { name: string; categories: string[]; example: string }> = {
  SACNASP: {
    name: "SA Council for Natural Scientific Professions",
    categories: ["Pr.Sci.Nat (Professional Natural Scientist)", "Cand.Sci.Nat (Candidate)", "Cert.Sci.Nat (Certificated)"],
    example: "e.g. an Engineering Geologist (SANRAL C3.1.11: Pr Sci.Nat)",
  },
  SAGC: {
    name: "SA Geomatics Council",
    categories: ["Professional Land Surveyor", "Professional Surveyor", "Geomatics Technologist", "Geomatics Technician", "Candidate"],
    example: "e.g. a Surveyor (SANRAL C3.1.11: SAGC)",
  },
  // Catalog-held (0050) - categories as each council registers them.
  SACAP: {
    name: "SA Council for the Architectural Profession",
    categories: ["Professional Architect", "Professional Senior Architectural Technologist", "Professional Architectural Technologist", "Professional Architectural Draughtsperson", "Candidate"],
    example: "e.g. an architect on a building or PSP tender",
  },
  SACPLAN: {
    name: "SA Council for Planners",
    categories: ["Professional Planner", "Technical Planner", "Candidate Planner"],
    example: "e.g. a town planner (DLRRD NC 001: \"registered with SACPLAN as a Professional Planner\")",
  },
  SACQSP: {
    name: "SA Council for the Quantity Surveying Profession",
    categories: ["Professional Quantity Surveyor", "Candidate Quantity Surveyor"],
    example: "e.g. a Quantity Surveyor (SANRAL N.011-010-2027-1F C3.1.11: SACQSP)",
  },
  SACPVP: {
    name: "SA Council for the Property Valuers Profession",
    categories: ["Professional Valuer", "Professional Associated Valuer", "Candidate Valuer"],
    example: "e.g. a valuer (Maluti TVET: \"a Professional Valuer registered with the SACPVP\")",
  },
  PSIRA: {
    name: "Private Security Industry Regulatory Authority",
    categories: ["Grade A", "Grade B", "Grade C", "Grade D", "Grade E"],
    example: "e.g. security officers on a guarding tender",
  },
};

// The same wording the compliance check uses to decide a position needs the
// body (tenderCompliance.ts checkMinimumRequirement): a SANRAL position whose
// own SETUP description names an Engineering Geologist -> SACNASP, a
// (land/engineering) Surveyor -> SAGC. "Quantity surveyor" is a different
// profession (SACQSP), never SAGC.
export const SACNASP_POSITION_RE = /geolog|natural\s+scien|pr\.?\s*sci\.?\s*nat/i;
export const SAGC_POSITION_RE = /(?<!quantity\s)surveyor|geomatic|land\s+survey/i;
// Catalog bodies, by the profession a SANRAL position names. Quantity
// surveyor -> SACQSP (never SAGC); a landscape architect is SACLAP, not SACAP.
export const SACQSP_POSITION_RE = /quantity\s+surveyor|\bQS\b/i;
export const SACAP_POSITION_RE = /(?<!landscape\s)architect(?!ural\s+engineer)/i;
export const SACPLAN_POSITION_RE = /\bplanner\b|town\s+planning|urban\s+planning/i;
export const SACPVP_POSITION_RE = /\bvaluer\b|valuation/i;
export const PSIRA_POSITION_RE = /security\s+(?:officer|guard|manager|supervisor)|\bguards?\b/i;
export const POSITION_BODY_RES: [RequiredBody, RegExp][] = [
  ["SACNASP", SACNASP_POSITION_RE],
  ["SACQSP", SACQSP_POSITION_RE],
  ["SAGC", SAGC_POSITION_RE],
  ["SACAP", SACAP_POSITION_RE],
  ["SACPLAN", SACPLAN_POSITION_RE],
  ["SACPVP", SACPVP_POSITION_RE],
  ["PSIRA", PSIRA_POSITION_RE],
];

export type AskedFor = Record<RequiredBody, string[]>;

/**
 * Which conditional registrations a tender on the system actually asks for,
 * and which tenders (labels to show). Read from each tender's OWN
 * requirements, never assumed:
 *  - SANRAL: tender_requirements.position_description (the tender's SETUP
 *    sheet) naming an Engineering Geologist / Surveyor;
 *  - general tenders: tenders.document_requirements.person_registrations,
 *    which engine/general/requirements.py fills when the tender's documents
 *    require registration with one of these bodies.
 * Only tenders still open (or with no closing date) count. RLS decides which
 * tenders the user can see.
 */
export async function registrationsAskedFor(supabase: SupabaseClient): Promise<AskedFor> {
  const out: AskedFor = { SACNASP: [], SAGC: [], SACAP: [], SACPLAN: [], SACQSP: [], SACPVP: [], PSIRA: [] };
  const [{ data: reqRows }, { data: generalRows }] = await Promise.all([
    supabase
      .from("tender_requirements")
      .select("position_code, position_description, tenders!inner(id, contract_no, title, status, closing_date)")
      .eq("tenders.status", "open"),
    supabase
      .from("tenders")
      .select("id, contract_no, title, closing_date, document_requirements")
      .eq("status", "open")
      .not("document_requirements->person_registrations", "is", null),
  ]);
  // "now" only after the (request-time) reads above - Cache Components
  // refuses a current-time value before any dynamic data access.
  const nowIso = new Date().toISOString();
  const open = (closing: string | null) => !closing || closing >= nowIso;
  const add = (body: RequiredBody, label: string) => {
    if (!out[body].includes(label)) out[body].push(label);
  };
  type T = { contract_no: string | null; title: string | null; closing_date: string | null };
  const labelOf = (t: T) => t.contract_no || t.title || "a tender";
  for (const r of (reqRows ?? []) as unknown as { position_code: string; position_description: string | null; tenders: T }[]) {
    if (!r.tenders || !open(r.tenders.closing_date)) continue;
    const d = r.position_description ?? "";
    for (const [body, re] of POSITION_BODY_RES) if (re.test(d)) add(body, `${labelOf(r.tenders)} (${r.position_code})`);
  }
  for (const t of (generalRows ?? []) as unknown as (T & { document_requirements: { person_registrations?: { body: string }[] } | null })[]) {
    if (!open(t.closing_date)) continue;
    for (const pr of t.document_requirements?.person_registrations ?? []) {
      if (isRequiredBody(pr.body)) add(pr.body, labelOf(t));
    }
  }
  return out;
}
