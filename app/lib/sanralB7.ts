/**
 * SANRAL Form B7 - "Subcontracting to Targeted Enterprises": does it apply to
 * this tender and this company, and is the company's own answer complete?
 *
 * Mirror of engine/sanral_b7.py (applicability() / check_plan()) - the engine
 * is what fills the form and refuses the pack; this copy lets the Tender
 * Workspace show the same answer before a pack is requested. Keep the two in
 * step (same statuses, same rules, same wording where shown).
 *
 * Evidence for the rule (see the Python module for the full trail):
 * - SANRAL Interim Preferential Procurement Policy, Annexure 3 (consultants):
 *   30% to Targeted Enterprises by contract-value category and the main
 *   tenderer's size - category 1 (< R6m) QSE + Generic, category 2 (R6-25m)
 *   Generic only, category 3 (> R25m) everyone.
 * - Every SANRAL Technical workbook states its own category (SETUP!L1) and the
 *   matrix itself (SETUP!J27:L35); the bridge stores what it reads in
 *   tenders.sanral_b7_setup. The contract value is never captured or guessed.
 * - A tender's own Book 1 can waive it (R.396-010-2025/1F): recorded by the
 *   company with the Book 1 text quoted, never assumed.
 * Sarel, 2026-10-17: "B7 must be answered by the company."
 */

export const B7_CATEGORY_BANDS: Record<number, string> = {
  1: "under R6 million",
  2: "R6 million to R25 million",
  3: "over R25 million",
};
export const B7_MAX_TES = 4;
export const B7_POLICY_MIN_PCT = 30;
export const B7_TBC_NAME = "To be identified after tender award";

export type B7Size = "EME" | "QSE" | "GENERIC";
export type B7Setup = {
  category: number | null;
  compulsory?: string | null;
  required_by_size?: Partial<Record<B7Size, boolean>>;
  read_at?: string;
} | null;

export type TargetedEnterprise = {
  name: string | null;
  to_be_identified: boolean;
  size: "EME" | "QSE" | null;
  pct_of_contract: number | null;
  pct_excl_provisional: number | null;
  black_ownership_pct: number | null;
  bee_level: number | null;
  head_office: string | null;
  in_project_province: "YES" | "NO" | null;
  consulting_engineering_firm: "YES" | "NO" | null;
  tax_reference: string | null;
};

export type SubcontractingPlan = {
  mode: "subcontract" | "waived_by_tender";
  waiver_quote: string | null;
  targeted_enterprises: TargetedEnterprise[];
  comments: string | null;
  updated_at?: string;
};

export type B7Applicability = {
  status: "waived" | "not_required" | "required" | "unknown";
  needsPlan: boolean;
  reason: string;
};

export const PLAN_COLUMNS = "mode, waiver_quote, targeted_enterprises, comments, updated_at";

export function normaliseSize(status: string | null | undefined): B7Size | null {
  const s = (status ?? "").trim().toUpperCase();
  return s === "EME" || s === "QSE" || s === "GENERIC" ? s : null;
}

export function b7Applicability(setup: B7Setup, companyStatus: string | null | undefined, plan: SubcontractingPlan | null): B7Applicability {
  if (plan?.mode === "waived_by_tender") {
    const quote = (plan.waiver_quote ?? "").split(/\s+/).filter(Boolean).join(" ");
    return {
      status: "waived",
      needsPlan: false,
      reason:
        "this tender's own Book 1 (Form B7 page) says B7 is not required - recorded by your company" +
        (quote ? `: "${quote}"` : ""),
    };
  }
  const category = setup?.category ?? null;
  const size = normaliseSize(companyStatus);
  if (category === null || !B7_CATEGORY_BANDS[category]) {
    return {
      status: "unknown",
      needsPlan: true,
      reason:
        "the tender's category (contract-value band) hasn't been read from its Technical workbook yet, so B7 is treated as required until you answer it",
    };
  }
  const band = B7_CATEGORY_BANDS[category];
  if (size === null) {
    return {
      status: "unknown",
      needsPlan: true,
      reason: `Category ${category} tender (${band}); your company's size (EME / QSE / Generic) isn't recorded on the Company page, so B7 is treated as required until you answer it`,
    };
  }
  const rule = setup?.required_by_size?.[size];
  if (rule === undefined || rule === null) {
    return {
      status: "unknown",
      needsPlan: true,
      reason: `Category ${category} tender (${band}); this template's SETUP table has no row for tenderer size ${size}, so B7 is treated as required until you answer it`,
    };
  }
  if (rule) {
    return {
      status: "required",
      needsPlan: true,
      reason: `Category ${category} tender (${band}) and your company's size is ${size}: SANRAL's policy makes subcontracting at least ${B7_POLICY_MIN_PCT}% to Targeted Enterprises a contract condition (table on this template's SETUP sheet)`,
    };
  }
  return {
    status: "not_required",
    needsPlan: false,
    reason: `not required - Category ${category} tender (${band}) and your company's size is ${size}: SANRAL's policy asks no subcontracting (table on this template's SETUP sheet)`,
  };
}

const isPct = (v: number | null, allowZero: boolean) =>
  v !== null && Number.isFinite(v) && v >= 0 && v <= 100 && (allowZero || v > 0);

/** Errors block the pack; warnings are shown and listed in the pack. */
export function checkPlan(plan: SubcontractingPlan | null, applies?: B7Applicability | null): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!plan) return { errors: ["no subcontracting plan captured"], warnings };
  if (plan.mode === "waived_by_tender") {
    if (!(plan.waiver_quote ?? "").trim()) errors.push("quote the tender's own Book 1 text that says Form B7 is not required");
    return { errors, warnings };
  }
  const tes = plan.targeted_enterprises ?? [];
  if (tes.length === 0) errors.push("add at least one Targeted Enterprise");
  if (tes.length > B7_MAX_TES) errors.push(`SANRAL's Form B7 holds at most ${B7_MAX_TES} Targeted Enterprises`);
  let total = 0;
  let local = 0;
  tes.slice(0, B7_MAX_TES).forEach((te, idx) => {
    const i = idx + 1;
    const who = (te.name ?? "").trim() || `Targeted Enterprise ${i}`;
    if (!te.to_be_identified && !(te.name ?? "").trim()) errors.push(`Targeted Enterprise ${i}: give its name, or mark it as to be identified after award`);
    if (te.size !== "EME" && te.size !== "QSE") errors.push(`${who}: state whether it is an EME or a QSE`);
    if (!isPct(te.pct_of_contract, false)) errors.push(`${who}: % of contract price must be a percentage above 0`);
    if (!isPct(te.pct_excl_provisional, false)) errors.push(`${who}: % of contract price excluding provisional sums must be a percentage above 0`);
    if (!isPct(te.black_ownership_pct, true)) errors.push(`${who}: % black ownership must be a percentage`);
    const lvl = te.bee_level;
    if (lvl === null || !Number.isInteger(lvl) || lvl < 1 || lvl > 8) errors.push(`${who}: B-BBEE status level must be 1 to 8`);
    const pct = te.pct_excl_provisional ?? 0;
    total += pct;
    if (te.in_project_province === "YES") local += pct;
    if ((te.black_ownership_pct !== null && te.black_ownership_pct < 51) || (lvl !== null && lvl > 2)) {
      warnings.push(`${who}: a Targeted Enterprise must be at least 51% black owned with B-BBEE level 1 or 2 (Conditions of Contract, Clause 1 Definitions) - this one doesn't meet that`);
    }
    if (te.to_be_identified) {
      warnings.push(`Targeted Enterprise ${i} is not named yet ("${B7_TBC_NAME}") - SANRAL asks for a duplicate Form B7 signed by both you and each Targeted Enterprise`);
    }
    if (!te.in_project_province) {
      warnings.push(`${who}: "Is the TE based in the province of the project?" not answered - the form's local sub-target then counts it as 0%`);
    }
  });
  const fmt = (n: number) => `${Math.round(n * 1000) / 1000}`;
  if (tes.length > 0 && applies?.needsPlan && total < B7_POLICY_MIN_PCT) {
    warnings.push(`Targeted Enterprises total ${fmt(total)}% of the contract price (excl. provisional sums) - below SANRAL's ${B7_POLICY_MIN_PCT}% minimum; the form will show NOT ACCEPTABLE`);
  }
  if (tes.length > 0 && total > 0 && local < total / 3) {
    warnings.push(`Local Targeted Enterprises (based in the project's province) carry ${fmt(local)}% of ${fmt(total)}% - SANRAL encourages at least a third`);
  }
  return { errors, warnings };
}

/** Parse a plan out of untrusted JSON (the Workspace form), field by field. */
export function parsePlan(raw: unknown): SubcontractingPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 2000) : null);
  const num = (v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").replace("%", "").trim());
    return Number.isFinite(n) ? n : null;
  };
  const yn = (v: unknown) => (v === "YES" || v === "NO" ? v : null);
  const mode = r.mode === "waived_by_tender" ? "waived_by_tender" : r.mode === "subcontract" ? "subcontract" : null;
  if (!mode) return null;
  const tes = Array.isArray(r.targeted_enterprises) ? r.targeted_enterprises : [];
  return {
    mode,
    waiver_quote: mode === "waived_by_tender" ? str(r.waiver_quote) : null,
    comments: str(r.comments),
    targeted_enterprises:
      mode === "subcontract"
        ? tes.slice(0, B7_MAX_TES + 1).map((t) => {
            const te = (t ?? {}) as Record<string, unknown>;
            const tbc = te.to_be_identified === true;
            const size = te.size === "EME" || te.size === "QSE" ? te.size : null;
            return {
              name: tbc ? null : str(te.name),
              to_be_identified: tbc,
              size,
              pct_of_contract: num(te.pct_of_contract),
              pct_excl_provisional: num(te.pct_excl_provisional),
              black_ownership_pct: num(te.black_ownership_pct),
              bee_level: num(te.bee_level),
              head_office: str(te.head_office),
              in_project_province: yn(te.in_project_province),
              consulting_engineering_firm: yn(te.consulting_engineering_firm),
              tax_reference: str(te.tax_reference),
            };
          })
        : [],
  };
}
