// Shared registrations / licences / accreditations catalog (migration 0050
// registration_types) and what a company, a person or a director actually
// holds (held_registrations). Sarel, Q-MD4: "It's either company or person
// specific accreditations or registrations and can have multiple."
//
// Expiry badges use the same expiryStatus() 60-day rule as the Document Vault
// and the per-person ECSA/SACPCMP/SACNASP/SAGC badges, and the same window
// engine/compliance/registration_reminders.py reminds on.

export type RegistrationScope = "company" | "person" | "both";

export const SCOPE_LABELS: Record<RegistrationScope, string> = {
  company: "Held by the company",
  person: "Held by a person",
  both: "Company or person",
};

export const KIND_LABELS: Record<string, string> = {
  professional_council: "Professional council",
  industry_association: "Industry association",
  licence_permit: "Licence / permit",
  accreditation: "Accreditation",
  certification: "Certification",
  clearance: "Clearance",
  registration: "Registration",
};

export type RegistrationType = {
  id: string;
  slug: string;
  label: string;
  issuing_body: string | null;
  scope: RegistrationScope;
  kind: string;
  stored_in: string | null;
  asked_for_by: string | null;
  owner_company_id: string | null;
  active: boolean;
  sort_order: number;
};

export const REGISTRATION_TYPE_COLUMNS = "id, slug, label, issuing_body, scope, kind, stored_in, asked_for_by, owner_company_id, active, sort_order";

export type HeldRegistration = {
  id: string;
  registration_type_id: string;
  person_id: string | null;
  principal_id: string | null;
  registration_number: string | null;
  category: string | null;
  issued_by: string | null;
  issued_on: string | null;
  expiry_date: string | null;
  certified_on: string | null;
  storage_path: string | null;
  original_filename: string | null;
  notes: string | null;
};

export const HELD_COLUMNS =
  "id, registration_type_id, person_id, principal_id, registration_number, category, issued_by, issued_on, expiry_date, certified_on, storage_path, original_filename, notes";

/** Can this type be held by this kind of holder? (mirrors the 0050 trigger) */
export function scopeAllows(scope: RegistrationScope, holder: "company" | "person"): boolean {
  return scope === "both" || scope === holder;
}

/** "person:<uuid>" / "principal:<uuid>" / "company" - the holder picker's value. */
export function parseHolder(v: string | null): { person_id: string | null; principal_id: string | null } | null {
  if (!v || v === "company") return { person_id: null, principal_id: null };
  const [kind, id] = v.split(":");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  if (kind === "person") return { person_id: id, principal_id: null };
  if (kind === "principal") return { person_id: null, principal_id: id };
  return null;
}

/** Where a stored_in type is actually recorded, as a link the page can show. */
export function storedInHint(storedIn: string | null): { text: string; href: string } | null {
  if (!storedIn) return null;
  if (storedIn.startsWith("people.")) return { text: "recorded on each person's page", href: "/people" };
  if (storedIn.includes("cidb")) return { text: "recorded as the CIDB grading on the Company profile", href: "/company?edit=1" };
  if (storedIn.includes("bee")) return { text: "recorded in the Document Vault (B-BBEE proof)", href: "/company" };
  return { text: `recorded in ${storedIn}`, href: "/company" };
}
