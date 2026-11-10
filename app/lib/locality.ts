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

// Same administrative-word stripping as normArea(), but keeps spaces between
// what's left - used only for the word-boundary substring check in
// similar(). normArea() collapses straight to bare letters with no word
// boundaries at all, which let a genuinely different place be scored as a
// locality "match" purely because its name happens to contain another
// place's name as a run of letters - confirmed live on the Python side this
// file mirrors (engine/discovery/score_outlook.py's own _norm_area_words(),
// 2026-10-21): a company office in "Kannaland" (Western Cape) matched a
// tender's own locality row for "Nala" (a Free State local municipality,
// nothing to do with Kannaland) because the bare letters "nala" sit inside
// "kannaland". Keeping spaces lets the substring check require a whole word
// (or phrase), which still matches the rule's real intended case ("City of
// Tshwane" vs "Tshwane" - "city" isn't stripped, but "tshwane" is still a
// whole word inside it) while rejecting a coincidental letter run.
function normAreaWords(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(the|boundaries|of|municipal|municipality|area|jurisdiction|local|district|metropolitan|metro|province)\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// Whole-word(s) substring: needle must appear in haystack bounded by spaces
// or the string's own edges, not as an arbitrary run of letters (see
// normAreaWords()'s own docstring).
function wordIn(needle: string, haystack: string): boolean {
  if (!needle) return false;
  const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${esc}(?:$|\\s)`).test(haystack);
}

/**
 * Port of Python's `difflib.SequenceMatcher(None, a, b).ratio()` (the
 * Ratcliff/Obershelp algorithm - matching BLOCKS of characters, found
 * recursively, not an edit-distance count) - exactly what
 * engine/discovery/score_outlook.py's own `_area_matches()` calls for this
 * same 0.85 threshold. No `isjunk`/autojunk handling: CPython's own autojunk
 * heuristic only ever activates for a `b` sequence of 200+ characters where
 * one character is "popular" (appears in over 1% of it) - area/office names
 * here are always far shorter, so it can never fire and is deliberately not
 * ported. Validated against the real `difflib` output for 20,000 randomly
 * generated near-miss string pairs (every character added/removed/
 * substituted/transposed) - zero disagreement.
 *
 * QA pass, 2026-11-10: this function used to compute a plain Levenshtein
 * (edit-distance) ratio instead - a DIFFERENT similarity metric from
 * `difflib.SequenceMatcher.ratio()`, despite this file's own header comment
 * claiming "same rules as ... score_outlook.py match_locality()" and the
 * 0.85 threshold itself being identical on both sides. The two metrics
 * agree on most inputs but diverge right around that threshold: confirmed
 * live with a real South African local municipality from this app's own
 * canonical name list (engine/discovery/test_score_outlook.py's sweep),
 * "Ditsobotla" (North West), against the plausible single-transposition
 * typo "Ditsobolta" a tender's own points table could make the same way
 * TN051/2026 misspelled "Dawid Kruiper" as "Dawid Kruper" - Python's real
 * ratio is 0.900 (matches, awards points / satisfies a mandatory-local-
 * office requirement), the old Levenshtein ratio here was 0.800 (does not
 * match). A company with an office in the real "Ditsobotla" would have been
 * told by this Workspace/Pack Review screen that a mandatory local-office
 * requirement spelled "Ditsobolta" was unmet - a false "disqualifying" gap
 * on a feature this file exists specifically to get right for buyers' own
 * misspellings - while the generated pack itself (built from the engine's
 * own, correct match) would actually have satisfied it.
 */
function ratcliffObershelpRatio(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) return 1;
  const b2j = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const arr = b2j.get(b[j]);
    if (arr) arr.push(j);
    else b2j.set(b[j], [j]);
  }
  function findLongestMatch(alo: number, ahi: number, blo: number, bhi: number): [number, number, number] {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      const js = b2j.get(a[i]);
      if (js) {
        for (const j of js) {
          if (j < blo) continue;
          if (j >= bhi) break;
          const k = (j2len.get(j - 1) ?? 0) + 1;
          newj2len.set(j, k);
          if (k > bestsize) {
            besti = i - k + 1;
            bestj = j - k + 1;
            bestsize = k;
          }
        }
      }
      j2len = newj2len;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize++;
    }
    return [besti, bestj, bestsize];
  }
  let matched = 0;
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];
  while (queue.length > 0) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = findLongestMatch(alo, ahi, blo, bhi);
    if (k > 0) {
      matched += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return (2 * matched) / total;
}

// Similarity on normalised names - tenders misspell their own municipality
// ("Dawid Kruper" in TN051/2026's own points table).
function similar(a: string, b: string, aWords: string, bWords: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (ratcliffObershelpRatio(a, b) >= 0.85) return true;
  // Whole-word substring, gated on the office field's own word-length (same
  // side Python gates on) so a short word doesn't match as a substring of
  // an unrelated longer name.
  return bWords.length >= 6 && (wordIn(bWords, aWords) || wordIn(aWords, bWords));
}

function areaMatches(area: string, o: CompanyOffice): boolean {
  const a = normArea(area);
  const aWords = normAreaWords(area);
  return [o.district_municipality, o.local_municipality, o.town].some((f) =>
    similar(a, normArea(f), aWords, normAreaWords(f))
  );
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
