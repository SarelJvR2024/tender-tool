import type { SupabaseClient } from "@supabase/supabase-js";
import { expiryStatus, type StatusChip } from "@/lib/dates";

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
      : { label: "Renewal date not on file", bg: "#F0EEE6", color: "#6B6758" };
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

export const REGISTRATION_BODY_INFO: Record<ConditionalBody, { name: string; categories: string[]; example: string }> = {
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
};

// The same wording the compliance check uses to decide a position needs the
// body (tenderCompliance.ts checkMinimumRequirement): a SANRAL position whose
// own SETUP description names an Engineering Geologist -> SACNASP, a
// (land/engineering) Surveyor -> SAGC. "Quantity surveyor" is a different
// profession (SACQSP), never SAGC.
export const SACNASP_POSITION_RE = /geolog|natural\s+scien|pr\.?\s*sci\.?\s*nat/i;
export const SAGC_POSITION_RE = /(?<!quantity\s)surveyor|geomatic|land\s+survey/i;

export type AskedFor = Record<ConditionalBody, string[]>;

/**
 * Which conditional registrations a tender on the system actually asks for,
 * and which tenders (labels to show). Read from each tender's OWN
 * requirements, never assumed:
 *  - SANRAL: tender_requirements.position_description (the tender's SETUP
 *    sheet) naming an Engineering Geologist / Surveyor;
 *  - general tenders: tenders.document_requirements.person_registrations,
 *    which engine/general/requirements.py fills when the tender's documents
 *    require SACNASP / SAGC registration.
 * Only tenders still open (or with no closing date) count. RLS decides which
 * tenders the user can see.
 */
export async function registrationsAskedFor(supabase: SupabaseClient): Promise<AskedFor> {
  const out: AskedFor = { SACNASP: [], SAGC: [] };
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
  const add = (body: ConditionalBody, label: string) => {
    if (!out[body].includes(label)) out[body].push(label);
  };
  type T = { contract_no: string | null; title: string | null; closing_date: string | null };
  const labelOf = (t: T) => t.contract_no || t.title || "a tender";
  for (const r of (reqRows ?? []) as unknown as { position_code: string; position_description: string | null; tenders: T }[]) {
    if (!r.tenders || !open(r.tenders.closing_date)) continue;
    const d = r.position_description ?? "";
    if (SACNASP_POSITION_RE.test(d)) add("SACNASP", `${labelOf(r.tenders)} (${r.position_code})`);
    if (SAGC_POSITION_RE.test(d)) add("SAGC", `${labelOf(r.tenders)} (${r.position_code})`);
  }
  for (const t of (generalRows ?? []) as unknown as (T & { document_requirements: { person_registrations?: { body: string }[] } | null })[]) {
    if (!open(t.closing_date)) continue;
    for (const pr of t.document_requirements?.person_registrations ?? []) {
      if (pr.body === "SACNASP" || pr.body === "SAGC") add(pr.body, labelOf(t));
    }
  }
  return out;
}
