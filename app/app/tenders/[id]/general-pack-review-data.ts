import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  GENERAL_COMPANY_COLUMNS,
  checkReturnable,
  companyFieldStates,
  questionStates,
  type GeneralCompany,
  type RequirementManifest,
  type TenderAnswer,
} from "@/lib/generalTender";
import { COMPANY_VAULT_COLUMNS } from "@/lib/tenderCompliance";
import { matchLocality, COMPANY_OFFICE_COLUMNS, type CompanyOffice, type LocalityRow } from "@/lib/locality";
import { TENDER_ROLE_COLUMNS, type TenderRole } from "@/lib/tenderRoles";
import { findMatchingExperience } from "@/lib/experience";
import { acceptedDocTypes, evaluateEvidence, type EvaluationRules } from "@/lib/experienceEvidence";
import { answerStatus, localityStatus, roleStatus, signatureAnswerStatus } from "./general-pack-review-logic";
import { docItemStatus } from "./pack-review-logic";
import type { ReviewItem, ReviewSection } from "./pack-review-data";
import type { ChecklistRow } from "./pack-checklist";

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
 * Reuses ReviewItem/ReviewSection (pack-review-data.ts) and ChecklistRow
 * (pack-checklist.tsx) - both generic shapes, not SANRAL-specific - and the
 * generic classifiers in general-pack-review-logic.ts. pack_review_confirmations
 * (migration 0059) is reused as-is: its schema is already just
 * (company_id, tender_id), not SANRAL-specific.
 *
 * Same per-item error-isolation discipline as pack-review-data.ts: every
 * section is its own try/catch so one bad record can't take the whole
 * screen down.
 */

export type GeneralPackReviewSnapshot = {
  mapped: boolean; // false until this tender's documents have been read (document_requirements)
  sections: ReviewSection[];
  checklist: ChecklistRow[];
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

  const [{ data: tender }, { data: ownPack }] = await Promise.all([
    supabase.from("tenders").select("document_requirements, closing_date, evaluation_rules").eq("id", tenderId).maybeSingle(),
    supabase.from("tender_packs").select("id, company_id, document_requirements").eq("tender_id", tenderId).maybeSingle(),
  ]);
  const manifest = ((ownPack?.document_requirements ?? tender?.document_requirements) as RequirementManifest | null) ?? null;
  if (!manifest || !tender) {
    return { mapped: false, sections: [], checklist: [], gapsCount: 0, reviewed: null };
  }
  const closingDate = (tender.closing_date as string | null) ?? null;

  const sections: ReviewSection[] = [];
  const checklist: ChecklistRow[] = [];
  let checklistNo = 0;
  const pushChecklist = (row: Omit<ChecklistRow, "no">) => checklist.push({ no: ++checklistNo, ...row });

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

  const [{ data: companyRow }, { data: answerRows }, { data: peopleRows }, { data: roleRows }, { data: tagRows }, { data: officeRows }] = await Promise.all([
    supabase.from("companies").select(`${COMPANY_VAULT_COLUMNS}, ${GENERAL_COMPANY_COLUMNS}`).maybeSingle(),
    supabase.from("tender_answers").select("field_key, value, storage_path, original_filename, updated_at").eq("tender_id", tenderId),
    supabase.from("people").select("id, name, signatory_capacity").order("name"),
    supabase.from("tender_roles").select(TENDER_ROLE_COLUMNS),
    supabase.from("person_role_eligibility").select("person_id, role_code"),
    supabase.from("company_offices").select(COMPANY_OFFICE_COLUMNS),
  ]);
  const company = (companyRow as unknown as GeneralCompany | null) ?? null;
  const answers = (answerRows ?? []) as TenderAnswer[];
  const people = (peopleRows ?? []) as { id: string; name: string; signatory_capacity: string | null }[];
  const roles = (roleRows ?? []) as TenderRole[];
  const tags = (tagRows ?? []) as { person_id: string; role_code: string }[];
  const offices = (officeRows ?? []) as CompanyOffice[];

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
        const sig = signatureAnswerStatus({ chosenId, chosenPerson, optional: q.optional ?? false });
        pushChecklist({ title: q.label, envelope: "Signature", status: sig.checklistStatus, pages: null, note: sig.note });
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
      const { reviewStatus, checklistStatus } = docItemStatus(check.status);
      pushChecklist({ title: check.label, envelope: "Supporting documents", status: checklistStatus, pages: null, note: check.status === "have" ? null : check.detail });
      return { key: `returnable-${check.key}`, label: check.label, value: check.status === "have" ? "On file" : null, status: reviewStatus, note: check.detail };
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
      const taggedPeople = taggedIds.map((id) => people.find((p) => p.id === id)).filter((p): p is { id: string; name: string; signatory_capacity: string | null } => !!p);
      let withCv = 0;
      if (taggedIds.length > 0) {
        const [{ data: gen }, { data: up }] = await Promise.all([
          supabase.from("generated_cvs").select("person_id").in("person_id", taggedIds).eq("status", "ready"),
          supabase.from("cv_uploads").select("person_id").in("person_id", taggedIds),
        ]);
        const haveCv = new Set([...(gen ?? []).map((g) => g.person_id as string), ...(up ?? []).map((u) => u.person_id as string)]);
        withCv = taggedPeople.filter((p) => haveCv.has(p.id)).length;
      }
      const { reviewStatus, checklistStatus, note } = roleStatus({ taggedCount: taggedPeople.length, taggedWithCvCount: withCv });
      pushChecklist({ title: `${label} - CV(s)`, envelope: "Key personnel CVs", status: checklistStatus, pages: null, note });
      items.push({
        key: `role-${mr.role_code}`,
        label,
        value: taggedPeople.length > 0 ? taggedPeople.map((p) => p.name).join(", ") : null,
        status: reviewStatus,
        note,
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
    if (evidenceRules.length > 0 && company?.id) {
      const rule = evidenceRules[0];
      const experience = await findMatchingExperience(supabase, company.id, {
        ...(rule.window_years ? { completedWithinYears: rule.window_years } : {}),
        ...(closingDate ? { asOf: closingDate.slice(0, 10) } : {}),
      });
      if (experience && !experience.error) {
        const evidenceEval = evaluateEvidence({ rule, source: "tender_document", otherRules: evidenceRules.length - 1 }, experience.items, false);
        const { reviewStatus, checklistStatus } = docItemStatus(evidenceEval.status);
        pushChecklist({ title: "Experience evidence", envelope: "Supporting documents", status: checklistStatus, pages: null, note: evidenceEval.status === "have" ? null : evidenceEval.detail });
        items.push({
          key: "experience",
          label: "Qualifying experience",
          value: `${acceptedDocTypes(rule).size > 0 ? experience.items.filter((i) => acceptedDocTypes(rule).has(i.document_type)).length : experience.items.length} item(s)`,
          status: reviewStatus,
          note: evidenceEval.detail,
        });
      }
    }
    sections.push(section("experience", "Company experience evidence", "#general-people", "Confirm or change", items));
  } catch (err) {
    sections.push(failedSection("experience", "Company experience evidence", "#general-people", "Confirm or change", err));
  }

  // --- 5. Office location -----------------------------------------------------
  try {
    const rules = (tender.evaluation_rules as EvaluationRules | null) ?? null;
    const locRows = ((rules?.locality?.rows?.length ? rules.locality.rows : manifest.locality.rows) ?? []) as LocalityRow[];
    const mandatory = rules?.locality?.mandatory_local_office ?? manifest.locality.mandatory_local_office;
    const items: ReviewItem[] = [];
    if (locRows.length > 0 || mandatory) {
      const m = matchLocality(locRows.length > 0 ? locRows : mandatory ? [{ area: mandatory.area, level: "municipality", province: null, points: 0, system: null, kind: "specific_goals" }] : [], offices);
      const { reviewStatus, checklistStatus } = localityStatus({ matchStatus: m.status, mandatory: !!mandatory, disqualifies: !!mandatory?.disqualifies });
      pushChecklist({ title: "Office location", envelope: "Supporting documents", status: checklistStatus, pages: null, note: m.status === "matched" ? null : m.reason });
      items.push({ key: "locality", label: mandatory ? `Local office in ${mandatory.area}` : "Office location points", value: m.status === "matched" ? `${m.points ?? 0} pts` : null, status: reviewStatus, note: m.reason });
    }
    sections.push(section("locality", "Office location", "#general-people", "Confirm or change", items));
  } catch (err) {
    sections.push(failedSection("locality", "Office location", "#general-people", "Confirm or change", err));
  }

  const gapsCount = sections.reduce((n, s) => n + s.items.filter((i) => i.status === "missing" || i.status === "warning").length, 0);

  return { mapped: true, sections, checklist, gapsCount, reviewed };
});
