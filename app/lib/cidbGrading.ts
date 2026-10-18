// CIDB contractor grading vs. tender value - the small public static
// table behind the free "CIDB grade calculator" lead-magnet tool
// (/tools/cidb-grade). CIDB only appears today scattered inline
// (company profile `cidb_grading`, `generalTender.ts`, taxonomy
// `cidb_classes`) with no standalone grade-vs-value lookup anywhere.
//
// Source: cidb Standard for Contractor Grading Designation (Construction
// Industry Development Board Act 38 of 2000, Regulations, Annexure E /
// Grading Designation table; CIDB Register of Contractors). A contractor
// is graded 1-9 in each class of construction work it is registered for
// (e.g. "7GB" = Grade 7, General Building). Each grade's tender value
// range is the SAME across every class of work - only the grade a given
// contractor actually holds for a given class differs. A contractor may
// tender for (and be awarded) a contract up to the TOP of its grade's
// value range in that class; regulation 11/17 "the potential grading"
// mechanism (biggest contract in the last 5 years, 2x for an ISO-9001
// PSP, etc.) is how a contractor MOVES grades, and is deliberately out
// of scope here - this tool answers "which grade is required for a
// contract of value X", not "what grade does my track record earn me".
//
// Values are in South African Rand, inclusive lower bound (a value
// exactly on a boundary belongs to the lower-numbered grade - e.g.
// exactly R200 000 is still Grade 1, since the published table says
// Grade 1 is "up to and including R200 000" and Grade 2 starts strictly
// above it).

export type CidbBand = { grade: number; minValue: number; maxValue: number | null };

// Upper bounds per grade, in Rand. Grade 9 is uncapped (no maxValue).
export const CIDB_GRADING_TABLE: CidbBand[] = [
  { grade: 1, minValue: 0, maxValue: 200_000 },
  { grade: 2, minValue: 200_001, maxValue: 650_000 },
  { grade: 3, minValue: 650_001, maxValue: 2_000_000 },
  { grade: 4, minValue: 2_000_001, maxValue: 4_000_000 },
  { grade: 5, minValue: 4_000_001, maxValue: 6_500_000 },
  { grade: 6, minValue: 6_500_001, maxValue: 13_000_000 },
  { grade: 7, minValue: 13_000_001, maxValue: 40_000_000 },
  { grade: 8, minValue: 40_000_001, maxValue: 130_000_000 },
  { grade: 9, minValue: 130_000_001, maxValue: null },
];

// CIDB classes of construction work a grading designation is held in
// (the letters after the grade number, e.g. "7GB", "6CE"). Used only to
// label the tool's "class of work" dropdown - the value bands above are
// identical for every class, per the table's own source.
export const CIDB_CLASSES_OF_WORK: { code: string; label: string }[] = [
  { code: "GB", label: "General Building" },
  { code: "CE", label: "Civil Engineering" },
  { code: "EB", label: "Electrical Engineering (Building)" },
  { code: "EP", label: "Electrical Engineering (Infrastructure)" },
  { code: "ME", label: "Mechanical Engineering" },
  { code: "SB", label: "Specialist Building" },
  { code: "SC", label: "Specialist Civil Engineering" },
];

/** Returns the minimum CIDB grade (in any class) required to tender for
 * a contract of the given value, or null for a negative/invalid value.
 * Grade 9 is returned for any value above the table's last capped
 * boundary, since Grade 9 is uncapped. */
export function requiredGradeForValue(contractValueZar: number): number | null {
  if (!Number.isFinite(contractValueZar) || contractValueZar < 0) return null;
  for (const band of CIDB_GRADING_TABLE) {
    if (contractValueZar <= (band.maxValue ?? Infinity)) return band.grade;
  }
  return 9;
}

/** Returns the band a given grade covers, or null for an out-of-range
 * grade (valid grades are 1-9). */
export function bandForGrade(grade: number): CidbBand | null {
  return CIDB_GRADING_TABLE.find((b) => b.grade === grade) ?? null;
}

/** Is a contractor holding `heldGrade` (in the relevant class) allowed to
 * tender for a contract worth `contractValueZar`? Mirrors the
 * requiredGradeForValue check but phrased the way a user actually asks
 * it: "I hold Grade 6 CE, can I tender for this R9m contract?" */
export function gradeSufficientForValue(heldGrade: number, contractValueZar: number): boolean {
  const required = requiredGradeForValue(contractValueZar);
  if (required === null) return false;
  return heldGrade >= required;
}
