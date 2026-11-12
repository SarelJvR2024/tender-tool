import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  GENERAL_COMPANY_COLUMNS,
  checkReturnable,
  questionStates,
  type GeneralCompany,
  type RequirementManifest,
  type TenderAnswer,
} from "@/lib/generalTender";
import { COMPANY_VAULT_COLUMNS } from "@/lib/tenderCompliance";
import { TENDER_ROLE_COLUMNS, type TenderRole } from "@/lib/tenderRoles";
import { answerStatus, roleStatus, signatureAnswerStatus } from "./general-pack-review-logic";
import { reviewStatusToBidTask } from "./pack-review-logic";
import { returnableReviewStatus } from "./general-pack-review-data";
import type { BidTaskStatus } from "./bid-task-status";
import { tenderTimeline, type TimelineMilestone } from "@/lib/tenderTimeline";
import {
  briefingStep,
  buyerFormStep,
  cidbGradingStep,
  formStep,
  gapStep,
  reconcileQuestionProvenance,
  unrepresentedGaps,
  type PlanStep,
} from "./submission-plan-logic";

/**
 * The submission-plan ("assessment engine") snapshot: one step per thing
 * this tender's documents ask for, built from the SAME already-stored
 * manifest and the SAME real company/tender_answers/tender_roles data every
 * other Pack Review section already reads - never a second, disagreeing
 * read of what's "required" or "on file". See submission-plan-logic.ts's
 * own header for the full architecture rationale.
 *
 * Reuses general-pack-review-data.ts's own `returnableReviewStatus()`
 * directly for returnables (checkReturnable's `strength: "required" |
 * "mentioned"` field is this screen's equivalent of SANRAL's
 * ComplianceItem.mandatory) - this was a small local duplicate when first
 * written, same-day, while that file was under active edit by another
 * Claude session; now exported there and imported here instead, once that
 * file settled (see docs/specs/System-Status.md).
 */

export type SubmissionPlanSnapshot = {
  mapped: boolean; // false until this tender's documents have been read (document_requirements)
  steps: PlanStep[];
  summary: Record<BidTaskStatus, number> & { total: number };
  // Due-date warnings for the compulsory briefing and submission deadline -
  // NOT a checklist step (see app/lib/tenderTimeline.ts and
  // docs/specs/System-Status.md, Sarel's own explicit refinement).
  timeline: TimelineMilestone[];
};

const EMPTY_SUMMARY: SubmissionPlanSnapshot["summary"] = { verify: 0, provide: 0, fix: 0, total: 0 };

function summarize(steps: PlanStep[]): SubmissionPlanSnapshot["summary"] {
  const summary: SubmissionPlanSnapshot["summary"] = { verify: 0, provide: 0, fix: 0, total: steps.length };
  for (const s of steps) summary[s.bidTaskStatus] += 1;
  return summary;
}

export const loadSubmissionPlan = cache(async (tenderId: string): Promise<SubmissionPlanSnapshot> => {
  const supabase = await createClient();

  const [{ data: tender, error: tenderErr }, { data: ownPack, error: ownPackErr }] = await Promise.all([
    supabase.from("tenders").select("document_requirements, closing_date, briefing_date").eq("id", tenderId).maybeSingle(),
    supabase.from("tender_packs").select("id, company_id, document_requirements").eq("tender_id", tenderId).maybeSingle(),
  ]);
  // Standing review, 2026-11-06: 4th sweep blind spot (array/tuple
  // Promise.all destructures never match "const { data"). Display-only
  // (Disqualification guard/submission-plan-view read this for a UI
  // banner, never a server-side submit block) - safe direction, logged.
  if (tenderErr) console.error("tenders select failed (submission plan)", tenderErr);
  if (ownPackErr) console.error("tender_packs select failed (submission plan)", ownPackErr);
  const manifest = ((ownPack?.document_requirements ?? tender?.document_requirements) as RequirementManifest | null) ?? null;
  if (!manifest || !tender) {
    return { mapped: false, steps: [], summary: EMPTY_SUMMARY, timeline: [] };
  }
  const closingDate = (tender.closing_date as string | null) ?? null;
  const briefingDate = (tender.briefing_date as string | null) ?? null;

  const timeline = tenderTimeline({
    closingDate,
    briefingDate,
    briefingCompulsory: manifest.briefing?.compulsory ?? null,
  });

  const steps: PlanStep[] = [];

  // --- Forms & buyer forms: no DB needed, pure manifest classification ------
  for (const f of manifest.forms) steps.push(formStep(f, manifest.form_suite));
  for (const b of manifest.buyer_forms ?? []) steps.push(buyerFormStep(b));

  const packId = (ownPack?.id as string | undefined) ?? null;
  const [
    { data: companyRow, error: companyRowErr },
    { data: answerRows, error: answerRowsErr },
    { data: peopleRows, error: peopleRowsErr },
    { data: roleCatalogRows, error: roleCatalogRowsErr },
    { data: tagRows, error: tagRowsErr },
    { data: provenanceRows, error: provenanceRowsErr },
  ] = await Promise.all([
    supabase.from("companies").select(`${COMPANY_VAULT_COLUMNS}, ${GENERAL_COMPANY_COLUMNS}`).maybeSingle(),
    supabase.from("tender_answers").select("field_key, value, storage_path, original_filename, updated_at").eq("tender_id", tenderId),
    supabase.from("people").select("id, name, signatory_capacity").order("name"),
    supabase.from("tender_roles").select(TENDER_ROLE_COLUMNS),
    supabase.from("person_role_eligibility").select("person_id, role_code"),
    // Finding 284/285/this fix's own root signal: what fill_sbd_docx.py
    // actually managed to place in the real generated .docx for THIS
    // buyer's specific edition - read for the SAME ownPack.id this file
    // already fetches above, so a question answered in tender_answers but
    // never actually placed in the pack (an edition mismatch) doesn't show
    // as plain "Verify" here. Empty when no pack has ever been generated
    // (packId is null) - every question then falls back to the pre-existing
    // answerStatus() result, unchanged - see reconcileQuestionProvenance().
    packId
      ? supabase.from("field_provenance").select("field_key, status, reason").eq("tender_pack_id", packId)
      : Promise.resolve({ data: [] as { field_key: string; status: string; reason: string | null }[], error: null }),
  ]);
  if (companyRowErr) console.error("companies select failed (submission plan)", companyRowErr);
  if (answerRowsErr) console.error("tender_answers select failed (submission plan)", answerRowsErr);
  if (peopleRowsErr) console.error("people select failed (submission plan)", peopleRowsErr);
  if (roleCatalogRowsErr) console.error("tender_roles select failed (submission plan)", roleCatalogRowsErr);
  if (tagRowsErr) console.error("person_role_eligibility select failed (submission plan)", tagRowsErr);
  if (provenanceRowsErr) console.error("field_provenance select failed (submission plan)", provenanceRowsErr);
  const company = (companyRow as unknown as GeneralCompany | null) ?? null;
  const answers = (answerRows ?? []) as TenderAnswer[];
  const people = (peopleRows ?? []) as { id: string; name: string; signatory_capacity: string | null }[];
  const roleCatalog = (roleCatalogRows ?? []) as TenderRole[];
  const tags = (tagRows ?? []) as { person_id: string; role_code: string }[];
  const provenanceByKey = new Map(
    ((provenanceRows ?? []) as { field_key: string; status: string; reason: string | null }[]).map((r) => [r.field_key, r]),
  );

  // --- Returnables ------------------------------------------------------------
  try {
    const jvAnswer = answers.find((a) => a.field_key === "bidding_as_jv")?.value ?? null;
    for (const r of manifest.returnables) {
      const check = checkReturnable(r, company, closingDate, answers, jvAnswer === null ? null : jvAnswer === "yes");
      const { reviewStatus } = returnableReviewStatus(check);
      const title = check.label + (r.conditional === "jv" ? " (only if bidding as a JV/consortium)" : "");
      steps.push({
        category: "returnable",
        id: `returnable:${check.key}`,
        title,
        reviewStatus,
        bidTaskStatus: reviewStatusToBidTask(reviewStatus),
        note: check.detail,
        document: null,
        quote: check.quote ?? null,
      });
    }
  } catch {
    // One failed section never blocks the rest of the plan - same
    // per-section isolation discipline as general-pack-review-data.ts.
  }

  // --- Questions, including the signatory ("person" type) question ----------
  try {
    for (const { q, value, answered } of questionStates(manifest.questions, answers, company)) {
      if (q.type === "person") {
        const chosenId = value;
        const chosenPerson = chosenId ? (people.find((p) => p.id === chosenId) ?? null) : null;
        const sig = signatureAnswerStatus({ chosenId, chosenPerson, optional: q.optional ?? false });
        steps.push({
          category: "question",
          id: `question:${q.key}`,
          title: q.label,
          reviewStatus: sig.reviewStatus,
          bidTaskStatus: reviewStatusToBidTask(sig.reviewStatus),
          note: sig.note ?? "Only a person can answer this for this specific tender.",
          document: null,
          quote: null,
        });
        continue;
      }
      const { status, note } = reconcileQuestionProvenance(answerStatus(answered, q.optional ?? false), provenanceByKey.get(q.key) ?? null);
      steps.push({
        category: "question",
        id: `question:${q.key}`,
        title: q.label || q.key,
        reviewStatus: status,
        bidTaskStatus: reviewStatusToBidTask(status),
        note: note ?? "Only a person can answer this for this specific tender.",
        document: null,
        quote: null,
      });
    }
  } catch {
    // isolated, same reason as above
  }

  // --- Key-personnel roles -----------------------------------------------------
  try {
    for (const role of manifest.roles) {
      const catalogEntry = roleCatalog.find((r) => r.code === role.role_code) ?? null;
      const label = catalogEntry?.title ?? role.role_code;
      const taggedIds = tags.filter((t) => t.role_code === role.role_code).map((t) => t.person_id);
      const taggedPeople = taggedIds
        .map((id) => people.find((p) => p.id === id))
        .filter((p): p is { id: string; name: string; signatory_capacity: string | null } => !!p);
      let withCv = 0;
      if (taggedIds.length > 0) {
        const [{ data: gen, error: genErr }, { data: up, error: upErr }] = await Promise.all([
          // status='ready' alone isn't enough: process_cv_jobs.py writes
          // status='ready' with storage_path_pdf left null when LibreOffice's
          // docx->pdf conversion fails on an otherwise-'ready' job (same gap
          // Finding 305, 2026-11-10, already fixed on the Pack Review screens
          // via tenderCvUsable() - this Submission Plan role check reads the
          // identical generated_cvs table but is a separate query this app
          // doesn't yet have a shared helper on `main` for, since that fix is
          // still only on open PR #211). process_general_jobs.py's own
          // gather_pack_inputs() (line ~740) requires storage_path_pdf too
          // before it will actually use a generated CV - this check now
          // agrees with the real pack-build engine instead of just the row's
          // status column.
          //
          // QA finding, 2026-11-10 (Finding 355): a generated_cvs row is
          // ALWAYS tender-specific once it exists at all - requestTenderCv()
          // (actions.ts) never inserts one without a tender_id, and 0008's
          // own check constraint ((tender_id is null) = (position_code is
          // null)) guarantees a role-tagged row (position_code set) always
          // carries a real tender_id too. Without this .eq, a person's CV
          // generated and built with a DIFFERENT tender's own requirement-
          // matching cover page (generate_cv.py's --tender/--position,
          // scored against THAT tender's tender_pack_assignments row) was
          // silently counted as "has a CV" here for THIS tender as well -
          // the identical generated_cvs tender-scoping gap Finding 342/PR
          // #221 found and is fixing on the engine side
          // (process_general_jobs.py's own gather_pack_inputs(), still
          // unmerged) and standing item 29 already flags as unfixed on
          // general-pack-review-data.ts (left there deliberately - PR #211
          // already touches those exact lines for a different rule). This
          // file is untouched by both PR #211 and PR #221, so fixing it here
          // creates no collision with either.
          supabase.from("generated_cvs").select("person_id, storage_path_pdf").in("person_id", taggedIds).eq("status", "ready").eq("tender_id", tenderId),
          supabase.from("cv_uploads").select("person_id").in("person_id", taggedIds),
        ]);
        if (genErr) console.error("generated_cvs select failed (submission plan roles)", genErr);
        if (upErr) console.error("cv_uploads select failed (submission plan roles)", upErr);
        const haveCv = new Set([
          ...(gen ?? []).filter((g) => g.storage_path_pdf).map((g) => g.person_id as string),
          ...(up ?? []).map((u) => u.person_id as string),
        ]);
        withCv = taggedPeople.filter((p) => haveCv.has(p.id)).length;
      }
      const { reviewStatus, note } = roleStatus({ taggedCount: taggedPeople.length, taggedWithCvCount: withCv });
      steps.push({
        category: "role",
        id: `role:${role.role_code}`,
        title: `Key personnel: ${label}`,
        reviewStatus,
        bidTaskStatus: reviewStatusToBidTask(reviewStatus),
        note: note ?? "No person is tagged for this role yet on this tender - assign someone and attach their CV.",
        document: role.document ?? null,
        quote: role.quote ?? null,
      });
    }
  } catch {
    // isolated, same reason as above
  }

  // --- CIDB grading comparison & compulsory briefing --------------------------
  try {
    if (manifest.cidb) steps.push(cidbGradingStep(manifest.cidb, company?.cidb_grading ?? null));
    if (manifest.briefing?.compulsory) steps.push(briefingStep(manifest.briefing));
  } catch {
    // isolated, same reason as above
  }

  // --- Unrepresented gaps -------------------------------------------------------
  try {
    unrepresentedGaps(manifest).forEach((gap, i) => steps.push(gapStep(gap, i)));
  } catch {
    // isolated, same reason as above
  }

  return { mapped: true, steps, summary: summarize(steps), timeline };
});
