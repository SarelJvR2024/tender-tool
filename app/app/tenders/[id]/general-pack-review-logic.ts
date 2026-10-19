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
 *     question (same field_key convention, "signatory_person_id") - no
 *     region/industry/discipline default-signer matching exists for general
 *     tenders (that's SANRAL's signatory_scopes, 0061), so there is no
 *     fallback to suggest: either someone eligible is chosen, or they are not.
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
}): { reviewStatus: ReviewStatus; checklistStatus: ChecklistStatus; value: string | null; note: string | null } {
  if (!input.chosenId) {
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
