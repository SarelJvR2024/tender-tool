// Key-position suggestions on the Tender Workspace (Sarel, 2026-10-17:
// suggest the best person + up to 2 alternatives, let the user confirm or
// change).
//
// No scoring happens here. The score is engine/pack_generator/suggest_pack.py
// score_candidate() - the existing scorer, also used by generate_cv.py - run
// by engine/pack/process_pack_jobs.py sync_position_suggestions() for every
// person in the company and stored, highest first, on
// tender_pack_assignments.candidate_scores (migration 0031). This module only
// narrows that ranking to the people the company tagged as eligible for the
// position's role (person_role_eligibility, 0016, via roleCodeForPosition() -
// the same rule the compliance report's role-fit check uses) and words the
// evidence for the card. Nobody is removed from the dropdown: it is ordered.

import { roleCodeForPosition, type RoleTag } from "./tenderRoles";

export type CandidateScore = {
  person_id: string;
  name: string;
  score: number;
  years_experience: number | null;
  ecsa_level: string | null;
  matched: string[] | null;
  missing: string[] | null;
  specialism_warning: boolean;
  rationale: string;
};

export type Suggestion = {
  id: string;
  name: string;
  score: number;
  why: string;
  specialismWarning: boolean;
};

export type PositionSuggestions = {
  scored: boolean; // false until the pack builder has scored this position
  basis: "tagged" | "everyone"; // ranked among role-tagged people, or (none tagged) everyone
  suggestion: Suggestion | null;
  alternatives: Suggestion[]; // up to 2
  // The suggestion's match score equals the first alternative's: the order
  // between them comes from the tie-break (years' experience), not the match.
  tied: boolean;
};

/** "Professional Engineer" -> "Pr Eng" etc.; anything else is shown as stored. */
function shortEcsa(level: string): string {
  const l = level.trim();
  if (/professional\s+engineering\s+technologist/i.test(l)) return "Pr Tech Eng";
  if (/professional\s+engineering\s+technician/i.test(l)) return "Pr Techni Eng";
  if (/professional\s+engineer\b/i.test(l)) return "Pr Eng";
  if (/candidate/i.test(l)) return l.replace(/\s+/g, " ");
  return l;
}

/** One short line of evidence, e.g. "ECSA Pr Eng, 12 years, matches pavement, materials". */
export function whySuggested(c: CandidateScore): string {
  const parts: string[] = [];
  if (c.ecsa_level) parts.push(`ECSA ${shortEcsa(c.ecsa_level)}`);
  if (c.years_experience !== null && c.years_experience !== undefined) parts.push(`${c.years_experience} years`);
  if (c.matched && c.matched.length > 0) parts.push(`matches ${c.matched.slice(0, 4).join(", ")}`);
  if (c.specialism_warning && c.missing && c.missing.length > 0) parts.push(`no evidence of ${c.missing.slice(0, 3).join(", ")}`);
  return parts.length > 0 ? parts.join(", ") : "no matching or conflicting evidence on file";
}

const toSuggestion = (c: CandidateScore): Suggestion => ({
  id: c.person_id,
  name: c.name,
  score: c.score,
  why: whySuggested(c),
  specialismWarning: !!c.specialism_warning,
});

/**
 * The suggestion and up to 2 alternatives for one position: the stored
 * ranking (already highest first), kept to people still on file, narrowed to
 * the people tagged for the position's role - or, when nobody is tagged (or
 * the role can't be told, e.g. a DS with no specialism in its description),
 * ranked across everyone, and says so.
 */
export function suggestForPosition(input: {
  positionCode: string;
  description: string | null;
  candidateScores: CandidateScore[] | null;
  tags: RoleTag[];
  peopleIds: Set<string>;
}): PositionSuggestions {
  if (!input.candidateScores) return { scored: false, basis: "tagged", suggestion: null, alternatives: [], tied: false };
  const roleCode = roleCodeForPosition(input.positionCode, input.description);
  const tagged = new Set(roleCode ? input.tags.filter((t) => t.role_code === roleCode).map((t) => t.person_id) : []);
  const onFile = input.candidateScores.filter((c) => input.peopleIds.has(c.person_id));
  const eligible = onFile.filter((c) => tagged.has(c.person_id));
  const basis = eligible.length > 0 ? "tagged" : "everyone";
  const ranked = (basis === "tagged" ? eligible : onFile).map(toSuggestion);
  const tied = ranked.length > 1 && ranked[0].score === ranked[1].score;
  return { scored: true, basis, suggestion: ranked[0] ?? null, alternatives: ranked.slice(1, 3), tied };
}
