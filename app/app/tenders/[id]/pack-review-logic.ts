/**
 * Pure, DB-free helpers for the Pack Review snapshot (pack-review-data.ts).
 * Deliberately no imports from "react", "next", or any "@/..." alias - kept
 * importable and testable on their own (see pack-review-logic.test.ts),
 * the same way engine/*.py test files run the real fill logic with no
 * network/database. pack-review-data.ts is the thin, Supabase-reading shell
 * around these; everything that's a pure classification decision lives here
 * so it can be covered without a live database.
 */

// Type-only import, fully erased by `node --experimental-strip-types` (no
// runtime module resolution at all - confirmed empirically, same reason
// general-pack-review-logic.ts's own `import type { ReviewStatus }` from
// this file works) - reuses bid-task-status.ts's own type rather than
// re-declaring an identical one, without creating a real runtime dependency
// on that file (which itself imports the "@/" alias, unresolvable here -
// see "Verify/Provide/Fix grouping" in app/AGENTS.md).
import type { BidTaskStatus } from "./bid-task-status";

export type ReviewStatus = "confirmed" | "needs_input" | "assumed_default" | "warning" | "missing";
export type ChecklistStatus = "included" | "included_warning" | "not_included";

/**
 * Collapses this screen's 5-way ReviewStatus down to the Product promise's
 * own 3-way Verify/Provide/Fix grouping (app/AGENTS.md), for Pill rendering
 * only - the 5-way vocabulary itself, and every function above/below that
 * returns it, is unchanged (their own tests still key off it directly).
 *
 * - "missing" -> Fix everywhere it's produced: no confirmed key person, no
 *   signatory, an unanswered mandatory Form B7, a mandatory-and-disqualifying
 *   locality miss - never an optional gap.
 * - "warning" -> Provide: always a softer, non-disqualifying concern (a
 *   role-fit mismatch, a B7 plan note, no signatory capacity on file, a
 *   non-disqualifying locality miss) - never what actually blocks compiling.
 * - "confirmed" and "assumed_default" -> Verify (an AI-filled or defaulted
 *   value, confirmed or not).
 * - "needs_input" -> Provide for every producer except signatureStatus's own
 *   "nobody chosen, but a suggested default exists" case, which is really
 *   Verify-unconfirmed (a default WAS picked) under the wrong label - a
 *   known mislabeling in that one function, not fixed here to keep this
 *   pass presentation-only; see app/AGENTS.md.
 */
export function reviewStatusToBidTask(status: ReviewStatus): BidTaskStatus {
  if (status === "missing") return "fix";
  if (status === "confirmed" || status === "assumed_default") return "verify";
  return "provide"; // needs_input, warning
}

/** A simple "is this company field on file" classification, used for the company-data section. */
export function fieldStatus(value: unknown, required = true): { status: ReviewStatus; note: string | null } {
  const empty = value === null || value === undefined || value === "";
  if (!empty) return { status: "confirmed", note: null };
  return { status: required ? "missing" : "needs_input", note: "Not on file - set it on the Company page." };
}

// field_provenance.status -> this screen's own ReviewStatus vocabulary.
// QA finding, 2026-10-26: "computed" used to map to "confirmed" here - but
// 0002_field_provenance.sql's own table comment defines them as opposites:
// "confirmed" is "a human entered/approved it", "computed" is "derived
// mechanically ... no judgment call" - nobody ever looked at it. Folding
// both into one ReviewStatus silently fed tender-readiness.ts's
// confirmedCount/score from mechanically-derived values alone, even though
// that file's own doc comment says confirmedCount should count only "the
// underlying ReviewStatus ... literally 'confirmed'". Mapped to
// "assumed_default" instead - the Fix/Provide/Verify bucket a mechanically-
// derived, not-yet-human-checked value already belongs in
// (reviewStatusToBidTask's own doc comment above groups them for exactly
// this reason), without inventing a 6th ReviewStatus value for one mapping.
const PROVENANCE_STATUS_MAP: Record<string, ReviewStatus> = {
  confirmed: "confirmed",
  computed: "assumed_default",
  assumed_default: "assumed_default",
  missing: "missing",
};
export function provenanceStatus(status: string): ReviewStatus {
  return PROVENANCE_STATUS_MAP[status] ?? "needs_input";
}

/** compliance-data.ts's ComplianceStatus ("have"/"missing"/"check") -> this screen's vocabulary and the pre-generation checklist's vocabulary. */
export function docItemStatus(status: "have" | "missing" | "check"): { reviewStatus: ReviewStatus; checklistStatus: ChecklistStatus } {
  if (status === "have") return { reviewStatus: "confirmed", checklistStatus: "included" };
  if (status === "check") return { reviewStatus: "needs_input", checklistStatus: "included_warning" };
  return { reviewStatus: "missing", checklistStatus: "not_included" };
}

/** One key position's status, given whether it has a confirmed person, a CV, and a role-fit warning. */
export function positionStatus(input: {
  hasConfirmedPerson: boolean;
  hasCv: boolean;
  fitWarning: string | null;
}): { reviewStatus: ReviewStatus; checklistStatus: ChecklistStatus; note: string | null } {
  if (!input.hasConfirmedPerson) {
    return { reviewStatus: "missing", checklistStatus: "not_included", note: "No confirmed key person for this position." };
  }
  if (input.fitWarning) {
    return { reviewStatus: "warning", checklistStatus: "included_warning", note: input.fitWarning };
  }
  if (!input.hasCv) {
    return { reviewStatus: "confirmed", checklistStatus: "included_warning", note: "No CV on file yet - the position is confirmed but its CV page will be thin." };
  }
  return { reviewStatus: "confirmed", checklistStatus: "included", note: null };
}

/** Form B7 subcontracting plan status (lib/sanralB7.ts's own B7Applicability.status + loadB7State's blocker/warnings). */
export function b7Status(input: {
  appliesStatus: "waived" | "not_required" | "required" | "unknown";
  blocker: string | null;
  warnings: string[];
  planMode: string | null;
}): { applies: boolean; reviewStatus: ReviewStatus; checklistStatus: ChecklistStatus; value: string | null; note: string | null } {
  const applies = input.appliesStatus === "required" || input.appliesStatus === "unknown";
  if (!applies) {
    return { applies, reviewStatus: "confirmed", checklistStatus: "not_included", value: "Does not apply", note: "Form B7 does not apply to this tender." };
  }
  if (input.blocker) {
    return { applies, reviewStatus: "missing", checklistStatus: "not_included", value: "Not answered", note: input.blocker };
  }
  if (input.warnings.length > 0) {
    return { applies, reviewStatus: "warning", checklistStatus: "included_warning", value: input.planMode ?? "Answered", note: input.warnings.join("; ") };
  }
  return { applies, reviewStatus: "confirmed", checklistStatus: "included", value: input.planMode ?? "Answered", note: null };
}

/**
 * Signature status: who signs, given the chosen person (if any) and the
 * default fallback signer. `fallback` must always be whoever
 * engine/pack/process_pack_jobs.py will ACTUALLY sign with if nobody has
 * chosen for this tender - that function's own code (not just its comment)
 * is `signatory = signatories[0]`, the company's first person given a
 * signatory capacity, oldest `created_at` first; it never reads
 * `signatory_scopes` at all (confirmed: zero hits for that table name
 * anywhere under `engine/`). So `fallback` here must be that same
 * oldest-first person, never the migration-0061 region/industry/discipline
 * scope match (signatory-logic.ts's `pickDefaultSignatory()`) - that match
 * is a real, deliberate feature (its own commit: "advisory only ... pack
 * generation need no read-path changes"), but only as a SUGGESTION for the
 * company to actively choose on the submission form, not a second,
 * competing idea of what "the default" already is.
 *
 * Finding (standing solution-architect review pass, 2026-11-12): both real
 * callers (pack-review-data.ts, submission-pack.tsx) used to pass the
 * SCOPE MATCH itself as `fallback` - so whenever a company had more than
 * one signatory and a signatory_scopes row made a non-first one score
 * higher, this card's "Who signs this bid" line (and submission-pack.tsx's
 * own "(suggested for this tender; the pack will say so)" dropdown copy)
 * named a DIFFERENT person than who the real submitted Form of
 * Offer/A-Forms/authority letter will actually be signed by if the
 * reviewer takes no action - a false promise about who signs a document
 * the company submits, not a mere wording nuance. `suggestion`, new and
 * optional, carries the scope match separately now - only surfaced as an
 * extra note when it names someone other than the true `fallback`, never
 * substituted for it.
 *
 * QA pass, 2026-11-08: when `chosenId` IS set, this used to show the
 * FALLBACK's own name/capacity as `value` - never the actually-chosen
 * person's, because this function was never given the chosen person's
 * details at all, only their bare id. `pickDefaultSignatory()` has no idea
 * what was chosen either (by design - it only picks the scope-matched
 * suggestion for when nobody has), so `fallback` and the real choice
 * routinely differ: any company with more than one signatory where someone
 * explicitly picked a DIFFERENT person than the algorithm's own suggestion
 * had this card show the wrong name on the Pack Review screen, confirmed by
 * reading the one real caller (pack-review-data.ts) side by side with this
 * function - the existing test for "an explicit choice is confirmed" never
 * caught it because its own fixture reused the same name for both the
 * chosen id and the fallback, so a wrong-person bug and a right-person
 * result were indistinguishable in that test. Same fix shape as
 * general-pack-review-logic.ts's own signatureAnswerStatus(), which already
 * threads the real chosenPerson through (people.find()) and already has its
 * own "can no longer be found" branch - sanral's own version never had it.
 */
export function signatureStatus(input: {
  chosenId: string | null;
  chosenPerson: { name: string; signatory_capacity: string } | null;
  fallback: { name: string; signatory_capacity: string } | null;
  /**
   * The best region/industry/discipline scope match for this tender
   * (signatory-logic.ts's `pickDefaultSignatory()`) - advisory only, never
   * what the real pack build falls back to on its own. Omit, or pass the
   * same person as `fallback`, when there's nothing to add; only a
   * genuinely DIFFERENT name produces the extra note below.
   */
  suggestion?: { name: string; signatory_capacity: string } | null;
}): { reviewStatus: ReviewStatus; checklistStatus: ChecklistStatus; value: string | null; note: string | null } {
  if (input.chosenId) {
    if (!input.chosenPerson) {
      return { reviewStatus: "missing", checklistStatus: "not_included", value: null, note: "The chosen signatory can no longer be found - choose again." };
    }
    return { reviewStatus: "confirmed", checklistStatus: "included", value: `${input.chosenPerson.name} - ${input.chosenPerson.signatory_capacity}`, note: null };
  }
  if (!input.fallback) {
    return { reviewStatus: "missing", checklistStatus: "not_included", value: null, note: "No one on your People page has a signatory capacity set." };
  }
  const suggestionDiffers =
    !!input.suggestion &&
    (input.suggestion.name !== input.fallback.name || input.suggestion.signatory_capacity !== input.fallback.signatory_capacity);
  return {
    reviewStatus: "needs_input",
    checklistStatus: "included_warning",
    value: `${input.fallback.name} - ${input.fallback.signatory_capacity}`,
    note: suggestionDiffers
      ? `Not chosen - will default to ${input.fallback.name} (your company's first signatory on file). ${input.suggestion!.name} looks like a better match for this tender (region/industry/discipline) - choose them on the submission form if you'd rather they sign.`
      : `Not chosen - will default to ${input.fallback.name} (suggested signatory for this tender).`,
  };
}

// field_key is a dotted path like "a_forms.A8.litigation" (0002_field_provenance.sql)
// - no display-name table exists, so this is a best-effort drop-prefix +
// title-case, kept identical to the Readiness card's own copy (page.tsx's
// humanizeFieldKey) so the same field reads the same way in both places.
export function humanizeFieldKey(fieldKey: string): string {
  const parts = fieldKey.split(".");
  const rest = parts.length > 1 ? parts.slice(1) : parts;
  return rest
    .join(" ")
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
