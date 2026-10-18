import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  SANRAL_CONVENTIONAL_FAMILY,
  checkMinimumRequirement,
  sanralConventionalDocumentChecks,
  COMPANY_VAULT_COLUMNS,
  beeProofValidAtClosing,
  qualitySystemFromVault,
  type CompanyVault,
  type PersonFacts,
} from "@/lib/tenderCompliance";
import { estimateSanralConventional, pastPerformanceFromExperience, type SanralProject } from "@/lib/sanralScoring";
import { expandDisciplines, loadDisciplineTaxonomy } from "@/lib/disciplineTaxonomy";
import { findMatchingExperience, isScoreableEvidence, type ExperienceItem } from "@/lib/experience";
import { chooseEvidenceRule, evaluateEvidence, type EvaluationRules } from "@/lib/experienceEvidence";
import { TENDER_ROLE_COLUMNS, roleCodeForPosition, roleFitCheck, type RoleTag, type TenderRole } from "@/lib/tenderRoles";
import { COMPANY_OFFICE_COLUMNS, type CompanyOffice } from "@/lib/locality";
import { CONDITIONAL_REGISTRATION_COLUMNS, loadHeldCatalogRegistrations } from "@/lib/personCredentials";

/**
 * The compliance report's data, loaded once per request (React cache()) and
 * shared by everything on the Tender Workspace that needs it: the report
 * itself (compliance-report.tsx) and the "Generate submission pack" card
 * (submission-pack.tsx), which gates on the same gaps the report shows
 * rather than re-deriving its own. Moved out of compliance-report.tsx
 * unchanged - same reads, same rules.
 */

type Requirement = { position_code: string; position_description: string | null; managerial: boolean; is_alternate: boolean };
type Assignment = { position_code: string; confirmed_person_id: string | null; suggested_person_id: string | null; specialism_warning: boolean };
type PersonRow = PersonFacts & { id: string };
type ProjectRow = SanralProject & { person_id: string };
type CvUpload = { person_id: string; mode: "as_is" | "ai_extract"; original_filename: string; created_at: string };
type GeneratedCvRow = { position_code: string | null; status: string };

export const loadTenderCompliance = cache(async (tenderId: string) => {
  const supabase = await createClient();

  const { data: tender } = await supabase.from("tenders").select("id, closing_date, family, evaluation_rules").eq("id", tenderId).maybeSingle();
  if (!tender) return null;
  const closingDate = (tender.closing_date as string | null) ?? null;
  const family = (tender.family as string | null) ?? null;
  // What THIS tender's own document says (migration 0016), extracted by
  // engine/discovery/score_outlook.py - null until it has been read.
  const evaluationRules = (tender.evaluation_rules as EvaluationRules | null) ?? null;

  if (family !== SANRAL_CONVENTIONAL_FAMILY) return { mapped: false as const, family };

  const [
    { data: company },
    { data: pack },
    { data: requirementRows },
    { data: financial },
    { data: briefing },
    { data: roleRows },
    { data: tagRows },
    { data: officeRows },
    { data: letterRows },
  ] = await Promise.all([
    supabase
      .from("companies")
      .select(COMPANY_VAULT_COLUMNS)
      .maybeSingle(),
    supabase.from("tender_packs").select("id").eq("tender_id", tenderId).maybeSingle(),
    supabase.from("tender_requirements").select("position_code, position_description, managerial, is_alternate").eq("tender_id", tenderId),
    supabase.from("financial_captures").select("status").eq("tender_id", tenderId).maybeSingle(),
    supabase.from("tender_tasks").select("status, due_date").eq("tender_id", tenderId).eq("kind", "briefing").maybeSingle(),
    // 0016: role catalog + the company's own "this CV fits role X" tags.
    supabase.from("tender_roles").select(TENDER_ROLE_COLUMNS).order("sort_order"),
    supabase.from("person_role_eligibility").select("person_id, role_code, notes"),
    // 0015: structured office locations for locality rows.
    supabase.from("company_offices").select(COMPANY_OFFICE_COLUMNS),
    // 0037: the company's own letter of authority (what the pack binds in as A2).
    supabase.from("company_document_templates").select("mode").eq("document_type", "authority_to_sign"),
  ]);
  const roles = (roleRows ?? []) as TenderRole[];
  const roleTags = (tagRows ?? []) as RoleTag[];
  const offices = (officeRows ?? []) as CompanyOffice[];

  const packId = (pack?.id as string | undefined) ?? null;
  let provenance: { field_key: string; status: string }[] = [];
  let assignments: Assignment[] = [];
  if (packId) {
    const [{ data: prov }, { data: asg }] = await Promise.all([
      supabase.from("field_provenance").select("field_key, status").eq("tender_pack_id", packId),
      supabase
        .from("tender_pack_assignments")
        .select("position_code, confirmed_person_id, suggested_person_id, specialism_warning")
        .eq("tender_pack_id", packId)
        .order("position_code", { ascending: true }),
    ]);
    provenance = (prov ?? []) as typeof provenance;
    assignments = (asg ?? []) as Assignment[];
  }

  const requirements = ((requirementRows ?? []) as Requirement[]).filter((r) => !r.is_alternate);
  // Positions: the tender's own requirement rows when seeded; otherwise the
  // pack's assignment rows (seed_supabase_company.py writes those from the
  // CLI pack, while tender_requirements isn't seeded by anything yet).
  const positionCodes = Array.from(new Set([...requirements.map((r) => r.position_code), ...assignments.map((a) => a.position_code)]));

  const personIds = Array.from(
    new Set([
      ...assignments.flatMap((a) => [a.confirmed_person_id, a.suggested_person_id]).filter((x): x is string => !!x),
      ...roleTags.map((t) => t.person_id), // people tagged for a role, to name them on unfilled positions
    ]),
  );
  let people: PersonRow[] = [];
  let projects: ProjectRow[] = [];
  let cvUploads: CvUpload[] = [];
  let generatedCvs: GeneratedCvRow[] = [];
  if (personIds.length > 0) {
    const [{ data: ppl }, { data: prj }, { data: cvs }, { data: gen }] = await Promise.all([
      // conditional registrations (0040 columns, 0050 catalog) are read only for a position whose requirement names the body
      supabase.from("people").select(`id, name, ecsa_level, ecsa_number, initial_graduated, sacpcmp_number, sacpcmp_expiry, ${CONDITIONAL_REGISTRATION_COLUMNS}` as const).in("id", personIds),
      supabase.from("projects").select("person_id, client_type, project_type, position_code, start_date, end_date").in("person_id", personIds),
      supabase.from("cv_uploads").select("person_id, mode, original_filename, created_at").in("person_id", personIds).order("created_at", { ascending: false }),
      supabase.from("generated_cvs").select("position_code, status").eq("tender_id", tenderId),
    ]);
    // 0050 catalog registrations (SACQSP, SACAP, ...) of the same people
    const held = await loadHeldCatalogRegistrations(supabase, personIds);
    people = ((ppl ?? []) as PersonRow[]).map((p) => ({ ...p, held: held.filter((h) => h.person_id === p.id) }));
    projects = (prj ?? []) as ProjectRow[];
    cvUploads = (cvs ?? []) as CvUpload[];
    generatedCvs = (gen ?? []) as GeneratedCvRow[];
  }

  // Company experience (Experience Library, migration 0012), checked against
  // THIS tender's own evidence rule (tenders.evaluation_rules) - or, only
  // when that hasn't been read, SANRAL's B6 pattern labelled as an
  // assumption (experienceEvidence.ts). "Similar scope" is read as the
  // disciplines of THIS tender's own key positions (tender_roles.discipline
  // of each SETUP position's role: a DS Electrical or DS Electronic Systems
  // position is electrical_mechanical, PL/CE/RE and the civil DS specialisms
  // roads_civil). Until 2026-10-17 it was fixed at roads_civil because all six
  // sample tenders were PL + DS Pavement; SANRAL also tenders consultancy
  // whose positions are electrical/ITS/structures. Falls back to roads_civil
  // (SANRAL is the roads agency) only when no position resolves to a role.
  // The disciplines used are shown in the UI.
  const experienceDisciplines = Array.from(
    new Set(
      positionCodes
        .map((code) => {
          const req = requirements.find((r) => r.position_code === code);
          const roleCode = roleCodeForPosition(code, req?.position_description ?? null);
          return roles.find((r) => r.code === roleCode)?.discipline ?? null;
        })
        .filter((d): d is string => !!d),
    ),
  );
  if (experienceDisciplines.length === 0) experienceDisciplines.push("roads_civil");
  const chosenRule = chooseEvidenceRule(evaluationRules);
  const keyPersonMinimums = evaluationRules?.key_person_minimums ?? null;
  const taxonomy = await loadDisciplineTaxonomy(supabase);
  const companyId = (company?.id as string | undefined) ?? null;
  const asOf = closingDate ? closingDate.slice(0, 10) : undefined;
  const experience = companyId
    ? await findMatchingExperience(supabase, companyId, {
        // a group stands for every discipline in it (0040): experience
        // tagged road_maintenance counts as roads_civil experience
        disciplines: expandDisciplines(taxonomy, experienceDisciplines),
        ...(chosenRule.rule.window_years ? { completedWithinYears: chosenRule.rule.window_years } : {}),
        asOf,
      })
    : { items: [] as ExperienceItem[], error: "No company record." };
  const experienceAvailable = experience.error === null;
  const expItems = experience.items;
  const experienceSummary = {
    qualifyingCount: expItems.length,
    scoreableCount: expItems.filter((i) => isScoreableEvidence(i.document_type)).length,
    ratedCount: expItems.filter((i) => isScoreableEvidence(i.document_type) && !!i.performance_rating).length,
  };

  const vault = (company as unknown as CompanyVault | null) ?? null;
  const qualitySystem = qualitySystemFromVault(vault, closingDate);
  const beeProofValid = beeProofValidAtClosing(vault, closingDate);
  const docItems = sanralConventionalDocumentChecks({
    company: vault,
    closingDate,
    provenance,
    hasPack: !!packId,
    financialCaptureStatus: (financial?.status as "draft" | "complete" | undefined) ?? null,
    briefingTask: (briefing as { status: string; due_date: string | null } | null) ?? null,
    experience: experienceSummary,
    experienceAvailable,
    evidence: experienceAvailable ? evaluateEvidence(chosenRule, expItems, true) : null,
    authorityLetter: ((letterRows ?? [])[0]?.mode as "uploaded" | "ai_guideline" | undefined) ?? null,
  });

  const personById = new Map(people.map((p) => [p.id, p]));
  const positionRows = positionCodes.map((code) => {
    const req = requirements.find((r) => r.position_code === code) ?? null;
    const asg = assignments.find((a) => a.position_code === code) ?? null;
    const person = asg?.confirmed_person_id ? personById.get(asg.confirmed_person_id) ?? null : null;
    const suggested = !person && asg?.suggested_person_id ? personById.get(asg.suggested_person_id) ?? null : null;
    // THIS tender's own C3.1.11 table when it has been read (audit Q5),
    // else R.396's table labelled as an assumption (tenderCompliance.ts).
    const min = checkMinimumRequirement(code, person, closingDate, req?.position_description ?? null, keyPersonMinimums);
    const cv = person ? cvUploads.find((c) => c.person_id === person.id) ?? null : null;
    const tenderCv = generatedCvs.find((g) => g.position_code === code) ?? null;
    const personProjects = person ? projects.filter((p) => p.person_id === person.id) : [];
    // Role fit comes from the company's own tag (0016); the C3.1.11
    // heuristic above is kept only as a cross-check (tenderRoles.ts).
    const fit = roleFitCheck({
      positionCode: code,
      description: req?.position_description ?? null,
      person: person ? { id: person.id, name: person.name } : null,
      tags: roleTags,
      roles,
      peopleById: personById,
      heuristic: person ? min : null,
    });
    return { code, req, asg, person, suggested, min, cv, tenderCv, personProjects, fit };
  });

  const estimate =
    closingDate && positionRows.length > 0
      ? estimateSanralConventional({
          closingDate,
          positions: positionRows.map((p) => ({
            positionCode: p.code,
            description: p.req?.position_description ?? null,
            managerial: p.req ? p.req.managerial : null,
            tenderProjectType: null, // SETUP row 9 isn't stored in the schema - see sanralScoring.ts
            person: p.person ? { name: p.person.name, projects: p.personProjects } : null,
          })),
          pastPerformance: experienceAvailable ? pastPerformanceFromExperience(expItems) : null,
          qualitySystem,
          threshold: evaluationRules?.functionality?.threshold ?? undefined,
        })
      : null;

  return {
    mapped: true as const,
    family,
    closingDate,
    evaluationRules,
    offices,
    company,
    docItems,
    positionRows,
    estimate,
    experience,
    expItems,
    experienceAvailable,
    experienceDisciplines,
    chosenRule,
    keyPersonMinimums,
    qualitySystem,
    beeProofValid,
  };
});

export type TenderComplianceData = NonNullable<Awaited<ReturnType<typeof loadTenderCompliance>>>;

/**
 * Blank SANRAL templates engine/pack/process_pack_jobs.py needs on file
 * (tender_documents.doc_type). financial_xlsm is optional: without it the
 * pack says so on its contents page instead of failing.
 */
export const PACK_REQUIRED_TEMPLATES = ["technical_xlsm", "a_forms", "c111_form_of_offer", "c123_contract_data"] as const;

/** What the submission-pack card shows and records with each request. */
export type PackReadiness = {
  checked: boolean; // false when this tender's family has no mapped returnable list
  mandatoryMissing: string[];
  missing: string[];
  toConfirm: string[];
  unfilledPositions: string[];
};

export function packReadiness(data: TenderComplianceData | null): PackReadiness {
  if (!data || !data.mapped) {
    return { checked: false, mandatoryMissing: [], missing: [], toConfirm: [], unfilledPositions: [] };
  }
  const label = (i: { form: string; label: string; expiredCopy?: boolean }) =>
    `${i.form} ${i.label}${i.expiredCopy ? " - expired copy on file: it goes in the pack with a warning, replace it before submitting" : ""}`;
  return {
    checked: true,
    mandatoryMissing: data.docItems.filter((i) => i.mandatory && i.status === "missing").map(label),
    missing: data.docItems.filter((i) => !i.mandatory && i.status === "missing").map(label),
    toConfirm: data.docItems.filter((i) => i.status === "check").map(label),
    unfilledPositions: data.positionRows.filter((p) => !p.person).map((p) => p.code),
  };
}
