import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  GENERAL_COMPANY_COLUMNS,
  checkReturnable,
  companyFieldStates,
  questionStates,
  type GeneralCompany,
  type RequirementManifest,
  type ReturnableCheck,
  type TenderAnswer,
} from "@/lib/generalTender";
import { COMPANY_VAULT_COLUMNS } from "@/lib/tenderCompliance";
import { matchLocality, COMPANY_OFFICE_COLUMNS, type CompanyOffice, type LocalityRow } from "@/lib/locality";
import { TENDER_ROLE_COLUMNS, type TenderRole } from "@/lib/tenderRoles";
import { findMatchingExperience } from "@/lib/experience";
import { evaluateEvidence, type EvaluationRules } from "@/lib/experienceEvidence";
import { answerStatus, designatedSignatoryFallback, localityStatus, roleStatus, signatureAnswerStatus, specificGoalsLocalityRows } from "./general-pack-review-logic";
import { docItemStatus, type ReviewStatus } from "./pack-review-logic";

/**
 * checkReturnable's own `strength: "required" | "mentioned"` is this file's
 * equivalent of SANRAL's ComplianceItem.mandatory - a "required" returnable
 * left unconfirmed ("check") is a real disqualification risk, not a soft
 * Provide, the same reasoning pack-review-data.ts's own docItemReviewStatus()
 * applies to mandatory SANRAL doc items (see that function's comment).
 * docItemStatus(check.status) alone can't see `strength`, so on its own it
 * would show a required-but-unconfirmed returnable as Provide, not Fix.
 */
// Exported so submission-plan-data.ts can reuse this exact reasoning
// instead of keeping its own small duplicate in sync by hand (that
// duplicate was deliberate when it was written, same-day, while this file
// was under active edit - see submission-plan-data.ts's own history).
export function returnableReviewStatus(check: ReturnableCheck): { reviewStatus: ReviewStatus; checklistStatus: ReturnType<typeof docItemStatus>["checklistStatus"] } {
  const { checklistStatus } = docItemStatus(check.status);
  if (check.status === "have") return { reviewStatus: "confirmed", checklistStatus };
  if (check.strength === "required") return { reviewStatus: "missing", checklistStatus };
  const reviewStatus: ReviewStatus = check.status === "missing" ? "needs_input" : "assumed_default";
  return { reviewStatus, checklistStatus };
}
import type { ReviewItem, ReviewSection } from "./pack-review-data";

/**
 * General (non-SANRAL) tender Pack Review snapshot: the same "everything
 * that will go into the pack, confirm or change before compiling" idea as
 * pack-review-data.ts, built for requestGeneralPack()'s own inputs instead of
 * SANRAL's. There is no Form B7, no two-envelope structure, and people are
 * matched to roles via person_role_eligibility tags (0016/0031) rather than
 * SANRAL's one-person-per-position tender_pack_assignments - see
 * general-workspace.tsx and engine/general/process_general_jobs.py
 * gather_pack_inputs() for the real shape of what the pack bridge reads.
 *
 * Reuses ReviewItem/ReviewSection (pack-review-data.ts) - a generic shape,
 * not SANRAL-specific - and the generic classifiers in
 * general-pack-review-logic.ts. pack_review_confirmations (migration 0059)
 * is reused as-is: its schema is already just (company_id, tender_id), not
 * SANRAL-specific.
 *
 * `sections` is this snapshot's one list of items, each with its own
 * ReviewStatus (Verify/Provide/Fix) - previously also mirrored, item-for-
 * item, into a second `checklist: ChecklistRow[]` field rendered via a
 * second `<PackChecklist>` card right below (general-pack-review.tsx). That
 * was a real duplicate, not an intentional two-views design: every category
 * that built a checklist row (returnables, roles & CVs, experience,
 * locality - see this file's history) pushed the exact same title/status/
 * note into both places from the same loop, `pages` was always hardcoded
 * null (so it carried no information the real post-generation checklist
 * adds), and company fields/plain questions were never pushed to it at all
 * (only the signature question was) - an inconsistency, not a deliberate
 * scope cut, since nothing explained why those categories alone were left
 * out. The surviving `sections`/items view is the complete, actionable one
 * (every category, a status pill, a match-strength badge, and a "Confirm or
 * change" link to jump to the edit screen) - the checklist view added
 * nothing a user couldn't already see there, so it and its `pushChecklist`
 * plumbing were removed rather than kept as a second, non-actionable
 * summary. See app/AGENTS.md's dated entry for this pass for the full
 * reasoning. `PackChecklist`/`ChecklistRow` (pack-checklist.tsx) are
 * untouched and still used for the REAL post-generation pack checklist
 * (submission-pack.tsx, general-workspace.tsx) - that one is built from the
 * actual generated job's manifest, not duplicated from this screen's data.
 */

export type GeneralPackReviewSnapshot = {
  mapped: boolean; // false until this tender's documents have been read (document_requirements)
  sections: ReviewSection[];
  gapsCount: number;
  reviewed: { reviewedAt: string; reviewedBy: string | null } | null;
};

function section(key: string, title: string, changeHref: string, changeLabel: string, items: ReviewItem[]): ReviewSection {
  return { key, title, changeHref, changeLabel, items, error: null };
}

function failedSection(key: string, title: string, changeHref: string, changeLabel: string, err: unknown): ReviewSection {
  const message = err instanceof Error ? err.message : String(err);
  return { key, title, changeHref, changeLabel, items: [], error: `Couldn't load this section: ${message}` };
}

export const loadGeneralPackReviewSnapshot = cache(async (tenderId: string): Promise<GeneralPackReviewSnapshot> => {
  const supabase = await createClient();

  const [{ data: tender, error: tenderErr }, { data: ownPack, error: ownPackErr }] = await Promise.all([
    supabase.from("tenders").select("document_requirements, closing_date, evaluation_rules").eq("id", tenderId).maybeSingle(),
    supabase.from("tender_packs").select("id, company_id, document_requirements").eq("tender_id", tenderId).maybeSingle(),
  ]);
  // Standing review, 2026-11-06: 4th sweep blind spot (array/tuple
  // Promise.all destructures never match the sweep's own "const { data"
  // grep). This whole module is display-only (the Pack Review page's own
  // checklist) - general-actions.ts's own request gate never reads this
  // snapshot, so a failed read here just shows "mapped: false"/missing
  // items (safe direction), never a false pass. Logged, not gated.
  if (tenderErr) console.error("tenders select failed (general pack review)", tenderErr);
  if (ownPackErr) console.error("tender_packs select failed (general pack review)", ownPackErr);
  const manifest = ((ownPack?.document_requirements ?? tender?.document_requirements) as RequirementManifest | null) ?? null;
  if (!manifest || !tender) {
    return { mapped: false, sections: [], gapsCount: 0, reviewed: null };
  }
  const closingDate = (tender.closing_date as string | null) ?? null;

  const sections: ReviewSection[] = [];

  // --- Reviewed-so-far (pack_review_confirmations, 0059 - reused as-is) ----
  let reviewed: GeneralPackReviewSnapshot["reviewed"] = null;
  try {
    const { data: confirmation } = await supabase
      .from("pack_review_confirmations")
      .select("reviewed_at, reviewed_by, people:reviewed_by(name)")
      .eq("tender_id", tenderId)
      .maybeSingle();
    if (confirmation?.reviewed_at) {
      reviewed = {
        reviewedAt: confirmation.reviewed_at as string,
        reviewedBy: ((confirmation as unknown as { people?: { name: string } | null }).people?.name as string | undefined) ?? null,
      };
    }
  } catch {
    reviewed = null;
  }

  const [
    { data: companyRow, error: companyRowErr },
    { data: answerRows, error: answerRowsErr },
    { data: peopleRows, error: peopleRowsErr },
    { data: roleRows, error: roleRowsErr },
    { data: tagRows, error: tagRowsErr },
    { data: officeRows, error: officeRowsErr },
  ] = await Promise.all([
    supabase.from("companies").select(`${COMPANY_VAULT_COLUMNS}, ${GENERAL_COMPANY_COLUMNS}`).maybeSingle(),
    supabase.from("tender_answers").select("field_key, value, storage_path, original_filename, updated_at").eq("tender_id", tenderId),
    supabase.from("people").select("id, name, signatory_capacity, created_at").order("name"),
    supabase.from("tender_roles").select(TENDER_ROLE_COLUMNS),
    supabase.from("person_role_eligibility").select("person_id, role_code"),
    supabase.from("company_offices").select(COMPANY_OFFICE_COLUMNS),
  ]);
  if (companyRowErr) console.error("companies select failed (general pack review)", companyRowErr);
  if (answerRowsErr) console.error("tender_answers select failed (general pack review)", answerRowsErr);
  if (peopleRowsErr) console.error("people select failed (general pack review)", peopleRowsErr);
  if (roleRowsErr) console.error("tender_roles select failed (general pack review)", roleRowsErr);
  if (tagRowsErr) console.error("person_role_eligibility select failed (general pack review)", tagRowsErr);
  if (officeRowsErr) console.error("company_offices select failed (general pack review)", officeRowsErr);
  const company = (companyRow as unknown as GeneralCompany | null) ?? null;
  const answers = (answerRows ?? []) as TenderAnswer[];
  const people = (peopleRows ?? []) as { id: string; name: string; signatory_capacity: string | null; created_at: string }[];
  const roles = (roleRows ?? []) as TenderRole[];
  const tags = (tagRows ?? []) as { person_id: string; role_code: string }[];
  const offices = (officeRows ?? []) as CompanyOffice[];
  // Finding (this pass): the company's own designated-signatory fallback -
  // see signatureAnswerStatus()'s own doc comment (general-pack-review-logic.ts)
  // for why this screen needs to know about it at all.
  const signatoryFallback = designatedSignatoryFallback(people);

  // --- 1. Form answers: company details, tender questions, signature -------
  try {
    const items: ReviewItem[] = [];
    for (const { f, value, answered } of companyFieldStates(manifest.company_fields, company)) {
      const { status, note } = answerStatus(answered, f.optional ?? false);
      items.push({ key: `company-${f.key}`, label: f.label, value, status, note });
    }
    for (const { q, value, answered } of questionStates(manifest.questions, answers, company)) {
      if (q.type === "person") {
        const chosenId = value;
        const chosenPerson = chosenId ? people.find((p) => p.id === chosenId) ?? null : null;
        const sig = signatureAnswerStatus({ chosenId, chosenPerson, optional: q.optional ?? false, fallback: signatoryFallback });
        items.push({ key: `question-${q.key}`, label: q.label, value: sig.value, status: sig.reviewStatus, note: sig.note });
        continue;
      }
      const { status, note } = answerStatus(answered, q.optional ?? false);
      items.push({ key: `question-${q.key}`, label: q.label, value, status, note });
    }
    sections.push(section("general_answers", "Company details, questions & signature", "#general-questions", "Confirm or change", items));
  } catch (err) {
    sections.push(failedSection("general_answers", "Company details, questions & signature", "#general-questions", "Confirm or change", err));
  }

  // --- 2. Supporting documents (returnables) ---------------------------------
  try {
    const jvAnswer = answers.find((a) => a.field_key === "bidding_as_jv")?.value ?? null;
    const items: ReviewItem[] = manifest.returnables.map((r) => {
      const check = checkReturnable(r, company, closingDate, answers, jvAnswer === null ? null : jvAnswer === "yes");
      const { reviewStatus } = returnableReviewStatus(check);
      return {
        key: `returnable-${check.key}`, label: check.label, value: check.status === "have" ? "On file" : null, status: reviewStatus, note: check.detail,
        confidence: r.confidence ?? null, confidenceReason: r.confidence_reason ?? null,
      };
    });
    sections.push(section("general_documents", "Supporting documents", "#general-documents", "Upload or change", items));
  } catch (err) {
    sections.push(failedSection("general_documents", "Supporting documents", "#general-documents", "Upload or change", err));
  }

  // --- 3. Roles & CVs (person_role_eligibility) ------------------------------
  try {
    const items: ReviewItem[] = [];
    for (const mr of manifest.roles) {
      const role = roles.find((r) => r.code === mr.role_code) ?? null;
      const label = role?.title ?? mr.role_code;
      const taggedIds = tags.filter((t) => t.role_code === mr.role_code).map((t) => t.person_id);
      const taggedPeople = taggedIds.map((id) => people.find((p) => p.id === id)).filter((p): p is (typeof people)[number] => !!p);
      let withCv = 0;
      if (taggedIds.length > 0) {
        const [{ data: gen, error: genErr }, { data: up, error: upErr }] = await Promise.all([
          supabase.from("generated_cvs").select("person_id").in("person_id", taggedIds).eq("status", "ready"),
          supabase.from("cv_uploads").select("person_id").in("person_id", taggedIds),
        ]);
        if (genErr) console.error("generated_cvs select failed (general pack review roles)", genErr);
        if (upErr) console.error("cv_uploads select failed (general pack review roles)", upErr);
        const haveCv = new Set([...(gen ?? []).map((g) => g.person_id as string), ...(up ?? []).map((u) => u.person_id as string)]);
        withCv = taggedPeople.filter((p) => haveCv.has(p.id)).length;
      }
      const { reviewStatus, note } = roleStatus({ taggedCount: taggedPeople.length, taggedWithCvCount: withCv });
      items.push({
        key: `role-${mr.role_code}`,
        label,
        value: taggedPeople.length > 0 ? taggedPeople.map((p) => p.name).join(", ") : null,
        status: reviewStatus,
        note,
        confidence: mr.confidence ?? null,
        confidenceReason: mr.confidence_reason ?? null,
      });
    }
    sections.push(section("general_people", "Roles & CVs", "#general-people", "Tag or change", items));
  } catch (err) {
    sections.push(failedSection("general_people", "Roles & CVs", "#general-people", "Tag or change", err));
  }

  // --- 4. Company experience evidence ----------------------------------------
  try {
    const items: ReviewItem[] = [];
    const rules = (tender.evaluation_rules as EvaluationRules | null) ?? null;
    const evidenceRules = (rules?.experience_evidence?.rules?.length ? rules.experience_evidence.rules : manifest.experience_evidence.rules) ?? [];
    if (evidenceRules.length > 0) {
      // Finding, 2026-11-06: `company` comes from the batch `companies` read
      // above (outside any try/catch - a Supabase query error returns
      // {data: null}, it never throws, so it was never caught by this
      // section's own try/catch either). The old code only pushed an item
      // when `company?.id` was truthy, so a transient `companies` read
      // failure silently fell through to zero items here - indistinguishable
      // from "this tender genuinely has no experience-evidence requirement" -
      // exactly the "a section's own data failed to load but it quietly
      // contributes 0 items instead of being left out of the count" shape
      // tender-readiness.ts's own computeTenderReadiness() doc comment
      // explicitly warns is worse than omitting the section, just not caught
      // here because nothing actually threw. compliance-data.ts's SANRAL
      // equivalent (tenderCompliance.ts's B6 `!experienceAvailable` branch)
      // already pushes an honest "couldn't be read" item in this exact
      // situation - mirrored here now, same `needs_input`/"Provide" severity
      // (visible, not silently vanished, but not a hard pack-generation
      // blocker either - a real company-side gap still gets evaluated
      // normally below and can still reach `missing`/Fix).
      if (!company?.id) {
        items.push({
          key: "experience",
          label: "Qualifying experience",
          value: null,
          status: "needs_input",
          note: "Your company record couldn't be read for this check, so qualifying experience evidence isn't counted yet - try refreshing.",
        });
      } else {
        const rule = evidenceRules[0];
        const experience = await findMatchingExperience(supabase, company.id, {
          ...(rule.window_years ? { completedWithinYears: rule.window_years } : {}),
          ...(closingDate ? { asOf: closingDate.slice(0, 10) } : {}),
        });
        if (experience.error) {
          // Same shape, the other read that can fail without throwing
          // (the experience_matches RPC, findMatchingExperience() in
          // lib/experience.ts) - same fix, same reasoning as above.
          items.push({
            key: "experience",
            label: "Qualifying experience",
            value: null,
            status: "needs_input",
            note: "The Experience Library couldn't be read for this check, so qualifying experience evidence isn't counted yet - try refreshing.",
          });
        } else {
          const evidenceEval = evaluateEvidence({ rule, source: "tender_document", otherRules: evidenceRules.length - 1 }, experience.items, false);
          const { reviewStatus } = docItemStatus(evidenceEval.status);
          items.push({
            key: "experience",
            label: "Qualifying experience",
            // evidenceEval.qualifying, not a fresh document-type-only filter
            // here - Finding 234 (see itemQualifiesForRule()'s own comment,
            // lib/experienceEvidence.ts): a re-filter that skips the rule's
            // own since_year cutoff showed a higher count than the status/
            // note right next to it, which already account for it.
            value: `${evidenceEval.qualifying} item(s)`,
            status: reviewStatus,
            note: evidenceEval.detail,
          });
        }
      }
    }
    sections.push(section("experience", "Company experience evidence", "#general-people", "Confirm or change", items));
  } catch (err) {
    sections.push(failedSection("experience", "Company experience evidence", "#general-people", "Confirm or change", err));
  }

  // --- 5. Office location -----------------------------------------------------
  try {
    const rules = (tender.evaluation_rules as EvaluationRules | null) ?? null;
    const allLocRows = ((rules?.locality?.rows?.length ? rules.locality.rows : manifest.locality.rows) ?? []) as LocalityRow[];
    // Finding 343, 2026-11-10: this "Office location points" item means
    // specific-goals locality points - see specificGoalsLocalityRows()'s own
    // comment (general-pack-review-logic.ts) for why every row used to be
    // passed to matchLocality() here regardless of `kind`, and what real,
    // documented tender (uMlalazi LM) that silently got wrong.
    const locRows = specificGoalsLocalityRows(allLocRows);
    const mandatory = rules?.locality?.mandatory_local_office ?? manifest.locality.mandatory_local_office;
    const items: ReviewItem[] = [];
    if (locRows.length > 0 || mandatory) {
      const m = matchLocality(locRows.length > 0 ? locRows : mandatory ? [{ area: mandatory.area, level: "municipality", province: null, points: 0, system: null, kind: "specific_goals" }] : [], offices);
      const { reviewStatus } = localityStatus({ matchStatus: m.status, mandatory: !!mandatory, disqualifies: !!mandatory?.disqualifies });
      items.push({ key: "locality", label: mandatory ? `Local office in ${mandatory.area}` : "Office location points", value: m.status === "matched" ? `${m.points ?? 0} pts` : null, status: reviewStatus, note: m.reason });
    }
    sections.push(section("locality", "Office location", "#general-people", "Confirm or change", items));
  } catch (err) {
    sections.push(failedSection("locality", "Office location", "#general-people", "Confirm or change", err));
  }

  const gapsCount = sections.reduce((n, s) => n + s.items.filter((i) => i.status === "missing" || i.status === "warning").length, 0);

  return { mapped: true, sections, gapsCount, reviewed };
});
