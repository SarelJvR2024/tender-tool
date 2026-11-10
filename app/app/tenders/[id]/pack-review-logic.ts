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
 * default fallback signer. `fallback` is whichever signatory would be
 * pre-selected if nobody has chosen one yet - with migration 0061 that's
 * the best region/industry/discipline scope match for this tender
 * (signatory-logic.ts pickDefaultSignatory), falling back to the first
 * signatory on file when there's no scope data or no match; before 0061 it
 * was always "first signatory on file". Either way this function doesn't
 * care which kind of fallback it was given - only that a choice exists.
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
  return {
    reviewStatus: "needs_input",
    checklistStatus: "included_warning",
    value: `${input.fallback.name} - ${input.fallback.signatory_capacity}`,
    note: `Not chosen - will default to ${input.fallback.name} (suggested signatory for this tender).`,
  };
}

// field_key is a dotted path like "a_forms.A8.litigation" (0002_field_provenance.sql)
// - no display-name table exists, so this is a best-effort drop-prefix +
// title-case, plus a small override table for the keys that read as raw
// internal identifiers under the generic pass alone (QA finding,
// 2026-10-26: "signatory_person_id" -> "Signatory Person Id", a raw DB
// column suffix, not a real-world name; "company.bee_level" -> "Bee
// Level", losing the B-BBEE term entirely).
//
// This used to be a second copy of page.tsx's own humanizeFieldKey,
// commented "kept identical ... so the same field reads the same way in
// both places" - found 2026-11-10 to have silently drifted: that fix and
// the "a_forms.A8.litigation" -> "Form A8 - Litigation" special case both
// landed only in page.tsx's copy, never here, so the Pack Review card
// (pack-review-data.ts, below) kept showing the raw, unfixed label for the
// exact same field the Readiness card (page.tsx) showed correctly. Now the
// single source of truth - page.tsx imports this instead of keeping its
// own copy.
export const FIELD_KEY_LABELS: Record<string, string> = {
  signatory_person_id: "Signatory",
  "company.bee_level": "B-BBEE level",
  "contract_data.client_name": "Client name (Contract Data form)",
  "financial_hours.summary": "Financial & hours workbook",
};

function titleCaseWords(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function humanizeFieldKey(fieldKey: string): string {
  if (FIELD_KEY_LABELS[fieldKey]) return FIELD_KEY_LABELS[fieldKey];
  const parts = fieldKey.split(".");
  // "a_forms.A8.litigation" -> "Form A8 - Litigation", matching this app's
  // own "Form A12"/"Form B6" convention for a real SANRAL document code
  // (compliance-report.tsx) rather than silently dropping the word "Form".
  if (parts[0] === "a_forms" && parts.length > 1) {
    const rest = parts.slice(2);
    return rest.length > 0 ? `Form ${parts[1]} - ${titleCaseWords(rest.join(" "))}` : `Form ${parts[1]}`;
  }
  const rest = parts.length > 1 ? parts.slice(1) : parts;
  return titleCaseWords(rest.join(" "));
}
