/**
 * Pure, DB-free classification for the submission-plan ("assessment engine")
 * screen - the TypeScript port of engine/general/submission_plan.py's
 * compile_plan(), per the architecture resolved with Sarel 2026-10-21 (see
 * docs/specs/System-Status.md): the plan can't be computed by calling that
 * Python module live from the app, the same way every other "read the
 * manifest, classify it" screen here (general-pack-review-logic.ts,
 * pack-review-logic.ts) works by reading the already-stored
 * tenders.document_requirements manifest and classifying it in TypeScript.
 *
 * Only covers the categories with NO existing classifier to reuse: forms,
 * buyer_forms, CIDB grading comparison, the compulsory briefing, and
 * unrepresented gaps. Returnables/roles/questions are NOT re-derived here -
 * submission-plan-data.ts calls the real, already-established
 * checkReturnable()/roleStatus()/answerStatus()/signatureAnswerStatus()
 * (lib/generalTender.ts, general-pack-review-logic.ts) directly, so this
 * plan never silently disagrees with what Pack Review already says about
 * the exact same document or role.
 *
 * Targets the ONE now-canonical status vocabulary (ReviewStatus,
 * pack-review-logic.ts) rather than porting compile_plan()'s own
 * ready/needs_document/needs_input/by_hand/review/blocked vocabulary
 * verbatim - that would be a 5th parallel status system landing right as
 * the UI/UX review session finishes eliminating the other 4 into one
 * Verify/Provide/Fix model (see System-Status.md).
 */
import type { BidTaskStatus } from "./bid-task-status";
import { reviewStatusToBidTask, type ReviewStatus } from "./pack-review-logic";
import type { ManifestForm, RequirementManifest } from "@/lib/generalTender";

export type PlanStep = {
  category: string;
  id: string;
  title: string;
  reviewStatus: ReviewStatus;
  bidTaskStatus: BidTaskStatus;
  note: string;
  document?: string | null;
  quote?: string | null;
};

/**
 * What KIND of work a step actually is, separate from its Verify/Provide/Fix
 * status (whether it needs fixing) - Sarel's own live feedback on this
 * screen: "indicate if it requires a physical action, a decision, a
 * document, info, review etc not just [a status badge], it is not
 * descriptive enough, you can still color code if [it] needs fixing or done
 * or ready to submit." Two different questions about the same step ("is
 * this OK?" vs "what do I actually have to go and DO?"), so this is a
 * second tag next to the existing status badge, never a replacement for it.
 *
 * Derived purely from the step's own `category` (already a required field,
 * nothing new to read) plus, for forms/buyer forms, whether the engine
 * already filled it in - no new data, no schema change.
 */
export type ActionType = "physical" | "decision" | "document" | "info" | "review";

export function actionTypeForStep(step: PlanStep): ActionType {
  switch (step.category) {
    case "briefing":
      return "physical"; // attending in person - no document or decision resolves this
    case "role":
    case "cidb_grading":
      return "decision"; // who to tag, or whether the company's own grading actually qualifies
    case "returnable":
      return "document"; // something to have on file or upload
    case "form":
    case "buyer_form":
      // The engine already filled/typed it - a glance confirms it (review);
      // "by hand" means a person still has to produce the completed form.
      return step.bidTaskStatus === "verify" ? "review" : "document";
    case "gap":
      return "review"; // the engine couldn't tell - a person has to look and judge
    case "question":
    default:
      return "info"; // something only a person knows, typed into a field
  }
}

function step(
  category: string,
  id: string,
  title: string,
  reviewStatus: ReviewStatus,
  note: string,
  document?: string | null,
  quote?: string | null,
): PlanStep {
  return { category, id, title, reviewStatus, bidTaskStatus: reviewStatusToBidTask(reviewStatus), note, document: document ?? null, quote: quote ?? null };
}

/**
 * A form's own status (ManifestForm.status) -> this plan's ReviewStatus.
 *
 * Checked against FORM_STATUS_STYLE (lib/generalTender.ts) - the one place
 * this exact status is already styled in the app - before deciding, not a
 * guess: "auto"/"attach"/"overlay" are all styled GREEN ("Filled for you" /
 * "From the vault" / "Typed onto the PDF") - the engine already did the
 * work, a human only needs to glance at it - Verify (confirmed). "by_hand"
 * is styled AMBER ("Complete by hand"), the SAME color Provide uses, not
 * red/Fix - a form that needs manual completion isn't itself a
 * disqualification risk the way a missing mandatory document is
 * (app/AGENTS.md's own Provide definition: "only the user can supply ...
 * not a disqualification risk"), it's just work only a person can do. So
 * by_hand -> needs_input (Provide), matching the color this status already
 * has everywhere else in the app, not missing (Fix) - a real decision this
 * port had to make that the Python reference never did (it has no
 * Verify/Provide/Fix model to agree with).
 */
export function formStepStatus(status: ManifestForm["status"]): ReviewStatus {
  if (status === "by_hand") return "needs_input";
  return "confirmed"; // auto, attach, overlay
}

export function formStep(f: ManifestForm, formSuite: RequirementManifest["form_suite"]): PlanStep {
  const prefix = formSuite ?? "SBD";
  // ManifestForm has no flat `document` field (unlike buyer_forms/returnables) -
  // best-effort fallback to its first edition's own document name.
  const document = f.editions[0]?.document ?? null;
  return step("form", `form:${f.code}`, `${prefix} ${f.code} - ${f.label}`, formStepStatus(f.status), f.reason, document, f.quote);
}

type ManifestBuyerForm = RequirementManifest["buyer_forms"][number];

/** Same reasoning as formStepStatus: an overlay (the engine CAN type this form) -> Verify; otherwise it's a by-hand-only form -> Provide, never Fix. */
export function buyerFormStep(b: ManifestBuyerForm): PlanStep {
  const reviewStatus: ReviewStatus = b.overlay ? "confirmed" : "needs_input";
  return step("buyer_form", `buyer_form:${b.key}`, b.label, reviewStatus, b.reason, b.document, b.quote ?? null);
}

/**
 * The CIDB GRADING LEVEL this tender names, compared against the company's
 * own grading on file - separate from the "cidb" returnable (which is about
 * whether a CIDB registration document exists at all; see
 * submission-plan-data.ts).
 *
 * No grading recorded at all on the company -> missing/Fix, the same
 * treatment checkReturnable() already gives the "cidb" returnable's own
 * missing case (lib/generalTender.ts) - nothing to even start confirming
 * against.
 *
 * Grading on file -> needs_input/Provide, deliberately NOT confirmed/Verify:
 * this engine admits it can't compare grading codes itself ("Tender Tool
 * doesn't compare grading levels for you"), so a human must actually make
 * the comparison - a genuine decision only a person can make, the same
 * reasoning localityStatus()'s own "unknown" case already uses
 * (general-pack-review-logic.ts: the system genuinely can't tell -> Provide,
 * not "just glance and confirm" the way an auto-filled form is).
 */
export function cidbGradingStep(cidb: NonNullable<RequirementManifest["cidb"]>, companyCidbGrading: string | null): PlanStep {
  const have = !!companyCidbGrading;
  const reviewStatus: ReviewStatus = have ? "needs_input" : "missing";
  let note = have
    ? `Company's own grading on file is ${companyCidbGrading} - confirm this actually meets or exceeds ${cidb.grading} (Tender Tool doesn't compare grading levels for you).`
    : `Company has no CIDB grading on file - confirm it meets ${cidb.grading} before bidding.`;
  // Found 2026-10-31: engine/general/submission_plan.py's own cidbGradingStep
  // equivalent appends this exact warning when requirements.py's cidb.ambiguous
  // is true (more than one different grading found across the documents read,
  // e.g. an addendum correcting the original notice) - the real, stored
  // manifest carries this flag (process_general_jobs.py writes it verbatim),
  // but this TS port never read it at all, so the live Submission Plan screen
  // silently dropped a real, already-fixed-once compliance warning the Python
  // reference still shows on the exact same data.
  if (cidb.ambiguous) {
    note += ` More than one different CIDB grading was found across the documents read - ${cidb.grading} is shown, ` +
      "but check the tender notice and any addenda for the actual, current requirement before relying on this.";
  }
  return step("cidb_grading", "cidb_grading", `CIDB grading ${cidb.grading} required`, reviewStatus, note, null, cidb.quote);
}

/**
 * A compulsory briefing is an action only a person can physically go and do
 * - always Provide, never Verify (nothing was filled for you) or Fix (it's
 * the person's own job to attend, not a document/data gap). Non-compulsory
 * briefings are never surfaced here at all - the caller only builds this
 * step when manifest.briefing.compulsory is true.
 */
export function briefingStep(briefing: NonNullable<RequirementManifest["briefing"]>): PlanStep {
  return step(
    "briefing",
    "briefing",
    "Attend the compulsory briefing session",
    "needs_input",
    "A compulsory briefing is required - find its actual date in the tender documents and attend it; a bid is normally disqualified without proof of attendance.",
    null,
    briefing.quote,
  );
}

/**
 * requirements.py's own gaps list restates "X must be completed by hand:"/
 * "X is a flat PDF:" for every by_hand/overlay form - already represented
 * above as that form's own step (same reason text, same source). Only the
 * gaps that AREN'T a per-form restatement carry new information here.
 * Ported faithfully from submission_plan.py's own `_form_gap_prefixes` -
 * no TS equivalent existed before this.
 */
export function unrepresentedGaps(manifest: RequirementManifest): string[] {
  const formGapPrefixes = manifest.forms
    .filter((f) => f.status === "by_hand" || f.status === "overlay")
    .map((f) => (f.status === "by_hand" ? `${f.label} must be completed by hand:` : `${f.label} is a flat PDF:`));
  return (manifest.gaps ?? []).filter((gap) => !formGapPrefixes.some((prefix) => gap.startsWith(prefix)));
}

/**
 * A gap is the engine admitting it couldn't confidently determine something
 * (an unreadable document, a combined bulletin it declined to extract from,
 * a suite it couldn't identify) - a real, unresolved risk if ignored, unlike
 * a by_hand form (the engine succeeded, a person just has to do known work)
 * - missing/Fix, not Provide.
 */
export function gapStep(gap: string, index: number): PlanStep {
  return step("gap", `gap:${index}`, "Known limitation", "missing", gap);
}
