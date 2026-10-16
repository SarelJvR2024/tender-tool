// Company office locations (migration 0015 company_offices) and matching
// them against a tender's locality rows. Same rules as
// engine/discovery/score_outlook.py match_locality(), which does this for
// discovered tenders; this is the Tender Workspace's copy for tenders whose
// rows are stored in tenders.evaluation_rules.locality.
//
// Evidence for the shape (province / district / local municipality, several
// offices, kind of office, proof held): docs/specs/Tender-Evaluation-Engine-
// Audit.md "Round 2" - DPWI EC (province 4), Cape Winelands (district 5 /
// province 5, any head/regional/satellite office), Overberg (district 6 /
// province 4, CIPC registered office), uMlalazi (local 4 / district 2 /
// province 1, and as a functionality criterion), LEDA (Limpopo 3), Dawid
// Kruiper (local 20 + a mandatory local office).

export const PROVINCES = [
  "Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo",
  "Mpumalanga", "Northern Cape", "North West", "Western Cape",
] as const;

export const OFFICE_KINDS = [
  { value: "registered_office", label: "Registered office (CIPC)" },
  { value: "head_office", label: "Head office" },
  { value: "branch", label: "Branch / regional / satellite office" },
  { value: "site_office", label: "Site office" },
] as const;

export const OFFICE_PROOF_TYPES = [
  { value: "municipal_account", label: "Municipal account" },
  { value: "lease_agreement", label: "Lease agreement" },
  { value: "bank_letter", label: "Bank letter confirming address" },
  { value: "cipc_registration", label: "CIPC registration" },
  { value: "title_deed", label: "Title deed" },
  { value: "utility_bill", label: "Utility bill" },
  { value: "affidavit", label: "Affidavit" },
  { value: "other", label: "Other" },
] as const;

export type CompanyOffice = {
  id: string;
  label: string | null;
  office_kind: string;
  province: string;
  district_municipality: string | null;
  local_municipality: string | null;
  town: string | null;
  street_address: string | null;
  proof_type: string | null;
  proof_date: string | null;
  notes: string | null;
};

export const COMPANY_OFFICE_COLUMNS =
  "id, label, office_kind, province, district_municipality, local_municipality, town, street_address, proof_type, proof_date, notes";

export type LocalityRow = {
  area: string;
  level: "province" | "district" | "municipality";
  province: string | null;
  points: number;
  system: "80/20" | "90/10" | null;
  kind: "specific_goals" | "functionality";
  quote?: string;
};

export type LocalityMatch = {
  status: "matched" | "no_match" | "unknown";
  points: number | null;
  row: LocalityRow | null;
  office: CompanyOffice | null;
  reason: string;
};

function normArea(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(the|boundaries|of|municipal|municipality|area|jurisdiction|local|district|metropolitan|metro|province)\b/g, " ")
    .replace(/[^a-z]/g, "");
}

// Similarity on normalised names - tenders misspell their own municipality
// ("Dawid Kruper" in TN051/2026's own points table).
function similar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.length >= 6 && (a.includes(b) || b.includes(a))) return true;
  // Levenshtein distance, as a ratio of the longer name.
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length) >= 0.85;
}

function areaMatches(area: string, o: CompanyOffice): boolean {
  const a = normArea(area);
  return [o.district_municipality, o.local_municipality, o.town].some((f) => similar(a, normArea(f)));
}

export function matchLocality(rows: LocalityRow[], offices: CompanyOffice[]): LocalityMatch {
  if (offices.length === 0) {
    return { status: "unknown", points: null, row: null, office: null, reason: "No office locations on file - add them on the Company page." };
  }
  let best: { row: LocalityRow; office: CompanyOffice } | null = null;
  for (const row of rows) {
    for (const o of offices) {
      const ok = row.level === "province" ? !!row.province && o.province === row.province : areaMatches(row.area, o);
      if (ok && (!best || row.points > best.row.points)) best = { row, office: o };
    }
  }
  if (best) {
    const where = best.office.local_municipality || best.office.district_municipality || best.office.town || best.office.province;
    return {
      status: "matched",
      points: best.row.points,
      row: best.row,
      office: best.office,
      reason: `Office in ${where} matches "${best.row.area}" - ${best.row.points} point(s)${best.row.system ? ` under ${best.row.system}` : ""}.`,
    };
  }
  const provs = Array.from(new Set(offices.map((o) => o.province))).join(", ");
  return { status: "no_match", points: 0, row: null, office: null, reason: `No office in the preferred area(s). Offices on file: ${provs}.` };
}
