// Directors & shareholders register (migration 0050 company_principals) and
// the derived ownership breakdown (view company_ownership_breakdown).
//
// Personal information. ID numbers are shown masked everywhere except the
// edit form of that one person; nothing here logs a value or puts one in a
// URL. Race and disability are POPIA special personal information, recorded
// only for B-BBEE / specific-goals ownership claims (0050 header).

export const PRINCIPAL_ROLES = [
  { value: "director", label: "Director / member (no shares)" },
  { value: "both", label: "Director and shareholder" },
  { value: "shareholder", label: "Shareholder only" },
] as const;
export type PrincipalRole = (typeof PRINCIPAL_ROLES)[number]["value"];

// B-BBEE race groups. "Black people" in the B-BBEE Act = African, Coloured
// and Indian South Africans (and Chinese South Africans, per the 2008 High
// Court order) - the first four.
export const RACES = [
  { value: "african", label: "African", black: true },
  { value: "coloured", label: "Coloured", black: true },
  { value: "indian", label: "Indian", black: true },
  { value: "chinese_sa", label: "Chinese South African", black: true },
  { value: "white", label: "White", black: false },
  { value: "other", label: "Other", black: false },
] as const;

export const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
] as const;

export type PrincipalRow = {
  id: string;
  company_id: string;
  person_id: string | null;
  role: PrincipalRole;
  position: string | null;
  executive: boolean | null;
  appointed_on: string | null;
  holder_type: "natural_person" | "juristic_person";
  full_name: string;
  id_number: string | null;
  passport_number: string | null;
  nationality: string | null;
  sa_citizen: boolean | null;
  date_of_birth: string | null;
  gender: string | null;
  race: string | null;
  disability: boolean | null;
  military_veteran: boolean | null;
  entity_registration_number: string | null;
  ownership_pct: number | null;
  certified_id_path: string | null;
  certified_id_filename: string | null;
  certified_id_on: string | null;
  disability_proof_path: string | null;
  disability_proof_filename: string | null;
  popia_consent_on: string | null;
  notes: string | null;
};

export const PRINCIPAL_COLUMNS =
  "id, company_id, person_id, role, position, executive, appointed_on, holder_type, full_name, id_number, passport_number, nationality, sa_citizen, date_of_birth, gender, race, disability, military_veteran, entity_registration_number, ownership_pct, certified_id_path, certified_id_filename, certified_id_on, disability_proof_path, disability_proof_filename, popia_consent_on, notes";

export type OwnershipBreakdown = {
  shareholders: number;
  total_pct: number | null;
  black_pct: number | null;
  black_women_pct: number | null;
  women_pct: number | null;
  youth_pct: number | null;
  black_youth_pct: number | null;
  disabled_pct: number | null;
  black_disabled_pct: number | null;
  military_veteran_pct: number | null;
  hdi_pct: number | null;
  unclassified_pct: number | null;
};

export const BREAKDOWN_ROWS: { key: keyof OwnershipBreakdown; label: string }[] = [
  { key: "black_pct", label: "Black" },
  { key: "black_women_pct", label: "Black women" },
  { key: "women_pct", label: "Women" },
  { key: "youth_pct", label: "Youth (18-35)" },
  { key: "black_youth_pct", label: "Black youth" },
  { key: "disabled_pct", label: "People with disability" },
  { key: "black_disabled_pct", label: "Black people with disability" },
  { key: "military_veteran_pct", label: "Military veterans" },
  { key: "hdi_pct", label: "HDI (black, women or disabled)" },
];

/** SA ID: 13 digits with a valid Luhn check digit. */
export function isValidSaId(id: string): boolean {
  if (!/^[0-9]{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    let d = Number(id[12 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Date of birth / gender / citizenship as encoded in an SA ID (YYMMDD SSSS C A Z). */
export function parseSaId(id: string | null, today = new Date()): { birth: string | null; gender: "female" | "male" | null; citizen: boolean | null } {
  if (!id || !/^[0-9]{13}$/.test(id)) return { birth: null, gender: null, citizen: null };
  const yy = Number(id.slice(0, 2));
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  let year = 2000 + yy;
  const candidate = new Date(Date.UTC(year, mm - 1, dd));
  if (candidate.getTime() > today.getTime()) year = 1900 + yy;
  const birthDate = new Date(Date.UTC(year, mm - 1, dd));
  const valid = birthDate.getUTCMonth() === mm - 1 && birthDate.getUTCDate() === dd;
  return {
    birth: valid ? birthDate.toISOString().slice(0, 10) : null,
    gender: Number(id.slice(6, 10)) >= 5000 ? "male" : "female",
    citizen: id[10] === "0" ? true : id[10] === "1" ? false : null,
  };
}

export function ageOn(birth: string | null, on = new Date()): number | null {
  if (!birth) return null;
  const b = new Date(birth);
  let age = on.getUTCFullYear() - b.getUTCFullYear();
  const m = on.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

/** "9404150120082" -> "*********0082". Never render the full number in a list. */
export function maskId(id: string | null): string | null {
  if (!id) return null;
  return id.length <= 4 ? "****" : `${"*".repeat(id.length - 4)}${id.slice(-4)}`;
}

export function isBlack(race: string | null): boolean {
  return RACES.some((r) => r.value === race && r.black);
}

// Certification age: tenders accept certified copies certified within 30
// days (Umzimvubu), 3 months (City Power, Joburg Market, ATNS) or 6 months
// (Amatola, Correctional Services, Lepelle, Moqhaka, NW PW, SASSA) -
// Company-Master-Data-List.md §3.1. The strictest common window shown here is
// 3 months; each tender's own rule decides.
export function certificationStatus(certifiedOn: string | null, hasCopy: boolean, today = new Date()) {
  if (!hasCopy) return { label: "No certified copy", bg: "#F0EEE6", color: "#6B6758" };
  if (!certifiedOn) return { label: "Certification date not recorded", bg: "#FEF3C7", color: "#B45309" };
  const days = Math.floor((today.getTime() - new Date(certifiedOn).getTime()) / 86400000);
  if (days <= 90) return { label: `Certified ${days} days ago`, bg: "#DCFCE7", color: "#15803D" };
  if (days <= 180) return { label: `Certified ${days} days ago - too old for 3-month tenders`, bg: "#FEF3C7", color: "#B45309" };
  return { label: `Certified ${days} days ago - recertify`, bg: "#FEE2E2", color: "#B91C1C" };
}

/** Mismatches between what the person typed and what their ID number encodes. */
export function idWarnings(p: Pick<PrincipalRow, "id_number" | "gender" | "sa_citizen">): string[] {
  const out: string[] = [];
  if (!p.id_number) return out;
  if (!isValidSaId(p.id_number)) out.push("ID number check digit is not valid - check it against the ID document.");
  const parsed = parseSaId(p.id_number);
  if (p.gender && parsed.gender && p.gender !== "other" && p.gender !== parsed.gender) {
    out.push(`Gender recorded as ${p.gender}, but the ID number encodes ${parsed.gender}.`);
  }
  if (p.sa_citizen === true && parsed.citizen === false) out.push("Recorded as an SA citizen, but the ID number is a permanent resident's.");
  return out;
}

export const PRINCIPAL_DOCUMENT_KINDS = {
  certified_id: { pathColumn: "certified_id_path", nameColumn: "certified_id_filename", label: "Certified ID copy" },
  disability_proof: { pathColumn: "disability_proof_path", nameColumn: "disability_proof_filename", label: "Disability proof (medical certificate)" },
} as const;
export type PrincipalDocumentKind = keyof typeof PRINCIPAL_DOCUMENT_KINDS;
export function isPrincipalDocumentKind(v: unknown): v is PrincipalDocumentKind {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PRINCIPAL_DOCUMENT_KINDS, v);
}
