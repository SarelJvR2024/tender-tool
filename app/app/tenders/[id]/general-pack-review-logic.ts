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
 *     (answered, optional-and-blank, or missing) - the base classification
 *     used before any real pack has ever been generated for this tender, or
 *     for any field this screen asks about that isn't also one of the
 *     per-document declaration fields below.
 *   - questionAnswerStatus: answerStatus() reconciled with field_provenance
 *     (Finding 285 - field_provenance is NOT SANRAL-only, as this file's own
 *     comment used to claim: engine/general/process_general_jobs.py writes
 *     it for general packs too, step 5 of its own module docstring, and
 *     engine/general/fill_sbd_docx.py logs it under the EXACT SAME field_key
 *     the SBD-declaration questions in engine/general/requirements.py's own
 *     manifest use - e.g. "sbd4.employed_by_state" is both a
 *     tender_answers.field_key this screen reads via answerStatus() AND a
 *     field_provenance.field_key fill_sbd_docx.py writes when it actually
 *     tries to place that exact declaration into THIS buyer's specific SBD4
 *     edition. An answered "No" that the real edition's wording doesn't
 *     match (Finding 284's own root cause, same file) logs
 *     field_provenance.status = "missing" even though tender_answers has a
 *     value - a real company answer this screen would otherwise show as
 *     fully confirmed, when the actual generated .docx a company signs does
 *     NOT carry it. Only applies once a pack has been generated at least
 *     once (field_provenance rows don't exist before that); harmless no-op
 *     otherwise, or for company_fields/other questions with no form-level
 *     provenance counterpart - this screen's "company.*" field_key
 *     convention (requirements.py's COMPANY_FIELDS) is its own separate
 *     namespace from fill_sbd_docx.py's "sbd1.*" logging keys for the same
 *     data (e.g. company.cellphone vs. sbd1.cellphone_number) and is
 *     deliberately NOT given this treatment - that join is not clean, unlike
 *     the SBD-question field_keys, and forcing one would risk a false match.
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

// ReviewStatus/ChecklistStatus stay type-only (erased entirely at
// compile/strip time, no runtime module resolution) - most of the runtime
// helpers from pack-review-logic.ts (docItemStatus, fieldStatus,
// humanizeFieldKey) are still imported directly from "./pack-review-logic"
// by callers (general-pack-review-data.ts, this file's own test) rather than
// re-exported here. Finding 285 is the one genuine exception: provenanceStatus
// is a real runtime import now (questionAnswerStatus below needs its own
// field_provenance.status -> ReviewStatus mapping kept in exactly one place,
// not a second, possibly-disagreeing copy) - given the explicit ".ts"
// extension raw `node --experimental-strip-types` resolution needs for a
// real (non-type-only) relative import, the same convention
// tender-readiness.ts already uses for the same reason.
import { provenanceStatus, type ChecklistStatus, type ReviewStatus } from "./pack-review-logic.ts";

export type { ReviewStatus, ChecklistStatus } from "./pack-review-logic";

/** A tender question or company field: answered, optional-and-blank, or missing. */
export function answerStatus(answered: boolean, optional: boolean): { status: ReviewStatus; note: string | null } {
  if (answered) return { status: "confirmed", note: null };
  if (optional) return { status: "needs_input", note: "Left blank - left blank on the form too, never guessed." };
  return { status: "missing", note: "This tender's forms ask for this - answer it before generating the pack." };
}

/**
 * answerStatus(), reconciled with a matching field_provenance row for this
 * exact field_key, when one exists (see this file's header for why this is
 * safe/clean for SBD-question field_keys specifically). `provenanceRow` is
 * `null` whenever no pack has ever been generated yet, or this field_key has
 * no form-level provenance counterpart - answerStatus()'s own base result is
 * returned unchanged in that case, so every existing caller/behaviour is
 * preserved when there's nothing new to say.
 *
 * provenanceStatus()'s own mapping decides the outcome:
 *   - "missing": the real generated document does NOT carry this answer,
 *     regardless of what tender_answers says - always wins, shown as Fix,
 *     with field_provenance's own plain-language reason (more specific than
 *     answerStatus()'s generic note - "Declaration not found in this
 *     edition" tells the user something answerStatus() alone cannot).
 *   - "assumed_default" (field_provenance's own "assumed_default" or
 *     "computed"): a value the pipeline filled in on the company's behalf,
 *     not a value the company itself confirmed in the Tender Workspace -
 *     never silently upgraded to "confirmed" just because tender_answers
 *     happens to also hold a value answerStatus() alone was happy with.
 *   - "confirmed": agrees with an already-answered base status; a
 *     field_provenance "confirmed" row for an UNANSWERED base (answered is
 *     only ever true when tender_answers has a value, so this shouldn't
 *     happen from this pipeline today) still can't make this worse, so the
 *     base status is kept either way, not downgraded by a provenance read
 *     this screen can't fully explain.
 */
export function questionAnswerStatus(
  answered: boolean,
  optional: boolean,
  provenanceRow: { status: string; reason: string | null } | null,
): { status: ReviewStatus; note: string | null } {
  const base = answerStatus(answered, optional);
  if (!provenanceRow) return base;
  const mapped = provenanceStatus(provenanceRow.status);
  if (mapped === "missing") {
    return { status: "missing", note: provenanceRow.reason ?? "This buyer's edition didn't carry this declaration as expected - answer it by hand." };
  }
  if (mapped === "assumed_default") {
    return { status: "assumed_default", note: provenanceRow.reason ?? base.note };
  }
  return base;
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
