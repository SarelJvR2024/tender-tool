// SANRAL Conventional Consultant tender: functionality (quality) score
// ESTIMATE, from the key people assigned to a tender and their project
// history - the one buyer whose evaluation method is published in enough
// detail to compute part of the score before submitting.
//
// Source (read in full, not paraphrased from memory): R.396-010-2025/1F Book 1,
// Tender Data C.3.11 Stage 3 (pp. T-12/T-13) and "ANNEXURE A - SANRAL -
// EXPLANATION OF CONSULTANT TENDER EVALUATION SCORING FOR CONVENTIONAL
// PROJECTS" (pp. T-17 to T-29), in templates/incoming/R.396-010-2025.1F/.
// All six SANRAL tenders this repo works with share the same template family
// and the same SETUP matrices (checked: SETUP row 9 is identical in all six
// templates/samples/*_ran.xlsm). Evidence and limits written up in
// docs/specs/Tender-Evaluation-Engine-Audit.md.
//
// What it does NOT do, by design:
//   - Workplan Appropriateness (30 pts) depends on every other bidder's
//     normalised hours (80th percentile of the field) - unknowable before
//     closing, always reported as the full 0-30 range.
//   - Quality system (10) and past performance (15) need evidence the schema
//     doesn't hold yet (ISO certificate; CIDB PSP reports / rated reference
//     letters) - reported as ranges unless a caller supplies them.
//   - Price (80/90) and specific goals are a separate stage after the
//     functionality threshold - not part of this score.
// Every unknown is a range, never a guessed point value.

import {
  CLIENT_POINTS,
  MAN_POSITION_COLUMNS,
  MAN_POSITION_ROWS,
  PROJECT_TYPE_MATRICES,
  TECH_POSITION_COLUMNS,
  TECH_POSITION_ROWS,
  baseCode,
  matrixForPosition,
  matrixRowKey,
  normPositionCode,
  normType,
} from "./sanralMatrices";

export type Range = { min: number; max: number };

// Matrices (project type x 9, position held, managerial position held,
// client points) live in sanralMatrices.ts as structured data.
export type SanralProject = {
  client_type: string | null;
  project_type: string | null;
  position_code: string | null;
  start_date: string | null;
  end_date: string | null;
};

export type SanralPositionInput = {
  positionCode: string; // e.g. "PL", "DS1"
  description: string | null; // e.g. "Design Specialist 1 - Pavement and Materials"
  managerial: boolean | null; // null = not on file
  // The tender's own project-type column for this position's matrix (SETUP
  // row 9, e.g. "DI" or "DI/DN"). Not stored in the schema today -> null,
  // which widens the project-type component to a range.
  tenderProjectType: string | null;
  person: { name: string; projects: SanralProject[] } | null;
};

export type PositionEstimate = {
  positionCode: string;
  personName: string | null;
  matrix: string | null;
  projectsCounted: number;
  technical: Range; // out of 45
  management: Range; // out of 15 (non-managerial) or 30 (managerial)
  managementMax: Range;
  notes: string[];
};

export type SanralEstimate = {
  positions: PositionEstimate[];
  technical: Range; // out of 30
  management: Range; // out of 15
  qualitySystem: Range; // out of 10
  pastPerformance: Range; // out of 15
  workplan: Range; // out of 30
  total: Range; // out of 100
  threshold: number;
  outlook: "clears" | "cannot_clear" | "depends";
  outlookText: string;
  notes: string[];
};

const r = (min: number, max: number): Range => ({ min, max });
const add = (a: Range, b: Range): Range => r(a.min + b.min, a.max + b.max);
const round1 = (n: number) => Math.round(n * 10) / 10;
const roundR = (x: Range): Range => r(round1(x.min), round1(x.max));

function yearsBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (365.25 * 24 * 3600 * 1000);
}

// Period relevance (T-24): experience within 10 years of closing = 5, 10-15
// years = 2.5, older = 0; under 6 months' duration = pro-rata. "Experience
// gained" is read as the project's end date (an ongoing project = closing).
function periodPoints(p: SanralProject, closing: Date): Range {
  if (!p.end_date && !p.start_date) return r(0, 5);
  const end = p.end_date ? new Date(p.end_date) : closing;
  const age = yearsBetween(end, closing);
  let pts = age <= 10 ? 5 : age < 15 ? 2.5 : 0;
  if (p.start_date) {
    const months = yearsBetween(new Date(p.start_date), end) * 12;
    if (months >= 0 && months < 6) pts = (pts * months) / 6;
  } else {
    return r(0, pts);
  }
  return r(pts, pts);
}

function projectTypePoints(matrixKey: string | null, tenderType: string | null, experienceType: string | null): Range {
  if (!matrixKey) return r(0, 5);
  const m = PROJECT_TYPE_MATRICES[matrixKey];
  const row = m.rows[matrixRowKey(matrixKey, experienceType) ?? "NONE"];
  if (tenderType) {
    const idx = m.columns.indexOf(normType(tenderType));
    if (idx >= 0) return r(row[idx], row[idx]);
  }
  return r(Math.min(...row), Math.max(...row));
}

function lookup(rows: Record<string, number[]>, cols: string[], held: string | null, required: string): number | null {
  const col = cols.indexOf(required);
  if (col < 0) return null;
  const row = rows[normPositionCode(held)];
  return row ? row[col] : 0; // unknown held code = SANRAL's own "Undefined" row (0)
}

function capSum(values: Range[], cap: number): Range {
  const s = values.reduce(add, r(0, 0));
  return r(Math.min(s.min, cap), Math.min(s.max, cap));
}

export function estimatePosition(input: SanralPositionInput, closing: Date): PositionEstimate {
  const required = normPositionCode(baseCode(input.positionCode));
  const matrix = matrixForPosition(input.positionCode, input.description);
  const notes: string[] = [];
  // SANRAL's managerial position-held matrix only has PL/CE/RE/RM (+ toll)
  // columns, so any other position is scored as non-managerial.
  const managerial = input.managerial === true && MAN_POSITION_COLUMNS.includes(required);
  const managerialMax = managerial ? r(30, 30) : r(15, 15);

  if (!input.person) {
    notes.push("No key person assigned - this position scores 0 until one is.");
    return { positionCode: input.positionCode, personName: null, matrix, projectsCounted: 0, technical: r(0, 0), management: r(0, 0), managementMax: managerialMax, notes };
  }

  // A project whose type this position's matrix doesn't list can't be put on
  // this position's Form B1 at all (its dropdown doesn't offer the code), so
  // the pack leaves it off and cites the next one (sanral_fill.py
  // projects_for_block) - the estimate does the same, and says so.
  const excluded = matrix ? input.person.projects.filter((p) => matrixRowKey(matrix, p.project_type) === null) : [];
  if (excluded.length > 0) {
    notes.push(
      `${excluded.length} project(s) left off this position's Form B1: project type ${Array.from(new Set(excluded.map((p) => `"${p.project_type}"`))).join(", ")} isn't in SANRAL's ${PROJECT_TYPE_MATRICES[matrix!].title} matrix (offers ${Object.keys(PROJECT_TYPE_MATRICES[matrix!].rows).join(", ")}). They still count on a position whose matrix lists that type.`,
    );
  }
  // Form B1 lists "the most recent 5 projects"; each criterion caps at 15 (3 x 5).
  const projects = input.person.projects
    .filter((p) => !excluded.includes(p))
    .sort((a, b) => (b.end_date ?? b.start_date ?? "").localeCompare(a.end_date ?? a.start_date ?? ""))
    .slice(0, 5);
  if (projects.length === 0) notes.push("No project history on file for this person - technical and management points are 0.");
  if (projects.length > 0 && projects.length < 3) notes.push(`Only ${projects.length} project(s) on file - up to 3 count, so points are being left on the table.`);
  if (!matrix) notes.push("Book 1 publishes no project-type matrix for this position (or its DS specialism isn't in the description) - project-type points shown as 0-5 per project.");
  else if (!input.tenderProjectType) notes.push("Tender's own project type for this position isn't stored - project-type points shown as a range.");

  const typePts = projects.map((p) => projectTypePoints(matrix, input.tenderProjectType, p.project_type));
  const periodPts = projects.map((p) => periodPoints(p, closing));
  const posPts = projects.map((p) => {
    const v = lookup(TECH_POSITION_ROWS, TECH_POSITION_COLUMNS, p.position_code, required);
    return v === null ? r(0, 5) : r(v, v);
  });
  if (!TECH_POSITION_COLUMNS.includes(required)) notes.push(`Position code ${required} isn't in SANRAL's position matrix - position points shown as a range.`);

  const technical = add(add(capSum(typePts, 15), capSum(periodPts, 15)), capSum(posPts, 15));

  const clientPts = projects.map((p) => {
    const v = p.client_type ? CLIENT_POINTS[p.client_type.trim()] : undefined;
    return v === undefined ? r(0, 5) : r(v, v);
  });
  if (projects.some((p) => !p.client_type || CLIENT_POINTS[p.client_type.trim()] === undefined)) {
    notes.push("Some projects have no SANRAL client code on file - client points shown as a range.");
  }
  let management = capSum(clientPts, 15);
  if (managerial) {
    const manPos = capSum(
      projects.map((p) => {
        const v = lookup(MAN_POSITION_ROWS, MAN_POSITION_COLUMNS, p.position_code, required);
        return v === null ? r(0, 5) : r(v, v);
      }),
      15,
    );
    management = add(management, manPos);
  }

  return {
    positionCode: input.positionCode,
    personName: input.person.name,
    matrix,
    projectsCounted: projects.length,
    technical: roundR(technical),
    management: roundR(management),
    managementMax: managerialMax,
    notes,
  };
}

export function estimateSanralConventional(opts: {
  positions: SanralPositionInput[];
  closingDate: string;
  threshold?: number;
  qualitySystem?: "iso" | "registered" | "in_house" | "none" | null;
  // From pastPerformanceFromExperience() once Experience Library rows exist;
  // omitted = no evidence read, full 6-15 range.
  pastPerformance?: { range: Range; note: string } | null;
}): SanralEstimate {
  const closing = new Date(opts.closingDate);
  const threshold = opts.threshold ?? 70;
  // Per-position display uses the non-managerial reading when the flag is
  // unknown; the management total below accounts for both readings.
  const positions = opts.positions.map((p) => estimatePosition({ ...p, managerial: p.managerial ?? false }, closing));
  const notes: string[] = [];

  // "The total for all key persons is totaled and this score is then
  // converted back down into a score of a maximum of 30" (T-25) - read as a
  // straight proportion of the maximum available across all positions.
  const n = Math.max(positions.length, 1);
  const techSum = positions.reduce((acc, p) => add(acc, p.technical), r(0, 0));
  const technical = roundR(r((techSum.min / (45 * n)) * 30, (techSum.max / (45 * n)) * 30));

  // Management: if SANRAL's managerial flag isn't on file for a position,
  // score both readings (it changes the denominator, not just the points)
  // and report the spread - interval arithmetic on the parts alone would
  // combine a low numerator with a high denominator that can't co-occur.
  // Only codes in SANRAL's managerial matrix (PL, CE, RE, RM and the toll
  // equivalents) can be managerial at all - a DS is never uncertain.
  const canBeManagerial = (p: SanralPositionInput) => MAN_POSITION_COLUMNS.includes(normPositionCode(baseCode(p.positionCode)));
  const unknownIdx = opts.positions
    .map((p, i) => (p.managerial === null && canBeManagerial(p) ? i : -1))
    .filter((i) => i >= 0);
  if (unknownIdx.length > 0) {
    notes.push("Whether SANRAL treats some positions as managerial isn't on file (the tender's SETUP sheet says; the schema doesn't store it) - management shown across both readings.");
  }
  const scenarios = unknownIdx.length <= 6 ? 1 << unknownIdx.length : 2;
  let manLo = Infinity;
  let manHi = -Infinity;
  for (let mask = 0; mask < scenarios; mask++) {
    const scenario = opts.positions.map((p, i) => {
      if (p.managerial !== null) return p;
      if (!canBeManagerial(p)) return { ...p, managerial: false };
      const bit = unknownIdx.length <= 6 ? (mask >> unknownIdx.indexOf(i)) & 1 : mask;
      return { ...p, managerial: bit === 1 };
    });
    const est = scenario.map((p) => estimatePosition(p, closing));
    const sum = est.reduce((acc, p) => add(acc, p.management), r(0, 0));
    const max = est.reduce((acc, p) => acc + p.managementMax.max, 0);
    manLo = Math.min(manLo, max ? (sum.min / max) * 15 : 0);
    manHi = Math.max(manHi, max ? (sum.max / max) * 15 : 0);
  }
  const management = roundR(r(manLo, manHi));

  const QS: Record<string, number> = { iso: 10, registered: 7, in_house: 5, none: 0 };
  const qualitySystem = opts.qualitySystem ? r(QS[opts.qualitySystem], QS[opts.qualitySystem]) : r(0, 10);
  if (!opts.qualitySystem) notes.push("Quality system (Form B4): no ISO/QMS evidence on file - 0 to 10 (ISO 10, submitted for ISO 7, in-house 5).");

  const pastPerformance = opts.pastPerformance ? roundR(opts.pastPerformance.range) : r(6, 15);
  if (opts.pastPerformance) {
    notes.push(`Past performance (Form B6): ${opts.pastPerformance.note}`);
  } else {
    notes.push(
      "Past performance (Form B6): no rated reference letters or CIDB PSP reports read - 6 to 15. The 6 floor assumes at least the B6 sworn affidavit is submitted (SANRAL then applies 'Adequate' to missing projects; the book says 2 points for that in one place and 3 in its own table, so 6 is the cautious reading). Omitting B6 entirely would score 0.",
    );
  }

  const workplan = r(0, 30);
  notes.push("Workplan appropriateness (Form C2.4, 30 pts) is scored against the 80th percentile of all bidders' hours - unknowable before closing, so always 0 to 30.");

  const total = roundR([technical, management, qualitySystem, pastPerformance, workplan].reduce(add, r(0, 0)));

  let outlook: SanralEstimate["outlook"];
  let outlookText: string;
  if (total.min >= threshold) {
    outlook = "clears";
    outlookText = `Clears the ${threshold}-point functionality threshold even at the bottom of every unknown range.`;
  } else if (total.max < threshold) {
    outlook = "cannot_clear";
    outlookText = `Cannot reach the ${threshold}-point threshold even at the top of every range - fix the key-person gaps first.`;
  } else {
    const known = add(technical, management);
    const needed = Math.max(0, round1(threshold - known.max));
    outlook = "depends";
    outlookText = `Key persons give about ${known.min === known.max ? known.max : `${known.min}-${known.max}`} of 45. Clearing ${threshold} then needs at least ${needed} of the remaining 55 (quality system, past performance, workplan hours).`;
  }

  return { positions, technical, management, qualitySystem, pastPerformance, workplan, total, threshold, outlook, outlookText, notes };
}

// Past performance (Form B6, T-27): up to 3 completed projects of similar
// scope in the last 10 years, each scored from a CIDB PSP report or a rated
// reference letter (poor 1, adequate 3, good 4, excellent 5). With fewer than
// 3, the sworn-affidavit route applies "Adequate or 2 (two) points" to each
// missing project - the book's own table says Adequate = 3, so each filled
// slot is 2-3. Evidence without a rating on file is 1-5 (SANRAL rates it).
// Award letters / completion certificates / close-out reports prove the
// project but aren't what B6 scores, so they don't count here.
const RATING_POINTS: Record<string, number> = { excellent: 5, good: 4, adequate: 3, poor: 1 };

export function pastPerformanceFromExperience(
  items: { document_type: string; performance_rating: string | null }[],
): { range: Range; note: string } {
  const scoreable = items.filter((i) => i.document_type === "reference_letter" || i.document_type === "performance_report");
  const ranges = scoreable
    .map((i) => {
      const v = i.performance_rating ? RATING_POINTS[i.performance_rating] : undefined;
      return v === undefined ? r(1, 5) : r(v, v);
    })
    .sort((a, b) => b.max - a.max || b.min - a.min)
    .slice(0, 3);
  const affidavitSlots = 3 - ranges.length;
  const total = [...ranges, ...Array.from({ length: affidavitSlots }, () => r(2, 3))].reduce(add, r(0, 0));
  const rated = scoreable.filter((i) => i.performance_rating && RATING_POINTS[i.performance_rating] !== undefined).length;
  const parts = [`${scoreable.length} scoreable item(s) (reference letters / CIDB reports) in the 10-year window, ${rated} with a rating on file`];
  if (affidavitSlots > 0) parts.push(`${affidavitSlots} slot(s) filled by the B6 sworn affidavit at 'Adequate' (2-3 each)`);
  return { range: roundR(r(Math.min(total.min, 15), Math.min(total.max, 15))), note: parts.join("; ") + "." };
}
