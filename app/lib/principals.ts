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

/**
 * True when `yy mm dd` (the ID's own embedded birth date, as two-digit
 * year/month/day) is a real calendar date in EITHER possible century - the
 * ID has no century digit, so a `yy` of e.g. "90" could be 1990 or 2090
 * (handles 29 Feb correctly for whichever one is the leap year).
 */
function isPlausibleIdDate(yy: number, mm: number, dd: number): boolean {
  if (!(mm >= 1 && mm <= 12)) return false;
  const daysInMonth = (year: number, month1to12: number) => new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
  const maxDay = Math.max(daysInMonth(1900 + yy, mm), daysInMonth(2000 + yy, mm));
  return dd >= 1 && dd <= maxDay;
}

/**
 * SA ID: 13 digits, a valid Luhn check digit, AND a plausible encoded date
 * (month 1-12, day valid for that month/either century) and citizenship
 * digit (0 or 1) - same three checks as
 * `engine/cv/extract_cv_fields.py`'s `_plausible_sa_id()`.
 *
 * Found 2026-11-08, standing review (sibling comparison with that exact
 * Python function, patched the same day for this same gap): this used to
 * be Luhn-only, so a 13-digit number with an impossible embedded date (e.g.
 * month 13, or every digit 0 - both still Luhn-valid) passed as "valid"
 * with no warning here and nothing to stop it being SAVED
 * (`company/principals/actions.ts`'s own hard validation gate calls this),
 * while the CV-extraction pipeline - solving the exact same "is this really
 * someone's SA ID number" question - already refused it. A Luhn-valid
 * random/placeholder number is a realistic data-entry mistake this
 * function exists specifically to catch; checking only the arithmetic
 * checksum and not the date it's supposed to encode let the most obviously
 * wrong ones straight through.
 */
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
  if (sum % 10 !== 0) return false;
  const yy = Number(id.slice(0, 2));
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  if (!isPlausibleIdDate(yy, mm, dd)) return false;
  return id[10] === "0" || id[10] === "1";
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
  if (Number.isNaN(b.getTime())) return null; // unreadable date -> unknown, not NaN
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

// Found 2026-11-10, standing review (Finding 320): this file's own RACES
// comment above defines "black people" per the B-BBEE Act as "African,
// Coloured and Indian South Africans" (plus Chinese South Africans) -
// citizenship is part of the Act's own definition, not an afterthought -
// and migration 0050's company_ownership_breakdown view implements exactly
// that: `race in (...) and coalesce(sa_citizen, true) as is_black`, feeding
// every black_pct/black_women_pct/black_youth_pct/black_disabled_pct/hdi_pct
// column it derives from this register. This function used to check only
// `race`, so a qualifying-race permanent resident (sa_citizen === false) was
// tagged "Black" on their own card in company/principals/page.tsx while the
// ownership percentages shown directly above that same card correctly
// excluded their shares - the chip claimed something the real, server-side
// B-BBEE calculation right next to it did not. `saCitizen` defaults to
// `null` (coalesced to true, same as the view) so an unrecorded citizenship
// status - the common case for a South African-born shareholder who was
// never asked - still counts as black for a qualifying race, same as before
// this fix for everyone who already had the right answer.
export function isBlack(race: string | null, saCitizen: boolean | null = null): boolean {
  return RACES.some((r) => r.value === race && r.black) && (saCitizen ?? true);
}

// Certification age: tenders accept certified copies certified within 30
// days (Umzimvubu), 3 months (City Power, Joburg Market, ATNS) or 6 months
// (Amatola, Correctional Services, Lepelle, Moqhaka, NW PW, SASSA) -
// Company-Master-Data-List.md §3.1. The strictest common window shown here is
// 3 months; each tender's own rule decides.
export function certificationStatus(certifiedOn: string | null, hasCopy: boolean, today = new Date()) {
  if (!hasCopy) return { label: "No certified copy", tone: "muted" as const };
  if (!certifiedOn) return { label: "Certification date not recorded", tone: "warning" as const };
  const days = Math.floor((today.getTime() - new Date(certifiedOn).getTime()) / 86400000);
  if (days <= 90) return { label: `Certified ${days} days ago`, tone: "success" as const };
  if (days <= 180) return { label: `Certified ${days} days ago - too old for 3-month tenders`, tone: "warning" as const };
  return { label: `Certified ${days} days ago - recertify`, tone: "destructive" as const };
}

/**
 * Mismatches between what the person typed and what their ID number encodes.
 *
 * Standing review, 2026-11-09: this already cross-checked gender and
 * sa_citizen against parseSaId()'s own output, but never date_of_birth,
 * even though parseSaId() computes `birth` for exactly this purpose and is
 * already called right here. date_of_birth is a free-typed form field
 * (company/principals/actions.ts's savePrincipal(), independent of
 * id_number) with no validation against the ID at all - a typo, a
 * paste-from-the-wrong-record, or an out-of-date value silently disagreed
 * with the ID-encoded date and nothing told the user. Not cosmetic:
 * ageOn(p.date_of_birth ?? parsed.birth) prefers this typed field over the
 * ID-derived one, and that age feeds migration 0050's own
 * company_ownership_breakdown view (youth_pct/black_youth_pct, filtered on
 * age_years between 18 and 35) - a real B-BBEE ownership-demographics
 * percentage, not just this card's own "Youth" chip. Both sides are
 * plain "YYYY-MM-DD" calendar-day strings (parseSaId()'s own
 * Date.UTC()-built ISO slice, same shape Postgres' `date` columns round-trip
 * as) so this is a direct string comparison, not a timezone-sensitive "now"
 * calculation - none of this session's naive-UTC-anchor day-count class.
 */
export function idWarnings(p: Pick<PrincipalRow, "id_number" | "gender" | "sa_citizen" | "date_of_birth">): string[] {
  const out: string[] = [];
  if (!p.id_number) return out;
  if (!isValidSaId(p.id_number)) out.push("ID number is not valid - check it against the ID document.");
  const parsed = parseSaId(p.id_number);
  if (p.gender && parsed.gender && p.gender !== "other" && p.gender !== parsed.gender) {
    out.push(`Gender recorded as ${p.gender}, but the ID number encodes ${parsed.gender}.`);
  }
  if (p.sa_citizen === true && parsed.citizen === false) out.push("Recorded as an SA citizen, but the ID number is a permanent resident's.");
  if (p.date_of_birth && parsed.birth && p.date_of_birth !== parsed.birth) {
    out.push(`Date of birth recorded as ${p.date_of_birth}, but the ID number encodes ${parsed.birth}.`);
  }
  return out;
}

// Same shape, same reason, as `dealEconomics.ts`'s `needsCreditFallbackOption()`
// (Finding 175): a discarded `people`-select error (or a genuine removal)
// makes a `person_id`-driven <select>'s `defaultValue` match no <option>, so
// the browser silently renders its first option as selected instead. Any
// save of this form then resubmits THAT option's value, silently nulling out
// a real link - here, `company_principals.person_id`, which
// `engine/pack/process_pack_jobs.py`'s `directors_on_record()` reads to pull
// a director's ECSA/SACPCMP registration number onto a real SANRAL Form
// C.1.2.3. Call this before building a person_id <select>'s options, and add
// a synthetic option for `assignedPersonId` when it returns true so the
// currently-picked person is never silently swapped for "No" on an unrelated
// save.
export function needsPersonFallbackOption(assignedPersonId: string | null, people: { id: string }[]): boolean {
  return !!assignedPersonId && !people.some((p) => p.id === assignedPersonId);
}

// Finding 194: `company_ownership_breakdown` (migration 0050) is a GROUP BY
// view with no row at all for a company with zero qualifying shareholders -
// so a genuinely-empty register and a FAILED read of this view both land on
// `.maybeSingle()`'s `data: null`, indistinguishable unless the read's own
// `error` is kept. `/company/principals/page.tsx` used to discard that
// error entirely (a sibling in the same `Promise.all` whose own `error` WAS
// captured, the same single-function divergence shape Finding 193 fixed for
// admin/customers). Real, visible consequence: on a failed read, the page
// showed "No shareholdings recorded yet" directly above a list of principal
// cards that can themselves show a non-zero "% of shares" for the very same
// company - a direct self-contradiction, not just a quiet wrong number.
export type OwnershipBreakdownDisplay = { kind: "ok"; breakdown: OwnershipBreakdown } | { kind: "empty" } | { kind: "error" };

export function resolveOwnershipBreakdown(breakdownRow: OwnershipBreakdown | null | undefined, breakdownError: unknown): OwnershipBreakdownDisplay {
  if (breakdownError) return { kind: "error" };
  if (!breakdownRow || !breakdownRow.shareholders) return { kind: "empty" };
  return { kind: "ok", breakdown: breakdownRow };
}

export const PRINCIPAL_DOCUMENT_KINDS = {
  certified_id: { pathColumn: "certified_id_path", nameColumn: "certified_id_filename", label: "Certified ID copy" },
  disability_proof: { pathColumn: "disability_proof_path", nameColumn: "disability_proof_filename", label: "Disability proof (medical certificate)" },
} as const;
export type PrincipalDocumentKind = keyof typeof PRINCIPAL_DOCUMENT_KINDS;
export function isPrincipalDocumentKind(v: unknown): v is PrincipalDocumentKind {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PRINCIPAL_DOCUMENT_KINDS, v);
}
