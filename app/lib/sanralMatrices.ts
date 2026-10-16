// SANRAL consultant-evaluation matrices as structured data, separate from
// the scoring logic in sanralScoring.ts so a new matrix is a data change, not
// a code change.
//
// Source, read in full: R.396-010-2025/1F Book 1, Annexure A (pp. T-17 to
// T-26), templates/incoming/R.396-010-2025.1F/. The same Book 1 text is in
// all six Conventional tenders this repo works with. The earlier pass
// transcribed 2 project-type matrices; Book 1 actually publishes 9 (T-18 to
// T-23) - all 9 are here. The key-person codes and the matrix list match the
// "Proj Relevance Codes" sheet of SANRAL's own Consultant Technical
// Submission workbook (rows "DS - Structures - MSB" ... in the same order).
//
// Transcription note (stated, not hidden): Book 1 prints most matrix column
// headers as rotated text, which pdftotext emits out of order. Column order
// below follows (a) the horizontal position of each rotated header in the
// -layout output and (b) the workbook's code-list order; every matrix was
// checked to have its 5s on the diagonal (experience == project type), which
// a wrong column order would break. RRM ("CE, RM/ARM - RRM") is listed in the
// workbook but its numbers are not in Book 1 - not transcribed, so RRM-family
// positions still score project type as a 0-5 range.

export type ProjectTypeMatrix = {
  title: string; // as printed in Book 1
  page: string;
  columns: string[]; // tender's project type (SETUP row 9 "Appl. Matrix" suffix)
  rows: Record<string, number[]>; // person's project experience type
};

export const PROJECT_TYPE_MATRICES: Record<string, ProjectTypeMatrix> = {
  PL_CE_RE_CONVENTIONAL: {
    title: "PL, CE, RE - Conventional",
    page: "T-18",
    columns: ["MO/MA", "MP/MS", "DS", "DI", "DN", "CD"],
    rows: {
      NONE: [0, 0, 0, 0, 0, 0],
      "MO/MA": [5, 3, 1, 1, 1, 2],
      "MP/MS": [5, 5, 2, 2, 2, 3],
      DS: [5, 5, 5, 3, 3, 4],
      DI: [5, 5, 5, 5, 4, 5],
      DN: [5, 5, 5, 5, 5, 5],
      CD: [4, 3, 2, 2, 2, 5],
    },
  },
  DS_PAVEMENT_MATERIALS: {
    title: "DS Pavement and Materials",
    page: "T-19",
    columns: ["MP/MS", "MSC", "DS", "DI/DN"],
    rows: {
      NONE: [0, 0, 0, 0],
      "MP/MS": [5, 0, 2, 2],
      MSC: [0, 5, 0, 0],
      DS: [5, 3, 5, 4],
      // Book 1 prints one "DI/DN" experience row; DI and DN are accepted too.
      "DI/DN": [5, 3, 5, 5],
      DI: [5, 3, 5, 5],
      DN: [5, 3, 5, 5],
    },
  },
  DS_STRUCTURES: {
    title: "DS Structures",
    page: "T-19/T-20",
    columns: ["MSB", "DIB", "DNB", "MSS", "DIS", "DNS"],
    rows: {
      NONE: [0, 0, 0, 0, 0, 0],
      MSB: [5, 2, 2, 5, 3, 3],
      DIB: [5, 5, 5, 5, 5, 5],
      DNB: [5, 4, 5, 5, 5, 5],
      MSS: [3, 0, 0, 5, 2, 2],
      DIS: [4, 3, 3, 5, 5, 5],
      DNS: [4, 2, 2, 5, 4, 5],
    },
  },
  DS_ELECTRICAL: {
    title: "DS Electrical",
    page: "T-20",
    columns: ["STREET LIGHTING", "TRAFFIC LIGHTS", "BUILDING RETICULATION"],
    rows: {
      NONE: [0, 0, 0],
      "STREET LIGHTING": [5, 4, 2],
      "TRAFFIC LIGHTS": [2, 5, 1],
      "BUILDING RETICULATION": [1, 3, 5],
    },
  },
  DS_GEOMETRICS: {
    title: "DS Geometrics",
    page: "T-20",
    columns: ["INTERSECTION IMPROVEMENTS", "CAPACITY IMPROVEMENT", "ADDITIONAL LANES", "INTERCHANGE DESIGN", "H/V RE-ALIGNMENT", "NEW ALIGNMENT"],
    rows: {
      NONE: [0, 0, 0, 0, 0, 0],
      "INTERSECTION IMPROVEMENTS": [5, 3, 2, 3, 2, 1],
      "CAPACITY IMPROVEMENT": [4, 5, 3, 2, 3, 3],
      "ADDITIONAL LANES": [4, 3, 5, 3, 4, 4],
      "INTERCHANGE DESIGN": [5, 3, 3, 5, 4, 3],
      "H/V RE-ALIGNMENT": [4, 3, 2, 2, 5, 4],
      "NEW ALIGNMENT": [5, 3, 3, 3, 5, 5],
      "ROUTE DETERMINATION": [0, 0, 0, 0, 2, 5],
    },
  },
  DS_TRAFFIC_TRANSPORTATION: {
    title: "DS Traffic and Transportation",
    page: "T-21",
    columns: [
      "INTERSECTION IMPROVEMENTS", "CAPACITY IMPROVEMENT", "ADDITIONAL LANES", "INTERCHANGE ANALYSIS", "TRAFFIC MODELLING",
      "NEW ALIGNMENT", "PUBLIC TRANSPORT & NMT", "TRAFFIC IMPACT STUDIES", "TRANS ECONOMICS AND FINANCING", "TRANSPORT POLICY", "ITS SYSTEMS",
    ],
    rows: {
      NONE: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      "STRATEGIC MODELLING/ DEMAND FORECASTING": [2, 3, 3, 4, 5, 5, 1, 2, 4, 2, 0],
      "STATIC (MESO) NETWORK SIMULATION MODELS": [5, 5, 5, 5, 5, 5, 2, 4, 2, 2, 2],
      "DYNAMIC (MICRO) SIMULATION MODELLING": [5, 5, 5, 5, 4, 3, 2, 4, 0, 0, 3],
      "TRAFFIC IMPACT STUDIES / LOCAL INTERSECTIONS": [5, 3, 4, 3, 2, 2, 2, 5, 0, 0, 0],
      "NMT AND PT OPERATIONS": [2, 1, 2, 0, 2, 0, 5, 2, 2, 2, 0],
      "TRANSPORT ECONOMIC STUDIES": [0, 0, 0, 0, 2, 3, 2, 0, 5, 3, 0],
      "TRANSPORT POLICY DEVELOPMENT": [0, 0, 0, 0, 0, 0, 2, 0, 3, 5, 0],
      "ITS SYSTEMS": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5],
    },
  },
  DS_GEOTECHNICAL: {
    title: "DS Geotechnical",
    page: "T-22",
    columns: ["DNG", "DIG", "DSG", "MSG"],
    rows: {
      NONE: [0, 0, 0, 0],
      "FOUNDATIONS (PILING, PILE CAPS)": [5, 4, 4, 3],
      "DEEP EXCAVATIONS (DEEP CUTS/HIGH FILLS)": [5, 4, 4, 3],
      "ADDITIONAL LANES": [4, 4, 3, 1],
      "RETAINING STRUCTURES": [4, 4, 4, 4],
      "ROCK ANCHORS (MOUNTAIN PASSES)": [4, 4, 4, 4],
      "MATERIAL & ROCK SOURCES": [5, 4, 4, 3],
      "ENGINEERING GEOPHYSICS": [5, 4, 4, 4],
      "REMOTE SENSING (GIS)": [5, 4, 4, 4],
      "ENGINEERING GEOLOGICAL MAPPING": [5, 4, 4, 3],
      "SUBSURFACE DRAINING (GEOHYDROLOGY)": [5, 4, 4, 4],
    },
  },
  DS_ELECTRONIC_SYSTEMS: {
    title: "DS Electronic Systems",
    page: "T-22/T-23",
    columns: ["MAJOR TCC (WEIGH BRIDGES)", "TOLLS", "FMS", "MINOR TCC (BASIC WEIGH BRIDGE)"],
    rows: {
      NONE: [0, 0, 0, 0],
      "MAJOR TCC (WEIGH BRIDGES)": [5, 4, 2, 3],
      TOLLS: [4, 5, 0, 0],
      FMS: [2, 0, 5, 0],
      "MINOR TCC (BASIC WEIGH BRIDGE)": [3, 0, 0, 5],
    },
  },
  DS_ENGINEERING_GEOLOGIST: {
    title: "DS Engineering Geologist",
    page: "T-23",
    columns: [
      "GEOHAZARD INVESTIGATION (SLOPE STABILITY)",
      "GEOHAZARD INVESTIGATION (SUBSIDENCE)",
      "GEOTECHNICAL INVESTIGATION (CL, QUARRY & BP MATERIALS RELATED)",
      "GEOTECHNICAL INVESTIGATION (TUNNELLING)",
      "GEOPHYSICAL INVESTIGATION (GROUND BASED & AIRBORNE)",
    ],
    rows: {
      NONE: [0, 0, 0, 0, 0],
      "GEOHAZARD INVESTIGATION (SLOPE STABILITY)": [5, 1, 2, 2, 2],
      "GEOHAZARD INVESTIGATION (SUBSIDENCE)": [2, 5, 3, 2, 3],
      "GEOTECHNICAL INVESTIGATION (CL, QUARRY & BP MATERIALS RELATED)": [3, 3, 5, 3, 4],
      "GEOTECHNICAL INVESTIGATION (TUNNELLING)": [4, 4, 4, 5, 4],
      "GEOPHYSICAL INVESTIGATION (GROUND BASED & AIRBORNE)": [2, 3, 4, 4, 5],
    },
  },
};

// Design Specialist positions are tendered per specialism ("Design
// Specialist 1 - Pavement and Materials"). Each maps to its Book 1 matrix and
// to a tender_roles code (migration 0016). Order matters only for matching.
export const DS_SPECIALISMS: { key: string; matrix: string; match: RegExp }[] = [
  { key: "pavement_materials", matrix: "DS_PAVEMENT_MATERIALS", match: /pavement|materials/i },
  { key: "structures", matrix: "DS_STRUCTURES", match: /structur|bridge/i },
  { key: "electronic_systems", matrix: "DS_ELECTRONIC_SYSTEMS", match: /electronic/i },
  { key: "electrical", matrix: "DS_ELECTRICAL", match: /electrical/i },
  { key: "geometrics", matrix: "DS_GEOMETRICS", match: /geometric/i },
  { key: "traffic_transportation", matrix: "DS_TRAFFIC_TRANSPORTATION", match: /traffic|transport/i },
  { key: "geotechnical", matrix: "DS_GEOTECHNICAL", match: /geotechnical/i },
  { key: "engineering_geologist", matrix: "DS_ENGINEERING_GEOLOGIST", match: /geolog/i },
];

/** "DS1" -> "DS", "CE2" -> "CE"; "PL(T)" and "PE(E)" stay. */
export function baseCode(positionCode: string): string {
  return positionCode.trim().toUpperCase().replace(/\d+$/, "");
}

/** Book 1 matrix for a tendered position, or null when Book 1 doesn't publish one. */
export function matrixForPosition(positionCode: string, description: string | null): string | null {
  const code = baseCode(positionCode);
  if (code === "PL" || code === "CE" || code === "RE") return "PL_CE_RE_CONVENTIONAL";
  if (code === "DS" && description) return DS_SPECIALISMS.find((s) => s.match.test(description))?.matrix ?? null;
  return null;
}

/**
 * tender_roles.code (0016) for a tendered SANRAL position: "PL" -> "sanral.PL",
 * "DS1" + "Design Specialist 1 - Pavement and Materials" ->
 * "sanral.DS.pavement_materials". A DS with no readable specialism -> null
 * (which DS role it is can't be told from the code alone).
 */
export function sanralRoleCodeForPosition(positionCode: string, description: string | null): string | null {
  const code = baseCode(positionCode);
  if (code === "DS") {
    const s = description ? DS_SPECIALISMS.find((x) => x.match.test(description)) : undefined;
    return s ? `sanral.DS.${s.key}` : null;
  }
  return `sanral.${code}`;
}

// Technical "Position Held" matrix (T-24): rows = position held on the past
// project, columns = position tendered for.
export const TECH_POSITION_COLUMNS = [
  "PL", "APL", "DS", "DA", "CE", "ACE", "RE", "ARE", "RM", "ARM", "SMT", "CM", "SA", "MT",
  "ETS", "DS(T)", "CE(T)", "CM(T)", "ETS(T)", "ES", "MS", "PE(E)", "UNDEFINED",
];
export const TECH_POSITION_ROWS: Record<string, number[]> = {
  PL: [5, 5, 2.5, 5, 5, 5, 5, 5, 5, 5, 2.5, 2.5, 2.5, 2.5, 0, 0, 2.5, 2.5, 0, 0, 0, 2.5, 0],
  APL: [2.5, 5, 2.5, 5, 3.75, 5, 5, 5, 5, 5, 2.5, 2.5, 2.5, 2.5, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  DS: [2.5, 2.5, 5, 5, 3.75, 5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 0, 2.5, 0, 0, 0, 0, 0, 2.5, 0],
  DA: [0, 0, 2.5, 5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  CE: [5, 5, 2.5, 5, 5, 5, 5, 5, 5, 5, 2.5, 2.5, 2.5, 2.5, 0, 0, 2.5, 2.5, 0, 0, 0, 2.5, 0],
  ACE: [2.5, 5, 2.5, 5, 3.75, 5, 5, 5, 5, 5, 2.5, 2.5, 2.5, 2.5, 0, 0, 0, 0, 0, 0, 0, 2.5, 0],
  RE: [2.5, 2.5, 2.5, 2.5, 4.5, 2.5, 5, 5, 5, 5, 2.5, 2.5, 2.5, 2.5, 0, 0, 0, 2.5, 0, 0, 0, 2.5, 0],
  ARE: [2.5, 2.5, 0, 2.5, 2.5, 0, 2.5, 5, 5, 5, 2.5, 0, 0, 2.5, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  RM: [2.5, 2.5, 0, 2.5, 3.75, 0, 2.5, 5, 5, 5, 2.5, 0, 0, 2.5, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ARM: [0, 0, 0, 0, 2.5, 0, 0, 2.5, 2.5, 5, 2.5, 0, 0, 2.5, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  SMT: [0, 0, 2.5, 2.5, 1.25, 0, 2.5, 2.5, 2.5, 2.5, 5, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  CM: [2.5, 5, 2.5, 5, 5, 2.5, 5, 5, 5, 5, 2.5, 5, 5, 2.5, 0, 0, 2.5, 2.5, 0, 0, 0, 2.5, 0],
  SA: [2.5, 2.5, 2.5, 2.5, 3.75, 2.5, 5, 5, 5, 5, 2.5, 2.5, 5, 2.5, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  MT: [0, 0, 2.5, 2.5, 0, 0, 2.5, 2.5, 2.5, 2.5, 5, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ETS: [0, 0, 2.5, 2.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 2.5, 0],
  "DS(T)": [0, 0, 2.5, 2.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 2.5, 2.5, 0, 2.5, 2.5, 0, 0],
  "CE(T)": [2.5, 2.5, 2.5, 2.5, 5, 5, 2.5, 5, 2.5, 5, 0, 5, 2.5, 0, 2.5, 2.5, 5, 5, 2.5, 2.5, 2.5, 2.5, 0],
  "CM(T)": [2.5, 2.5, 2.5, 2.5, 5, 5, 2.5, 5, 2.5, 5, 0, 5, 2.5, 0, 2.5, 2.5, 2.5, 5, 2.5, 2.5, 2.5, 2.5, 0],
  "ETS(T)": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 2.5, 2.5, 0, 0],
  ES: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2.5, 5, 2.5, 0, 0],
  MS: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2.5, 0, 0, 0, 2.5, 2.5, 5, 0, 0],
  "PE(E)": [2.5, 5, 2.5, 5, 5, 2.5, 2.5, 5, 5, 5, 0, 2.5, 2.5, 0, 0, 2.5, 2.5, 2.5, 0, 0, 0, 5, 0],
};

// Managerial "Position Held" matrix (T-26) - only for managerial positions.
export const MAN_POSITION_COLUMNS = ["PL", "CE", "RE", "RM", "PL(T)", "CE(T)", "CM(T)"];
export const MAN_POSITION_ROWS: Record<string, number[]> = {
  PL: [5, 5, 5, 5, 2.5, 2.5, 2.5],
  APL: [2.5, 3.75, 5, 5, 0, 0, 0],
  DS: [2.5, 2.5, 2.5, 2.5, 0, 0, 0],
  DA: [0, 0, 0, 0, 0, 0, 0],
  CE: [5, 5, 5, 5, 0, 2.5, 0],
  ACE: [2.5, 3.75, 5, 5, 0, 0, 0],
  RE: [2.5, 5, 5, 5, 0, 0, 0],
  ARE: [2.5, 2.5, 2.5, 2.5, 0, 0, 0],
  RM: [2.5, 5, 2.5, 5, 0, 0, 0],
  ARM: [0, 2.5, 0, 2.5, 0, 0, 0],
  SMT: [0, 0, 2.5, 2.5, 0, 0, 0],
  CM: [5, 5, 5, 5, 0, 0, 2.5],
  SA: [2.5, 5, 5, 5, 0, 0, 0],
  MT: [0, 0, 2.5, 2.5, 0, 0, 0],
  ETS: [0, 0, 0, 0, 0, 0, 0],
  "DS(T)": [0, 0, 0, 0, 2.5, 2.5, 2.5],
  "CE(T)": [2.5, 5, 2.5, 2.5, 5, 5, 5],
  "CM(T)": [0, 5, 2.5, 2.5, 2.5, 2.5, 5],
  "ETS(T)": [0, 0, 0, 0, 2.5, 2.5, 2.5],
  ES: [0, 0, 0, 0, 0, 0, 2.5],
  MS: [0, 0, 0, 0, 0, 0, 2.5],
  "PE(E)": [2.5, 5, 2.5, 2.5, 2.5, 2.5, 2.5],
};

// Management knowledge "Client" points (T-26). Same codes projects.client_type holds.
export const CLIENT_POINTS: Record<string, number> = {
  "National Roads Authority": 5,
  Concessionaire: 5,
  "Provincial Authority": 5,
  "Relevant SOE": 4.5,
  "Metro Council": 4.5,
  Municipality: 4,
  Private: 3.75,
  Other: 3.75,
};

/** Normalise a project-type code for a matrix lookup ("Ds" -> "DS", collapse spaces). */
export function normType(t: string | null | undefined): string {
  return (t ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}
