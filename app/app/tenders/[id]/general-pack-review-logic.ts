/**
 * Pure, DB-free helpers for the general-tender Pack Review snapshot
 * (general-pack-review-data.ts) - the non-SANRAL equivalent of
 * pack-review-logic.ts, built for the same QA finding: general tenders
 * (engine/general/, general-workspace.tsx, requestGeneralPack) had no
 * confirm-before-compile review step, unlike SANRAL's Pack Review (0059).
 *
 * Reuses pack-review-logic.ts's own vocabulary and generic classifiers
 * (ReviewStatus, ChecklistStatus, fieldStatus, docItemStatus,
 * humanizeFieldKey) rather than duplicating them - none of those are
 * SANRAL-specific, they're just "value on file?" / "ComplianceStatus ->
 * review vocabulary" mappers. The SANRAL file itself is never modified.
 * What's genuinely different about a general tender gets its own pure
 * functions here:
 *   - answerStatus: a tender_answers/company-field question answered or not
 *     (general tenders have no provenance/assumed-default machinery -
 *     field_provenance is SANRAL-only - so this is simpler than
 *     provenanceStatus: answered, optional-and-blank, or missing).
 *   - roleStatus: a tender_roles role tagged via person_role_eligibility
 *     (0016/0031) and whether the tagged person(s) have a CV on file
 *     (generated_cvs/cv_uploads) - general's own equivalent of SANRAL's
 *     per-position tender_pack_assignments + positionStatus, but tag-based
 *     (any number of people per role) rather than one-person-per-position.
 *   - signatureAnswerStatus: who signs, from the tender's own "person" type
 *     question (same field_key convention, "signatory_person_id"). No
 *     region/industry/discipline SCOPE-MATCHED default-signer suggestion
 *     exists for general tenders (that's SANRAL's signatory_scopes, 0061) -
 *     but engine/general/process_general_jobs.py's own gather_pack_inputs()
 *     DOES fall back to the company's own designated signatory (first person
 *     on file with a signatory_capacity, oldest first) whenever no
 *     signatory_person_id answer exists for this specific tender - the same
 *     convention engine/pack/process_pack_jobs.py already uses for SANRAL's
 *     Form of Offer/A-Forms signatory, "so a company with a Director/
 *     signatory on file for one engine isn't blank for the other" (that
 *     function's own comment, added after a real incident, 2026-10-28: a
 *     company with a Director on file still showed "Not on file" for a
 *     tender nobody had picked a signatory for). This screen used to not
 *     know about that fallback at all and reported "missing" unconditionally
 *     whenever nobody had explicitly chosen a signatory for THIS tender -
 *     wrongly telling a reviewer to "choose who signs this bid ... before
 *     generating the pack" even when the pack would, in fact, generate just
 *     fine with the company's own designated signatory filled in
 *     automatically. `fallback` (mirroring pack-review-logic.ts's own
 *     signatureStatus()) is whoever that would be; this function doesn't
 *     care which kind of fallback it was given, only that a choice exists.
 *   - localityStatus: lib/locality.ts's matchLocality() result -> this
 *     screen's vocabulary, respecting whether a local office is mandatory
 *     and disqualifying.
 */

// Type-only import (erased entirely at compile/strip time, no runtime module
// resolution) - the runtime helpers themselves (docItemStatus, fieldStatus,
// humanizeFieldKey) are imported directly from "./pack-review-logic" by
// callers (general-pack-review-data.ts, this file's own test) rather than
// re-exported here, so this file never needs a runtime import of its own
// from a sibling module - kept deliberately import-free at runtime, the
// same "no react/next/@ aliases" spirit pack-review-logic.ts documents
// about itself.
import type { ChecklistStatus, ReviewStatus } from "./pack-review-logic";
// Type-only import (erased entirely at compile/strip time, same reasoning as
// the "./pack-review-logic" import above) - LocalityRow's own `kind` field
// is what specificGoalsLocalityRows() below filters on.
import type { LocalityRow } from "@/lib/locality";

export type { ReviewStatus, ChecklistStatus } from "./pack-review-logic";

/** A tender question or company field: answered, optional-and-blank, or missing. */
export function answerStatus(answered: boolean, optional: boolean): { status: ReviewStatus; note: string | null } {
  if (answered) return { status: "confirmed", note: null };
  if (optional) return { status: "needs_input", note: "Left blank - left blank on the form too, never guessed." };
  return { status: "missing", note: "This tender's forms ask for this - answer it before generating the pack." };
}

/**
 * One role this tender names: how many people are tagged for it
 * (person_role_eligibility) and whether a CV exists for each (the same
 * generated_cvs/cv_uploads lookup process_general_jobs.py's gather_pack_inputs
 * does when it actually builds the pack - kept in sync so this screen never
 * promises a CV the pack itself can't find).
 */
export function roleStatus(input: {
  taggedCount: number;
  taggedWithCvCount: number;
}): { reviewStatus: ReviewStatus; checklistStatus: ChecklistStatus; note: string | null } {
  if (input.taggedCount === 0) {
    return { reviewStatus: "missing", checklistStatus: "not_included", note: "Nobody tagged for this role yet - tag CVs on the People page." };
  }
  if (input.taggedWithCvCount === 0) {
    return { reviewStatus: "confirmed", checklistStatus: "included_warning", note: "Tagged, but no CV uploaded or generated yet for anyone in this role." };
  }
  if (input.taggedWithCvCount < input.taggedCount) {
    return { reviewStatus: "confirmed", checklistStatus: "included_warning", note: `${input.taggedCount - input.taggedWithCvCount} of ${input.taggedCount} tagged for this role has no CV on file yet.` };
  }
  return { reviewStatus: "confirmed", checklistStatus: "included", note: null };
}

/**
 * Who signs this bid, from the tender's own "person" type question
 * (manifest.questions, usually field_key "signatory_person_id" - same
 * convention as SANRAL, different table scope). General tenders have no
 * default-signer suggestion (no signatory_scopes equivalent), so unlike
 * SANRAL's signatureStatus there is no fallback to pre-select - a chosen
 * person either has a signatory capacity on file or doesn't.
 */
export function signatureAnswerStatus(input: {
  chosenId: string | null;
  chosenPerson: { name: string; signatory_capacity: string | null } | null;
  optional: boolean;
  /**
   * Whoever gather_pack_inputs() would actually fall back to for THIS
   * company if nobody has explicitly chosen a signatory for this tender -
   * the company's own first person on file with a signatory_capacity,
   * oldest first (null when nobody on file has one). Optional/defaults to
   * null so existing callers/tests that don't thread it through keep their
   * old "no fallback at all" behaviour unchanged.
   */
  fallback?: { name: string; signatory_capacity: string } | null;
}): { reviewStatus: ReviewStatus; checklistStatus: ChecklistStatus; value: string | null; note: string | null } {
  if (!input.chosenId) {
    // The engine's own fallback applies unconditionally whenever nobody has
    // picked a signatory for this specific tender - regardless of whether
    // this question happens to be optional on this tender's manifest (the
    // Python side never looks at that flag at all, see gather_pack_inputs()).
    // So a real fallback existing takes priority over the plain optional/
    // required branches below: the pack will not, in fact, come out blank.
    if (input.fallback) {
      return {
        reviewStatus: "needs_input",
        checklistStatus: "included_warning",
        value: `${input.fallback.name} - ${input.fallback.signatory_capacity}`,
        note: `Not chosen for this tender - will default to ${input.fallback.name} (your company's designated signatory).`,
      };
    }
    return input.optional
      ? { reviewStatus: "needs_input", checklistStatus: "included_warning", value: null, note: "Not chosen yet - left blank until you choose who signs." }
      : { reviewStatus: "missing", checklistStatus: "not_included", value: null, note: "Choose who signs this bid on the People/questions card before generating the pack." };
  }
  if (!input.chosenPerson) {
    return { reviewStatus: "missing", checklistStatus: "not_included", value: null, note: "The chosen signatory can no longer be found - choose again." };
  }
  if (!input.chosenPerson.signatory_capacity) {
    return { reviewStatus: "warning", checklistStatus: "included_warning", value: input.chosenPerson.name, note: "This person has no signatory capacity on file - add it on their People page so the forms can show it." };
  }
  return { reviewStatus: "confirmed", checklistStatus: "included", value: `${input.chosenPerson.name} - ${input.chosenPerson.signatory_capacity}`, note: null };
}

/**
 * The exact fallback signatory gather_pack_inputs() (engine/general/
 * process_general_jobs.py) would pick for this company if nobody has chosen
 * one for this specific tender: the first person on file with a
 * signatory_capacity, oldest `created_at` first. One shared implementation
 * so general-pack-review-data.ts and submission-plan-data.ts can't drift
 * apart on it the way signatureAnswerStatus() itself just had to be fixed
 * for - see that function's own doc comment for the real incident this
 * mirrors. `people` need not be pre-sorted; this does its own sort.
 */
export function designatedSignatoryFallback<
  T extends { name: string; signatory_capacity: string | null; created_at: string | null },
>(people: T[]): { name: string; signatory_capacity: string } | null {
  // created_at is `not null default now()` in the real schema (0001), but
  // this still sorts defensively rather than crashing on a malformed/mocked
  // row with no created_at - treated as "unknown, sort last" rather than
  // `localeCompare` on `undefined` throwing and taking the whole screen down
  // with it, same "never let one bad row break the page" discipline this
  // file's other classifiers already follow.
  const candidates = people
    .filter((p): p is T & { signatory_capacity: string } => !!p.signatory_capacity)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
  return candidates[0] ? { name: candidates[0].name, signatory_capacity: candidates[0].signatory_capacity } : null;
}

/**
 * How strong the underlying extraction match was for one manifest item
 * (engine/general/requirements.py's 0-100 "confidence" - regex/heuristic
 * pattern-matching against the tender's own documents, NOT an LLM call; see
 * that module's own comment). Maps the raw number to this screen's plain,
 * honest vocabulary: "double-check this one yourself" at the low end, not
 * "something is broken". Deliberately called "match strength" everywhere in
 * the UI, never "AI confidence" - there is no AI in this path.
 *
 * Three tiers, thresholds our call (kept simple): a clean, exact-looking
 * match; a vaguer one worth a second look; and a weak one (often a poor OCR
 * scan or a stray mention) that should be verified against the actual
 * document before relying on it.
 */
export function matchStrengthStatus(confidence: number | null | undefined): { tier: "strong" | "check" | "low"; label: string } | null {
  if (confidence === null || confidence === undefined) return null;
  if (confidence >= 75) return { tier: "strong", label: "Strong match" };
  if (confidence >= 40) return { tier: "check", label: "Check this" };
  return { tier: "low", label: "Low confidence - please verify" };
}

/**
 * Which of a tender's own locality rows the "Office location points" item
 * (general-pack-review-data.ts) should ever hand to lib/locality.ts's
 * matchLocality() - specific_goals rows only.
 *
 * Finding 343, 2026-11-10: a tender can state a locality rule TWICE for the
 * SAME area under two genuinely different mechanics - a real, documented
 * example (uMlalazi LM, docs/specs/Tender-Evaluation-Engine-Audit.md "Round
 * 2", (c)) gives "Enterprise Located within uMlalazi Municipality" as a
 * 4-point specific-goals preference row AND "Bidder operating within
 * uMlalazi Municipality (Points = 10)" as a separate 10-point functionality-
 * scorecard criterion - two different evaluation axes with no points in
 * common. matchLocality() (and its Python mirror, score_outlook.py's own
 * match_locality()) picks the single highest-scoring row ANY office
 * satisfies, with no idea these are two different `kind`s - so, fed every
 * row regardless of kind (what general-pack-review-data.ts used to do), it
 * could silently return the FUNCTIONALITY criterion's points as this item's
 * own "Office location points" value, purely because that number happens to
 * be larger. engine/discovery/score_outlook.py's own two OTHER call sites
 * (the specific-goals estimate, and the separate functionality-criterion
 * summary line) already filter to the one `kind` each cares about before
 * calling match_locality() - this is that same filter, kept here so it has
 * its own test coverage (general-pack-review-data.ts has none - it only
 * reads Supabase).
 */
export function specificGoalsLocalityRows(rows: LocalityRow[]): LocalityRow[] {
  return rows.filter((r) => r.kind !== "functionality");
}

/** lib/locality.ts's matchLocality() "matched"/"no_match"/"unknown" -> this screen's vocabulary. */
export function localityStatus(input: {
  matchStatus: "matched" | "no_match" | "unknown";
  mandatory: boolean;
  disqualifies: boolean;
}): { reviewStatus: ReviewStatus; checklistStatus: ChecklistStatus } {
  if (input.matchStatus === "matched") return { reviewStatus: "confirmed", checklistStatus: "included" };
  if (input.matchStatus === "unknown") return { reviewStatus: "needs_input", checklistStatus: "included_warning" };
  // no_match
  if (input.mandatory && input.disqualifies) return { reviewStatus: "missing", checklistStatus: "not_included" };
  return { reviewStatus: "warning", checklistStatus: "included_warning" };
}
