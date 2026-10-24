import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RetryButton } from "./retry-button";
import { ReviewButton } from "./review-button";
import { TaskStatusButton } from "./task-status-button";
import { TaskAssigneeSelect, type AssignablePerson } from "./task-assignee-select";
import { ComplianceReport, type ComplianceReportSections } from "./compliance-report";
import { GeneralTenderWorkspace, type GeneralWorkspaceSections } from "./general-workspace";
import { WorkspaceTabs, TabBadge, type WorkspaceTab } from "./workspace-tabs";
import { Clock } from "lucide-react";
import BeePreferencePointsClient from "../../tools/bee-preference-points/BeePreferencePointsClient";
import { GENERAL_FAMILY } from "@/lib/generalTender";
import { SANRAL_CONVENTIONAL_FAMILY } from "@/lib/tenderCompliance";
import {
  requestTenderCv,
  addTenderTask,
  ensureBriefingMilestone,
  ensureClosingMilestone,
  setTenderReminder,
  syncWonProjectToTeam,
  type TenderTaskStatus,
} from "./actions";
import { AppShell } from "../../_components/AppShell";
import { SubmissionPack } from "./submission-pack";
import { CvCompare } from "./cv-compare";
import { CoverPagePreview } from "./cover-page-preview";
import { PackReview } from "./pack-review";
import { IntakeCard } from "./intake-card";
import { ActivityLog } from "./activity-log";
import { TenderUpdates } from "./tender-updates";
import { formatDay } from "@/lib/tenderUpdates";
import { MarketContext } from "./market-context";
import { ReusePastSubmission } from "./reuse-past-submission";
import { TenderTemplates } from "./tender-templates";
import { NarrativeDocuments } from "./narrative-documents";
import { SubcontractingPlan } from "./subcontracting-plan";
import { PositionPersonSelect } from "./position-person-select";
import { startTenderPack } from "./pack-inputs-actions";
import { roleCodeForPosition, type RoleTag } from "@/lib/tenderRoles";
import { suggestForPosition, type CandidateScore } from "@/lib/positionSuggestions";
import { loadPackReviewSnapshot } from "./pack-review-data";
import { loadGeneralPackReviewSnapshot } from "./general-pack-review-data";
import { formatDate } from "@/lib/dates";
import { formatZAR } from "@/lib/formatZAR";
import { computeTenderReadiness } from "./tender-readiness";
import { DisqualificationGuard } from "./disqualification-guard";
import { SubmissionPlanView } from "./submission-plan-view";
import { CollapsibleSection } from "./collapsible-section";
import { type SubmissionType, type DispatchStatus, printSignDeadline, operationalStatusMessage } from "@/lib/dispatchTriage";
import { SubmissionModeBadge } from "./submission-mode-badge";
import { SubmissionLogisticsForm } from "./submission-logistics-form";
import { DispatchStatusButton } from "@/components/tt/dispatch-status-button";
import { TenderDocumentsMenu } from "./tender-documents-menu";
import { TENDER_DOCS_BUCKET } from "@/lib/manualTender";

// Reads the signed-in user's session (via RLS) and per-tender data on every
// request - can't be prerendered. Same escape hatch as app/app/dashboard/page.tsx.
export const instant = false;

type TenderFacts = {
  id: string;
  contract_no: string | null;
  nra_reference: string | null;
  description: string | null;
  closing_date: string | null;
  briefing_date: string | null;
  briefing_time: string | null;
  family: string | null;
  source: string | null;
  buyer: string | null;
  // Document quick-access (Sarel's "Master Overhaul" brief, item 4,
  // 2026-10-24): document_urls is real, already-written data (Discovery's
  // own scrape, or manual intake) this page already read for the general
  // family's own extraction-status line - never actually linked anywhere
  // until now. owner_company_id decides whether tender_private_documents
  // (this company's own uploads) applies at all - same isShared check
  // general-workspace.tsx already makes.
  document_urls: { url: string | null; title: string | null }[] | null;
  owner_company_id: string | null;
};

type TenderPack = {
  id: string;
  status: string;
  // Pipeline board fields (0021/0034) and the Won-project facts (0065) -
  // read here only to surface "Submitted on ..." and the Won card, never to
  // move the stage itself (that stays /pipeline's own job, moveTenderStage).
  pipeline_stage: string;
  submitted_at: string | null;
  submitted_price_zar: number | string | null;
  project_completed_at: string | null;
  project_completion_value_rm: number | string | null;
  project_completion_note: string | null;
  // Submission logistics (migration 0090, Tender Command Center) - this
  // company's own plan for physically getting this pack to the tender box.
  submission_type: SubmissionType;
  delivery_location: string | null;
  estimated_print_hours: number;
  estimated_transit_hours: number;
  dispatch_status: DispatchStatus;
  courier_contact: string | null;
};

type ProvenanceRow = {
  field_key: string;
  status: "confirmed" | "computed" | "assumed_default" | "missing";
  value: string | null;
  reason: string | null;
};

type Assignment = {
  id: string;
  position_code: string;
  confirmed_person_id: string | null;
  suggested_person_id: string | null;
  // score_candidate() ranking from the pack builder (0031) - see app/lib/positionSuggestions.ts.
  candidate_scores: CandidateScore[] | null;
  // PostgREST embedding via the confirmed_person_id FK - see
  // 0001_init_schema.sql's tender_pack_assignments.confirmed_person_id
  // references people(id).
  people: { name: string } | null;
};

type TenderTask = {
  id: string;
  description: string;
  due_date: string | null;
  status: TenderTaskStatus;
  kind: string | null;
  is_standard: boolean;
  assigned_to: string | null;
  // PostgREST embedding via the assigned_to FK - see 0011_tender_task_assignee.sql's
  // tender_tasks.assigned_to references people(id).
  people: { name: string } | null;
};

type GeneratedCv = {
  id: string;
  position_code: string | null;
  person_id: string;
  format: string;
  detail: string;
  status: string;
  storage_path_docx: string | null;
  storage_path_pdf: string | null;
  error_message: string | null;
};

const GENERATED_CV_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  requested: { label: "Requested", className: "bg-warning/10 text-warning" },
  generating: { label: "Generating…", className: "bg-warning/10 text-warning" },
  ready: { label: "Ready", className: "bg-success/10 text-success" },
  failed: { label: "Failed", className: "bg-destructive/10 text-destructive" },
};

// tender_packs.status is a flat enum ('suggested' | 'confirmed' | 'filled') -
// there's no multi-stage workflow modeled in the schema, so this is an honest
// single badge rather than an invented stepper UI.
const PACK_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  suggested: { label: "Suggested - not yet confirmed", className: "bg-warning/10 text-warning" },
  confirmed: { label: "Confirmed", className: "bg-success/10 text-success" },
  filled: { label: "Filled", className: "bg-success/10 text-success" },
};

// Same labels as discovery/page.tsx's own local PRICING_MODEL_LABEL (for
// tender_scope_records.pricing_model) - this file doesn't share that one
// import since every other status/label map on this page is already its
// own small local copy, not a shared lib export.
const PRICING_MODEL_LABEL: Record<string, string> = {
  lump_sum: "Lump sum",
  schedule_of_rates: "Schedule of rates",
  boq_based: "Bill of quantities",
  cost_reimbursable: "Cost reimbursable",
  remeasurement: "Remeasurement",
  time_based: "Time-based",
};

// field_key is a dotted path like "a_forms.A8.litigation" or
// "financial_hours.Roadworks.A.PL" (see 0002_field_provenance.sql) - there's
// no display-name table, so this is a best-effort humanization: drop the
// owning-script prefix segment, underscore-split the rest, title-case it.
function humanizeFieldKey(fieldKey: string): string {
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

// Time-aware on purpose (unlike the date-only daysUntil): a tender closes at
// a stated hour. The old Math.ceil(ms / day) turned "closed 2 hours ago" into
// -0, which rendered as "0 days left" instead of "closed" (2026-10-17
// scenario pass), and "closes at 12:00 today" as "1 days left".
function closingCountdown(closingDate: string | null): { text: string; urgent: boolean } | null {
  if (!closingDate) return null;
  const ms = new Date(closingDate).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return { text: "closed", urgent: true };
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 24) return { text: hours < 1 ? "closes within the hour" : `closes in ${hours} hour${hours === 1 ? "" : "s"}`, urgent: true };
  const days = Math.floor(hours / 24);
  return { text: `${days} day${days === 1 ? "" : "s"} left`, urgent: days <= 7 };
}

export default async function TenderWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; activity?: string; reuse_from?: string; reused?: string }>;
}) {
  const { id } = await params;
  // Every action on this page (requestTenderCv, addTenderTask,
  // requestSubmissionPack) reports a refusal as ?error=... - shown at the top.
  const { error: actionError, saved, activity, reuse_from: reuseFrom, reused } = await searchParams;
  const supabase = await createClient();

  const { data: tender, error: tenderError } = await supabase
    .from("tenders")
    .select("id, contract_no, nra_reference, description, closing_date, briefing_date, briefing_time, family, source, buyer, document_urls, owner_company_id")
    .eq("id", id)
    .maybeSingle();

  if (!tender && !tenderError) {
    notFound();
  }

  if (tenderError) console.error("tenders select failed for tender", id, tenderError);

  const tenderFacts = tender as TenderFacts | null;

  // Tender task/deadline timeline (alongside the readiness report, not a
  // separate page - explicit build requirement). Auto-seed the one standard
  // milestone whose date is already known (closing_date) before reading the
  // list back, so it's never missing on first view. Independent of whether
  // a tender_pack exists yet - tasks ("line up a subcontractor", "ask the
  // client about a reference") are often relevant before a pack is created.
  let tasks: TenderTask[] = [];
  let tasksError: { message: string } | null = null;
  if (tenderFacts) {
    await ensureClosingMilestone(id, tenderFacts.closing_date);
    await ensureBriefingMilestone(id, tenderFacts.briefing_date, tenderFacts.briefing_time);
    const { data: taskRows, error } = await supabase
      .from("tender_tasks")
      .select("id, description, due_date, status, kind, is_standard, assigned_to, people:assigned_to(name)")
      .eq("tender_id", id)
      .order("due_date", { ascending: true, nullsFirst: false });
    tasks = (taskRows ?? []) as unknown as TenderTask[];
    tasksError = error ? { message: error.message } : null;
    if (error) console.error("tender_tasks select failed for tender", id, error);
  }

  // The company's own roster for the task-assignee dropdown (migration
  // 0011) - same table/page as "People / CV Library"
  // (app/app/people/page.tsx), reused as-is rather than inventing a second
  // team-members concept. RLS (people: tenant isolation) already scopes this
  // to the signed-in user's own company.
  const { data: assignablePeopleRows } = await supabase
    .from("people")
    .select("id, name")
    .order("name", { ascending: true });
  const assignablePeople = (assignablePeopleRows ?? []) as AssignablePerson[];

  // RLS scopes this to the signed-in user's own company - there's at most
  // one pack per (company, tender) per the unique constraint in
  // 0001_init_schema.sql, so .maybeSingle() is correct, not a shortcut.
  const { data: pack, error: packError } = await supabase
    .from("tender_packs")
    .select(
      "id, status, pipeline_stage, submitted_at, submitted_price_zar, project_completed_at, project_completion_value_rm, project_completion_note, submission_type, delivery_location, estimated_print_hours, estimated_transit_hours, dispatch_status, courier_contact",
    )
    .eq("tender_id", id)
    .maybeSingle();

  if (packError) console.error("tender_packs select failed for tender", id, packError);

  const tenderPack = pack as TenderPack | null;

  let provenance: ProvenanceRow[] = [];
  let provenanceError: { message: string } | null = null;
  if (tenderPack) {
    const { data: rows, error } = await supabase
      .from("field_provenance")
      .select("field_key, status, value, reason")
      .eq("tender_pack_id", tenderPack.id)
      .order("field_key", { ascending: true });
    provenance = (rows ?? []) as ProvenanceRow[];
    provenanceError = error ? { message: error.message } : null;
    if (error) console.error("field_provenance select failed for tender_pack", tenderPack.id, error);
  }

  const confirmedRows = provenance.filter((r) => r.status === "confirmed" || r.status === "computed");
  const reviewRows = provenance.filter((r) => r.status === "assumed_default");
  const missingRows = provenance.filter((r) => r.status === "missing");

  // Key positions + "Generate tender-specific CV" (integration point B,
  // Sarel's own direction 2026-10-16) - only meaningful once a pack exists.
  // Positions = the tender's own SETUP-sheet rows (tender_requirements, read
  // from the uploaded Technical workbook by engine/pack/process_pack_jobs.py)
  // plus any position the pack already has an assignment row for.
  let assignments: Assignment[] = [];
  let generatedCvs: GeneratedCv[] = [];
  let requirementRows: { position_code: string; position_description: string | null }[] = [];
  let roleTags: RoleTag[] = [];
  const roleTitles = new Map<string, string>();
  if (tenderPack) {
    const [{ data: reqRows }, { data: tagRows }, { data: roleRows }] = await Promise.all([
      supabase.from("tender_requirements").select("position_code, position_description").eq("tender_id", id).eq("is_alternate", false),
      supabase.from("person_role_eligibility").select("person_id, role_code, notes"),
      supabase.from("tender_roles").select("code, title"),
    ]);
    requirementRows = (reqRows ?? []) as typeof requirementRows;
    roleTags = (tagRows ?? []) as RoleTag[];
    for (const r of (roleRows ?? []) as { code: string; title: string }[]) roleTitles.set(r.code, r.title);

    const { data: assignmentRows } = await supabase
      .from("tender_pack_assignments")
      .select("id, position_code, confirmed_person_id, suggested_person_id, candidate_scores, people:confirmed_person_id(name)")
      .eq("tender_pack_id", tenderPack.id)
      .order("position_code", { ascending: true });
    assignments = (assignmentRows ?? []) as unknown as Assignment[];

    const { data: genRows } = await supabase
      .from("generated_cvs")
      .select("id, position_code, person_id, format, detail, status, storage_path_docx, storage_path_pdf, error_message")
      .eq("tender_id", id)
      .order("requested_at", { ascending: false });
    generatedCvs = (genRows ?? []) as GeneratedCv[];
  }

  const cvSignedUrls: Record<string, string> = {};
  const cvPaths = generatedCvs.flatMap((g) => [g.storage_path_docx, g.storage_path_pdf].filter((p): p is string => !!p));
  if (cvPaths.length > 0) {
    const results = await Promise.all(cvPaths.map((p) => supabase.storage.from("cv-documents").createSignedUrl(p, 600)));
    results.forEach((r, i) => {
      if (r.data?.signedUrl) cvSignedUrls[cvPaths[i]] = r.data.signedUrl;
    });
  }

  const positions = Array.from(
    new Set([...requirementRows.map((r) => r.position_code), ...assignments.map((a) => a.position_code)]),
  ).sort();
  const peopleName = new Map(assignablePeople.map((p) => [p.id, p.name]));
  // Hoisted so both the sticky summary header and the Key positions section
  // itself (further down) can use the same count without computing it twice.
  const openPositionsCount = positions.filter((code) => !assignments.find((a) => a.position_code === code)?.confirmed_person_id).length;

  const countdown = closingCountdown(tenderFacts?.closing_date ?? null);
  const packStatus = tenderPack ? PACK_STATUS_LABEL[tenderPack.status] : null;

  // Phase 2 brief (Part 4): "Value Estimate / Range (if available)" on the
  // header's Key Metadata Bar, plus the fuller "Scope & pricing" card in the
  // Pricing & Market tab (Phase 2 completion pass). tender_scope_records
  // (migration 0060, engine/discovery/tender_enrichment.py - see
  // discovery/page.tsx's own SCOPE_RECORD_COLUMNS comment) is honestly rare
  // today: that enrichment script isn't wired into the production fan-out,
  // so these columns are null for almost every tender. Shown only when this
  // tender genuinely has a value - never a fabricated number.
  type ScopeRecordDetail = { scope_summary: string | null; pricing_model: string | null; value_band: string | null; confidence: string | null };
  const { data: scopeRecord } = tenderFacts
    ? await supabase.from("tender_scope_records").select("scope_summary, pricing_model, value_band, confidence").eq("tender_id", id).maybeSingle()
    : { data: null };
  const scopeRecordDetail = scopeRecord as ScopeRecordDetail | null;
  const valueEstimate = scopeRecordDetail?.value_band ?? null;
  // Drives the at-a-glance summary chips on the facts card, so "are we ready
  // to submit" is answerable without scrolling past Tasks & Key positions.
  const overdueTaskCount = tasks.filter((t) => {
    const taskLeft = taskDaysLeft(t.due_date);
    return taskLeft !== null && taskLeft < 0 && t.status !== "done";
  }).length;
  // Drives which jump-nav links are shown: ComplianceReport only renders its
  // document/people/experience/score sections for this one family - every
  // other family gets a single "not mapped yet" card with nothing to jump to.
  const isSanralFamily = tenderFacts?.family === SANRAL_CONVENTIONAL_FAMILY;
  // The submission pack runs the SANRAL fill engines, which handle both SANRAL
  // template families (engine/pack/assemble_pack.py FILLERS) - not other buyers.
  const isSanralPackFamily = isSanralFamily || tenderFacts?.family === "RRM Consultant Tender";
  const showSubmissionPack = !!tenderPack && isSanralPackFamily;
  // Non-SANRAL tenders (pursued from Discovery, migration 0018) get the
  // general preparation flow instead of the SANRAL compliance report.
  const isGeneralFamily = tenderFacts?.family === GENERAL_FAMILY;

  // Document quick-access (Sarel's "Master Overhaul" brief, item 4,
  // 2026-10-24): real data, surfaced for the first time - see the
  // TenderFacts.document_urls comment above for why. Private documents only
  // apply to a shared tender (owner_company_id null, same isShared check
  // general-workspace.tsx already makes) - a company-owned manual tender has
  // no "other companies" to keep anything private from.
  const docUrls = ((tenderFacts?.document_urls ?? []).filter((d) => d.url) as { url: string; title: string | null }[]) ?? [];
  const isSharedTender = !!tenderFacts && !tenderFacts.owner_company_id;
  let privateDocEntries: { id: string; title: string; href: string | null }[] = [];
  if (isSharedTender) {
    const { data: privateRows, error: privateDocsError } = await supabase
      .from("tender_private_documents")
      .select("id, title, storage_path")
      .eq("tender_id", id)
      .order("created_at");
    if (privateDocsError) console.error("tender_private_documents select failed for tender", id, privateDocsError);
    const rows = (privateRows ?? []) as { id: string; title: string; storage_path: string }[];
    if (rows.length > 0) {
      const signedResults = await Promise.all(rows.map((r) => supabase.storage.from(TENDER_DOCS_BUCKET).createSignedUrl(r.storage_path, 600)));
      privateDocEntries = rows.map((r, i) => ({ id: r.id, title: r.title, href: signedResults[i].data?.signedUrl ?? null }));
    }
  }
  // The upload entry point only has somewhere real to go on a general-family
  // shared tender - private-documents.tsx's own card (#private-documents,
  // rendered inside general-workspace.tsx's Overview content) is the only
  // place that form exists today. Never link to a destination that isn't
  // actually there.
  const privateDocsUploadHref = isSharedTender && isGeneralFamily ? "#private-documents" : null;

  // Per-tender readiness (Product promise's Verify/Provide/Fix, app/AGENTS.md)
  // - reuses the exact same Pack Review snapshot the card further down the
  // page already reads (loadPackReviewSnapshot/loadGeneralPackReviewSnapshot
  // are both React cache()'d, so this doesn't cost a second read), so the
  // header's score can never disagree with the detailed list below it. null
  // (not a fake 100%) when there's no pack yet or this family's returnables
  // list hasn't been mapped - nothing real to assess yet, not "nothing left".
  let tenderReadiness: ReturnType<typeof computeTenderReadiness> | null = null;
  if (tenderPack && isSanralFamily) {
    const snapshot = await loadPackReviewSnapshot(id);
    if (snapshot.mapped) tenderReadiness = computeTenderReadiness(snapshot.sections);
  } else if (tenderPack && isGeneralFamily) {
    const snapshot = await loadGeneralPackReviewSnapshot(id);
    if (snapshot.mapped) tenderReadiness = computeTenderReadiness(snapshot.sections);
  }

  // Tender Command Center (Sarel's own brief, 2026-10-24): "the system speaks
  // to you" in the workspace header too, reusing tenderReadiness/
  // openPositionsCount - both already computed above for the facts card and
  // the primary-action disabled reason - rather than calling nextStepFor()
  // again for a second summary that could disagree with the first.
  const blockingSummary =
    tenderReadiness && tenderReadiness.thingsLeft > 0
      ? `${tenderReadiness.thingsLeft} thing${tenderReadiness.thingsLeft === 1 ? "" : "s"} left before you can submit`
      : openPositionsCount > 0
        ? `${openPositionsCount} key position${openPositionsCount === 1 ? "" : "s"} still need${openPositionsCount === 1 ? "s" : ""} confirming`
        : null;
  const dispatchLogistics =
    tenderPack && !["submitted", "won", "lost"].includes(tenderPack.pipeline_stage)
      ? {
          closingDate: tenderFacts?.closing_date ?? null,
          submissionType: tenderPack.submission_type,
          estimatedPrintHours: tenderPack.estimated_print_hours,
          estimatedTransitHours: tenderPack.estimated_transit_hours,
          dispatchStatus: tenderPack.dispatch_status,
        }
      : null;
  const printDeadline = dispatchLogistics ? printSignDeadline(dispatchLogistics) : null;
  const operationalMessage = dispatchLogistics ? operationalStatusMessage(dispatchLogistics, blockingSummary) : null;

  // Section-level error recovery: each of these is a self-contained async
  // Server "component" doing its own several-query Supabase read - calling
  // it directly (an async function component is just an async function; the
  // JSX form `<Foo/>` is sugar for the same call) rather than through JSX
  // lets a real try/catch wrap it, so one bad read degrades to a friendly
  // ErrorBanner (with a working Retry, same as every other error on this
  // page) for that section only, instead of throwing and 500-ing the whole
  // tender workspace. Every other read on this page already returns
  // {data, error} pairs and degrades to []/null without throwing - this is
  // only for the handful of larger child components that could rethrow.
  let disqualificationGuardSection: React.ReactNode = null;
  let disqualificationGuardFixCount = 0;
  if (isSanralFamily || isGeneralFamily) {
    try {
      const guard = await DisqualificationGuard({ tenderId: id, isSanralFamily, isGeneralFamily });
      disqualificationGuardSection = guard.content;
      disqualificationGuardFixCount = guard.fixCount;
    } catch (err) {
      console.error("DisqualificationGuard failed to render for tender", id, err);
      disqualificationGuardSection = <ErrorBanner message="Couldn't load the Disqualification guard. If it keeps happening, let us know." />;
    }
  }

  // Phase 2 retab (2026-10-23): both of these now return a plain object of
  // named sections (one per returned key) instead of one bundled JSX tree,
  // so the 5 top-level tabs below can place each section where it belongs
  // - no change to either component's own reads or logic, only its return
  // shape (see each file's own header comment). On a read failure, the same
  // error banner is reused across every tab slot that section would have
  // filled - an honest "this failed" in each place, not a silent gap.
  let generalSections: GeneralWorkspaceSections | null = null;
  let complianceSections: ComplianceReportSections | null = null;
  let complianceError: React.ReactNode = null;
  try {
    if (isGeneralFamily) {
      generalSections = await GeneralTenderWorkspace({ tenderId: id, saved: saved ?? null });
    } else if (tenderFacts?.family) {
      complianceSections = await ComplianceReport({ tenderId: id });
    }
  } catch (err) {
    console.error("Compliance/pack check failed to render for tender", id, err);
    complianceError = <ErrorBanner message="Couldn't load the compliance check. If it keeps happening, let us know." />;
  }

  let packReviewSection: React.ReactNode = null;
  if (showSubmissionPack && tenderPack) {
    try {
      packReviewSection = await PackReview({ tenderId: id });
    } catch (err) {
      console.error("PackReview failed to render for tender", id, err);
      packReviewSection = <ErrorBanner message="Couldn't load Pack review. If it keeps happening, let us know." />;
    }
  }

  let submissionPackSection: React.ReactNode = null;
  if (showSubmissionPack && tenderPack) {
    try {
      submissionPackSection = await SubmissionPack({ tenderId: id, tenderPackId: tenderPack.id });
    } catch (err) {
      console.error("SubmissionPack failed to render for tender", id, err);
      submissionPackSection = <ErrorBanner message="Couldn't load the submission pack. If it keeps happening, let us know." />;
    }
  }

  // Cover letter / methodology generator (0085): applies to any tender,
  // SANRAL or general, not gated on a confirmed tender pack - unlike the
  // sections above, all it needs is company_id + tender_id.
  let narrativeDocumentsSection: React.ReactNode = null;
  try {
    narrativeDocumentsSection = await NarrativeDocuments({ tenderId: id });
  } catch (err) {
    console.error("NarrativeDocuments failed to render for tender", id, err);
    narrativeDocumentsSection = (
      <ErrorBanner message="Couldn't load the cover letter / methodology generator. If it keeps happening, let us know." />
    );
  }

  return (
    <AppShell>
      <div style={{ flex: 1, padding: "20px 16px", maxWidth: 820, width: "100%", margin: "0 auto", boxSizing: "border-box", fontFamily: "system-ui, sans-serif" }}>
        {actionError && <ErrorBanner message={actionError} />}

        {tenderError && (
          <ErrorBanner message="Couldn't load this tender. If it keeps happening, let us know." />
        )}

        {!tenderFacts && !tenderError && (
          <ErrorBanner message="This tender could not be found." />
        )}

        {tenderFacts && (
          <>
            {/* Phase 2 sticky header banner (2026-10-23): breadcrumb, status
                badge and a single primary action, all built from data this
                page already computes (countdown, tenderReadiness, packStatus,
                openPositionsCount) - no new reads, so the banner can never
                disagree with the detailed sections below it. Deliberately
                NOT a rewrite of the page's own body into new tabs: this file
                already has an explicit, hard-won rule (see WorkspaceTabs'
                own docstring, general-workspace.tsx) that a blocker is never
                buried in a hidden tab - retabbing everything below risks
                breaking that rule, or the disqualification-guard/compliance/
                pack-review sections themselves, with no review gate before
                this ships. The banner is additive and safe; the body stays
                as the same sections, same order, same logic, as before. */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
                <a href="/pipeline" className="text-muted-foreground no-underline hover:text-foreground hover:underline">
                  Pipeline
                </a>
                {" / "}
                <a href="/dashboard" className="text-muted-foreground no-underline hover:text-foreground hover:underline">
                  Tenders
                </a>
                {" / "}
                <span className="text-foreground">{tenderFacts.contract_no ?? tenderFacts.nra_reference ?? "This tender"}</span>
              </nav>
              <TenderDocumentsMenu docUrls={docUrls} privateDocs={privateDocEntries} uploadHref={privateDocsUploadHref} />
            </div>

            {/* Tender facts */}
            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{tenderFacts.contract_no ?? "No contract number"}</div>
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{tenderFacts.nra_reference ?? "No NRA reference"}</div>
                </div>
                <WorkspaceStatusBadge tenderPack={tenderPack} tenderReadiness={tenderReadiness} packStatus={packStatus} />
              </div>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--foreground)", margin: "0 0 2px", lineHeight: 1.35 }}>
                {tenderFacts.description ?? "Untitled tender"}
              </h1>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 8 }}>
                {tenderFacts.buyer ?? "No client on file"}
              </div>
              <div style={{ fontSize: 13, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>
                  Closes{" "}
                  {tenderFacts.closing_date ? (formatDate(tenderFacts.closing_date) ?? "—") : "- no closing date on file"}
                </span>
                {/* Phase 2 brief (Part 4): "Closing Countdown: Badge with
                    clock icon displaying exact remaining time." */}
                {countdown && (
                  <span
                    className={countdown.urgent ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 100, padding: "2px 9px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}
                  >
                    <Clock style={{ width: 11, height: 11 }} />
                    {countdown.text}
                  </span>
                )}
                {valueEstimate && (
                  <span
                    title="Estimated value range - a size indicator, not a price to bid (see the Pricing & Market tab)"
                    className="bg-muted text-muted-foreground"
                    style={{ display: "inline-flex", alignItems: "center", borderRadius: 100, padding: "2px 9px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}
                  >
                    Est. value: {valueEstimate}
                  </span>
                )}
              </div>
              {tenderReadiness && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                  <span
                    className={
                      tenderReadiness.thingsLeft === 0
                        ? "bg-success/10 text-success"
                        : tenderReadiness.fix.length > 0
                          ? "bg-destructive/10 text-destructive"
                          : "bg-warning/10 text-warning"
                    }
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 38,
                      height: 38,
                      flex: "0 0 auto",
                      borderRadius: "50%",
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    {tenderReadiness.score}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
                      {tenderReadiness.thingsLeft === 0
                        ? "Ready to submit"
                        : `${tenderReadiness.thingsLeft} thing${tenderReadiness.thingsLeft === 1 ? "" : "s"} left before you can submit`}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Readiness score</div>
                  </div>
                </div>
              )}
              {tenderFacts.briefing_date && (
                <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 2 }}>
                  Briefing {formatDay(tenderFacts.briefing_date)}
                  {tenderFacts.briefing_time ? ` at ${tenderFacts.briefing_time}` : ""}
                  <span style={{ color: "var(--muted-foreground)" }}> - from the buyer&apos;s addendum (see below)</span>
                </div>
              )}

              {/* Tender Command Center (Sarel's own brief, 2026-10-24):
                  the submission-mode badge, always visible (never
                  hover-only - see PR #131's own fix for why), with the
                  print/transit math it's built from right there under it. */}
              {dispatchLogistics && (
                <SubmissionModeBadge
                  submissionType={dispatchLogistics.submissionType}
                  closingDate={dispatchLogistics.closingDate}
                  estimatedPrintHours={dispatchLogistics.estimatedPrintHours}
                  estimatedTransitHours={dispatchLogistics.estimatedTransitHours}
                  printDeadline={printDeadline}
                  operationalMessage={operationalMessage}
                />
              )}

              {/* The actual record of submission (0021's trigger stamps this
                  the moment pipeline_stage first reaches submitted/won/lost)
                  - separate from the submission-deadline reminder below,
                  which is "remind us before it's due". */}
              {tenderPack && ["submitted", "won", "lost"].includes(tenderPack.pipeline_stage) && tenderPack.submitted_at && (
                <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 600, marginTop: 6 }}>
                  Submitted on {(formatDate(tenderPack.submitted_at) ?? "—")}
                </div>
              )}

              {tenderPack && provenance.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                  {confirmedRows.length > 0 && (
                    <SummaryChip count={confirmedRows.length} label="confirmed" className="bg-success/10 text-success" />
                  )}
                  {reviewRows.length > 0 && (
                    <SummaryChip count={reviewRows.length} label="to verify" className="bg-success/10 text-success" />
                  )}
                  {missingRows.length > 0 && (
                    <SummaryChip count={missingRows.length} label="to provide" className="bg-warning/10 text-warning" />
                  )}
                  {overdueTaskCount > 0 && (
                    <SummaryChip count={overdueTaskCount} label={overdueTaskCount === 1 ? "task overdue" : "tasks overdue"} className="bg-destructive/10 text-destructive" />
                  )}
                </div>
              )}

              {/* Primary action (Phase 2 brief): takes you to the real
                  generate-pack control that already exists further down this
                  page (SubmissionPack for SANRAL, GeneralTenderWorkspace's
                  own pack section for general) rather than a second, new
                  mutation path - one real "generate" action per tender, not
                  two that could disagree. Disabled (with why) until there is
                  a pack to generate from and nothing still blocking it. */}
              {(showSubmissionPack || isGeneralFamily) && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                  <PrimaryPackActionLink
                    href={showSubmissionPack ? "#submission-pack" : "#general-pack"}
                    ready={!!tenderPack && (!tenderReadiness || tenderReadiness.thingsLeft === 0) && openPositionsCount === 0}
                    disabledReason={
                      !tenderPack
                        ? "Start a tender pack first (below) before a submission pack can be generated."
                        : openPositionsCount > 0
                          ? `${openPositionsCount} key position${openPositionsCount === 1 ? "" : "s"} still need${openPositionsCount === 1 ? "s" : ""} confirming before the pack can be generated.`
                          : tenderReadiness && tenderReadiness.thingsLeft > 0
                            ? `${tenderReadiness.thingsLeft} readiness item${tenderReadiness.thingsLeft === 1 ? "" : "s"} still need confirming first.`
                            : null
                    }
                  />
                </div>
              )}
            </div>

            {/* Addenda, changed dates and other documents the buyer added after
                discovery (0039) - straight under the facts, since a moved
                closing date changes everything below it. Nothing when none. */}
            <TenderUpdates tenderId={id} />

            {/* Disqualification guard moved into the Overview tab below
                (Sarel's own follow-up brief, 2026-10-23: "Overview
                (Default): ... and Disqualification Guard"). This is a
                deliberate, explicit override of this file's own prior rule
                (spec v3 §16.E: "Do not bury blockers in a hidden tab") - kept
                visible from every OTHER tab instead via the Overview tab's
                own fix-count badge (disqualificationGuardFixCount, below),
                not by position, and Overview is the tab a visitor lands on
                by default. */}

            {packError && <ErrorBanner message="Couldn't load this tender's pack. If it keeps happening, let us know." />}

            {!tenderPack && !packError && (
              <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", fontSize: 13, color: "var(--muted-foreground)", marginBottom: 16 }}>
                No tender pack exists yet for this tender at your company - nothing to review until one is created.
                {/* UX audit re-review 2026-10-23, item 5: this button used to be
                    gated to isSanralPackFamily only, so a general (non-SANRAL)
                    tender showed this same "nothing to review" text with no way
                    to act on it at all - confirmed live. startTenderPack() itself
                    has no SANRAL-specific logic (just an upsert of company_id +
                    tender_id), and the general pack-generation flow
                    (general-workspace.tsx's own #general-pack section) doesn't
                    depend on this row existing, but the readiness report, key
                    positions and chips above all do - general tenders need this
                    button exactly as much as SANRAL ones do. */}
                {(isSanralPackFamily || isGeneralFamily) && (
                  <form action={startTenderPack} style={{ marginTop: 12 }}>
                    <input type="hidden" name="tender_id" value={id} />
                    <button
                      type="submit"
                      style={{ minHeight: 40, padding: "0 16px", borderRadius: 8, background: "var(--primary)", color: "var(--primary-foreground)", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}
                    >
                      Start a pack for this tender
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* Phase 2 retab, then completion pass (2026-10-23): the long flat
                stack that used to be here - disqualification guard,
                readiness report, intake, compliance/general workspace,
                market context, tasks, key positions, cover page, templates,
                Form B7, pack review/export, cover letter - is now 5
                top-level tabs (Overview / Compliance & Guard / Pack
                compiler / Team & CVs / Pricing & Market), built from these
                exact same section values (nothing re-read, nothing
                re-computed) and handed to the already-existing
                WorkspaceTabs. The Disqualification guard moved inside the
                Compliance & Guard tab per Sarel's own explicit brief - a
                deliberate override of this file's own earlier "never bury a
                blocker" rule, kept honest via that tab's own fix-count badge
                (visible from every other tab, not just by position) rather
                than by position alone. This "no pack yet" banner above
                stays outside the tabs; Activity/notes stays outside below
                the tabs, since a comment history belongs in view regardless
                of which tab is open, not hidden behind a click. */}
            {(() => {
              const readinessReportSection = tenderPack ? (
                <>
                  {provenanceError && <ErrorBanner message="Couldn't load the readiness report. If it keeps happening, let us know." />}

                  {provenance.length === 0 && !provenanceError && (
                    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", fontSize: 13, color: "var(--muted-foreground)" }}>
                      No readiness data recorded yet for this pack.
                    </div>
                  )}

                  {provenance.length > 0 && (() => {
                    // Spec v3 Batch 5: once there's nothing left to review or
                    // provide, this grid is just a read-only list of already-
                    // confirmed facts - a safe collapse-by-default candidate.
                    // Any review/missing row (real work to do) keeps it open,
                    // same rule as Key positions below.
                    const grid = (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
                        <ReportCard
                        title="Verify"
                        count={confirmedRows.length + reviewRows.length}
                        className="bg-success/10 text-success"
                        emptyText="Nothing to verify yet."
                      >
                        {reviewRows.map((row) => (
                          <div key={row.field_key} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>{humanizeFieldKey(row.field_key)}</div>
                              <ReviewButton fieldKey={row.field_key} />
                            </div>
                            <div style={{ fontSize: 12, color: "var(--muted-foreground)", wordBreak: "break-word", marginTop: 2 }}>{row.value ?? "-"}</div>
                            {row.reason && (
                              <div style={{ fontSize: 11, color: "var(--warning)", marginTop: 3 }}>{row.reason}</div>
                            )}
                          </div>
                        ))}
                        {confirmedRows.map((row) => (
                          <div key={row.field_key} style={{ padding: "9px 0", borderTop: "1px solid var(--border)" }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>{humanizeFieldKey(row.field_key)}</div>
                            <div style={{ fontSize: 12, color: "var(--muted-foreground)", wordBreak: "break-word" }}>{row.value ?? "-"}</div>
                          </div>
                        ))}
                      </ReportCard>

                      <ReportCard
                        title="Provide"
                        count={missingRows.length}
                        className="bg-warning/10 text-warning"
                        emptyText="Nothing left for you to supply."
                      >
                        {missingRows.map((row) => (
                          <div key={row.field_key} style={{ padding: "9px 0", borderTop: "1px solid var(--border)" }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>{humanizeFieldKey(row.field_key)}</div>
                            {row.reason && (
                              <div style={{ fontSize: 12, color: "var(--warning)", marginTop: 2 }}>{row.reason}</div>
                            )}
                          </div>
                        ))}
                        </ReportCard>
                      </div>
                    );
                    const nothingOutstanding = missingRows.length === 0 && reviewRows.length === 0;
                    return nothingOutstanding ? (
                      <CollapsibleSection id="readiness-report" title="Readiness report" defaultOpen={false} closedSummary="All confirmed">
                        {grid}
                      </CollapsibleSection>
                    ) : (
                      <div id="readiness-report" style={{ marginBottom: 16 }}>
                        {grid}
                      </div>
                    );
                  })()}
                </>
              ) : null;

              const keyPositionsSection = tenderPack && (positions.length > 0 || isSanralPackFamily) ? (() => {
                // Spec v3 Batch 5 (§16.E/§29): "Completed groups can compact;
                // blockers remain discoverable." An unconfirmed position is
                // literally rendered as a red "Fix: no key person confirmed"
                // badge below - a real blocker, so this section only collapses
                // once there are none left. Same list/content either way;
                // only the outer wrapper and whether it starts open differ.
                const allConfirmed = positions.length > 0 && openPositionsCount === 0;
                const header = (
                  <>
                    {!allConfirmed && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 2 }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)" }}>Key positions</div>
                        {positions.length > 0 && (
                          <span className="bg-warning/10 text-warning" style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
                            {openPositionsCount} of {positions.length} to confirm
                          </span>
                        )}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 12 }}>
                      Choose who fills each position on this tender - the submission pack is built with exactly these
                      people and won&apos;t generate until every position has one. Tender Ready suggests the best match among
                      the people tagged on their People page as fitting the role (scored on their qualifications, projects
                      and years against the position), with up to two alternatives - confirm it, or pick anyone else from the
                      list. Once confirmed, you can request the tender-customized CV
                      (requirement-matching cover page); our AI generates this in the background, so your customized CV
                      will be ready for review within a few minutes.
                    </div>
                  </>
                );
                const body = (
                  <>
                  {positions.length === 0 && (
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)", borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                      No positions listed yet. They are read from this tender&apos;s own Technical Submission workbook (its
                      SETUP sheet) - upload it under Blank tender templates (Compliance & Guard tab) below, and they appear
                      here once the pack builder has read it.
                    </div>
                  )}
                  {assignablePeople.length === 0 && positions.length > 0 && (
                    <div style={{ fontSize: 12, color: "var(--warning)", marginBottom: 8 }}>
                      No one is captured on the People page yet - add your key people there first.
                    </div>
                  )}
                  {positions.map((code) => {
                    const a = assignments.find((x) => x.position_code === code) ?? null;
                    const req = requirementRows.find((r) => r.position_code === code) ?? null;
                    const roleCode = roleCodeForPosition(code, req?.position_description ?? null);
                    const taggedIds = new Set(roleCode ? roleTags.filter((t) => t.role_code === roleCode).map((t) => t.person_id) : []);
                    const tagged = assignablePeople.filter((p) => taggedIds.has(p.id));
                    const others = assignablePeople.filter((p) => !taggedIds.has(p.id));
                    const confirmedId = a?.confirmed_person_id ?? null;
                    const sugg = suggestForPosition({
                      positionCode: code,
                      description: req?.position_description ?? null,
                      candidateScores: a?.candidate_scores ?? null,
                      tags: roleTags,
                      peopleIds: new Set(assignablePeople.map((p) => p.id)),
                    });
                    const positionJobs = generatedCvs.filter((g) => g.position_code === code);
                    return (
                      <div key={code} style={{ borderTop: "1px solid var(--border)", padding: "12px 0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{code}</div>
                            {req?.position_description && (
                              <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 1 }}>{req.position_description}</div>
                            )}
                            {confirmedId ? (
                              <div style={{ fontSize: 12, color: "var(--success)", marginTop: 2, fontWeight: 600 }}>
                                Confirmed: {a?.people?.name ?? peopleName.get(confirmedId) ?? "person on file"}
                              </div>
                            ) : (
                              <div className="bg-destructive/10 text-destructive" style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 100, padding: "3px 10px", fontSize: 11, fontWeight: 700, marginTop: 4 }}>
                                Fix: no key person confirmed - blocks the submission pack
                              </div>
                            )}
                            {!confirmedId && roleCode && tagged.length === 0 && (
                              <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>
                                No one is tagged as fitting {roleTitles.get(roleCode) ?? code} yet (People page).
                              </div>
                            )}
                          </div>
                          <PositionPersonSelect
                            tenderId={id}
                            tenderPackId={tenderPack.id}
                            positionCode={code}
                            confirmedPersonId={confirmedId}
                            tagged={tagged}
                            others={others}
                            roleTitle={roleCode ? roleTitles.get(roleCode) ?? null : null}
                            suggestions={sugg}
                          />
                        </div>
                        {confirmedId && (
                          <div style={{ marginTop: 8 }}>
                            <form action={requestTenderCv} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              <input type="hidden" name="tender_id" value={id} />
                              <input type="hidden" name="tender_pack_id" value={tenderPack.id} />
                              <input type="hidden" name="position_code" value={code} />
                              <input type="hidden" name="person_id" value={confirmedId} />
                              <select name="format" defaultValue="sanral_keyperson" style={{ minHeight: 36, borderRadius: 7, border: "1px solid var(--border)", fontSize: 12, padding: "0 8px" }}>
                                <option value="sanral_keyperson">SANRAL key-person</option>
                                <option value="world_bank">World Bank format</option>
                              </select>
                              <select name="detail" defaultValue="summary" style={{ minHeight: 36, borderRadius: 7, border: "1px solid var(--border)", fontSize: 12, padding: "0 8px" }}>
                                <option value="summary">Summary</option>
                                <option value="detailed">Detailed</option>
                              </select>
                              <button
                                type="submit"
                                style={{ minHeight: 36, padding: "0 14px", borderRadius: 8, background: "var(--primary)", color: "var(--primary-foreground)", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
                              >
                                Generate tender-specific CV
                              </button>
                            </form>
                            <CvCompare tenderId={id} positionCode={code} personId={confirmedId} />
                          </div>
                        )}
                        {positionJobs.length > 0 && (
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                            {positionJobs.map((g) => {
                              const st = GENERATED_CV_STATUS_LABEL[g.status] ?? { label: g.status, className: "bg-muted text-muted-foreground" };
                              return (
                                <div key={g.id} style={{ fontSize: 11, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 8 }}>
                                  <span>{g.format} / {g.detail}</span>
                                  <span className={st.className} style={{ display: "inline-flex", padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 600 }}>
                                    {st.label}
                                  </span>
                                  {g.error_message && <span style={{ color: "var(--destructive)" }}>{g.error_message}</span>}
                                  {g.storage_path_docx && cvSignedUrls[g.storage_path_docx] && (
                                    <a href={cvSignedUrls[g.storage_path_docx]} style={{ color: "var(--accent)", fontWeight: 600 }}>Word</a>
                                  )}
                                  {g.storage_path_pdf && cvSignedUrls[g.storage_path_pdf] && (
                                    <a href={cvSignedUrls[g.storage_path_pdf]} style={{ color: "var(--accent)", fontWeight: 600 }}>PDF</a>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </>
                );
                return allConfirmed ? (
                  <CollapsibleSection id="key-positions" title="Key positions" defaultOpen={false} closedSummary={`All ${positions.length} confirmed`}>
                    {header}
                    {body}
                  </CollapsibleSection>
                ) : (
                  <div id="key-positions" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
                    {header}
                    {body}
                  </div>
                );
              })() : null;

              // Honest per-tab "still outstanding" badges, from exactly the
              // same counts the facts card above already uses - never a
              // second, independently-computed number that could disagree.
              const formsBadgeCount = missingRows.length + (generalSections?.badges.docsMissing ?? 0) + (generalSections?.badges.needAnswer ?? 0);
              const complianceGuardBadgeCount = disqualificationGuardFixCount + formsBadgeCount;
              const teamBadgeCount = openPositionsCount + (generalSections?.badges.peopleGaps ?? 0);

              // Condensed title/status/countdown recap, sticky above the tab
              // bar itself (Sarel's own follow-up brief, 2026-10-23: "Keep
              // the contract title, closing badge, and status header sticky
              // at the top above the tabs") - same values the facts card
              // above already computes, never a second read.
              const miniHeader = (
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-1.5">
                  <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                    <span className="truncate text-[13px] font-bold text-foreground">
                      {tenderFacts.contract_no ?? tenderFacts.description ?? "Untitled tender"}
                    </span>
                    <WorkspaceStatusBadge tenderPack={tenderPack} tenderReadiness={tenderReadiness} packStatus={packStatus} />
                  </div>
                  {countdown && (
                    <span
                      className={countdown.urgent ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 100, padding: "2px 9px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}
                    >
                      <Clock style={{ width: 11, height: 11 }} />
                      {countdown.text}
                    </span>
                  )}
                </div>
              );

              const tabs: WorkspaceTab[] = [
                {
                  id: "overview",
                  label: "Overview",
                  anchors: ["general-preparation", "private-documents", "score-estimate", "intake", "reuse-past", "submission-plan", "tasks-milestones"],
                  badge: overdueTaskCount > 0 ? <TabBadge count={overdueTaskCount} /> : undefined,
                  content: (
                    <>
                      {complianceError}
                      {generalSections?.overview}
                      {complianceSections?.score}
                      <IntakeCard tenderId={id} />
                      {/* Feature item 9: carry over last time's reusable answers /
                          key-position people from a submitted tender (reuse-past-submission.tsx). */}
                      <ReusePastSubmission tenderId={id} reuseFrom={reuseFrom} saved={saved} reused={reused} />
                      {/* The full assessment-engine step list (every form/
                          returnable/role/question/gap, including briefing
                          milestones) - general-family only: SANRAL has no
                          requirements.py-shaped manifest to build this from. */}
                      {isGeneralFamily && <SubmissionPlanView tenderId={id} />}
                      <TaskTimeline tenderId={id} tasks={tasks} error={tasksError} people={assignablePeople} />
                    </>
                  ),
                },
                {
                  id: "compliance-guard",
                  label: "Compliance & Guard",
                  anchors: ["disqualification-guard", "readiness-report", "compliance-check", "locality", "general-documents", "general-questions", "tender-templates", "form-b7"],
                  badge: complianceGuardBadgeCount > 0 ? <TabBadge count={complianceGuardBadgeCount} /> : undefined,
                  content: (
                    <>
                      {/* The checks most likely to disqualify this bid outright,
                          then the 3-column Fix/Provide/Verify compliance
                          checklist (SANRAL) + returnables (general) -
                          Sarel's own completion-pass brief names this tab
                          after exactly this content. */}
                      {disqualificationGuardSection}
                      {readinessReportSection}
                      {complianceSections?.documents}
                      {complianceSections?.locality}
                      {generalSections?.documents}
                      {generalSections?.questions}
                      {/* The tender's blank SANRAL templates, uploaded by hand (0025). */}
                      {showSubmissionPack && <TenderTemplates tenderId={id} saved={saved === "template"} />}
                      {/* SANRAL Form B7: the company's own subcontracting answer (0056) - gates the pack below. */}
                      {showSubmissionPack && <SubcontractingPlan tenderId={id} saved={saved === "b7"} />}
                    </>
                  ),
                },
                {
                  id: "pack-compiler",
                  label: "Pack compiler",
                  anchors: ["submission-logistics", "cover-page", "pack-review", "submission-pack", "general-pack", "general-pack-review", "narrative-documents"],
                  badge: (generalSections?.badges.generalFixCount ?? 0) > 0 ? <TabBadge count={generalSections!.badges.generalFixCount} /> : undefined,
                  content: (
                    <>
                      {/* Tender Command Center (Sarel's own brief, 2026-10-24):
                          this company's own plan for getting the pack to the
                          tender box, plus the real "tap to advance" dispatch
                          tracker the Dashboard's Lane C also reads. */}
                      {tenderPack && (
                        <div id="submission-logistics" className="mb-4 flex flex-col gap-3">
                          <SubmissionLogisticsForm
                            tenderId={id}
                            submissionType={tenderPack.submission_type}
                            deliveryLocation={tenderPack.delivery_location}
                            estimatedPrintHours={tenderPack.estimated_print_hours}
                            estimatedTransitHours={tenderPack.estimated_transit_hours}
                            courierContact={tenderPack.courier_contact}
                          />
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
                            <span className="text-xs font-semibold text-foreground">Dispatch status</span>
                            <DispatchStatusButton tenderPackId={tenderPack.id} tenderId={id} status={tenderPack.dispatch_status} />
                          </div>
                        </div>
                      )}
                      {showSubmissionPack && (
                        <CoverPagePreview
                          contractNo={tenderFacts.contract_no}
                          nraReference={tenderFacts.nra_reference}
                          description={tenderFacts.description}
                          buyer={tenderFacts.buyer}
                          closingDate={tenderFacts.closing_date}
                        />
                      )}
                      {/* Pack review: the full pre-compile preview (pack_review_confirmations, 0059) - shown before the generate button. */}
                      {packReviewSection}
                      {/* SANRAL submission pack: technical pack + separate Envelope 2 PDF (pack_generation_jobs, 0017). */}
                      {submissionPackSection}
                      {generalSections?.pack}
                      {/* Cover letter / methodology statement generator (narrative_documents, 0085), applies to both families. */}
                      {narrativeDocumentsSection}
                    </>
                  ),
                },
                {
                  id: "team-cvs",
                  label: "Team & CVs",
                  anchors: ["key-positions", "key-people", "company-experience", "general-people", "won-project"],
                  badge: teamBadgeCount > 0 ? <TabBadge count={teamBadgeCount} /> : undefined,
                  content: (
                    <>
                      {keyPositionsSection}
                      {complianceSections?.people}
                      {complianceSections?.experience}
                      {generalSections?.people}
                      {/* Won & completed projects (0065, feature 2): once the
                          pipeline board has this tender at 'won', record the
                          actual completed project and sync it into each
                          confirmed team member's own CV-feeding project history. */}
                      {tenderPack && tenderPack.pipeline_stage === "won" && (
                        <WonProjectCard
                          tenderId={id}
                          tenderPack={tenderPack}
                          positions={positions}
                          assignments={assignments}
                          peopleName={peopleName}
                        />
                      )}
                    </>
                  ),
                },
                {
                  id: "pricing-market",
                  label: "Pricing & Market",
                  anchors: ["market", "scope-pricing", "preference-points"],
                  content: (
                    <>
                      {/* Published bids/awards for this tender + similar
                          tenders (0044) - this company's own real pricing
                          intelligence, not a pricing input form (no bid
                          price is ever typed in before submission - see
                          submission-pack.tsx's own comment on that). */}
                      <MarketContext tender={{ id, buyer: tenderFacts.buyer, family: tenderFacts.family }} />
                      {/* Scope/pricing-model/value-band (migration 0060,
                          engine/discovery/tender_enrichment.py) - the same
                          honestly-rare, never-fabricated record the header's
                          "Est. value" badge and discovery/page.tsx's own
                          SCOPE_RECORD_COLUMNS read from; shown only when this
                          tender genuinely has one. No bill-of-quantities /
                          rate-input editor exists in this codebase yet (no
                          schema for it) - not built here as a guess. */}
                      {scopeRecordDetail && (scopeRecordDetail.scope_summary || scopeRecordDetail.pricing_model || scopeRecordDetail.value_band) && (
                        <div id="scope-pricing" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
                          <div className="mb-0.5 text-[15px] font-bold text-foreground">Scope & pricing</div>
                          {scopeRecordDetail.scope_summary && (
                            <div className="mb-1.5 text-xs text-foreground">{scopeRecordDetail.scope_summary.slice(0, 280)}</div>
                          )}
                          <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                            {scopeRecordDetail.pricing_model && (
                              <span>Pricing model: {PRICING_MODEL_LABEL[scopeRecordDetail.pricing_model] ?? scopeRecordDetail.pricing_model}</span>
                            )}
                            {scopeRecordDetail.value_band && <span>Estimated value: {scopeRecordDetail.value_band}</span>}
                          </div>
                          {scopeRecordDetail.confidence === "heuristic" && (
                            <div className="mt-0.5 text-[10px] text-muted-foreground">Keyword-matched from the listing text, not document-confirmed - treat as a starting point.</div>
                          )}
                        </div>
                      )}
                      {/* Preference-points calculation (Sarel's own completion-
                          pass brief) - the real Toolkit calculator
                          (/toolkit/bee-preference-points), embedded rather
                          than re-built: it's a general B-BBEE/price formula
                          with no tender-specific inputs of its own, so
                          there's nothing tender-scoped to prefill. */}
                      <div id="preference-points" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
                        <div className="mb-2 text-[15px] font-bold text-foreground">Preference points calculator</div>
                        <BeePreferencePointsClient embedded />
                      </div>
                    </>
                  ),
                },
              ];

              return <WorkspaceTabs tabs={tabs} sticky header={miniHeader} />;
            })()}

            {/* Notes + one chronological history of this tender (item 15;
                tender_comments, 0033) - kept outside the tabs above, on
                purpose: a comment thread is context for every tab, not
                content that belongs to just one of them. */}
            <ActivityLog tenderId={id} showAll={activity === "all"} />
          </>
        )}
      </div>
    </AppShell>
  );
}

const KIND_TAG: Record<string, string> = {
  closing: "Closing",
  briefing: "Briefing",
  clarification: "Clarification",
  submission: "Submission",
  opening: "Opening",
};

function taskDaysLeft(dueDate: string | null): number | null {
  if (!dueDate) return null;
  const target = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Task/deadline timeline - standard milestones (kind set, auto-seeded where
 * the date is known) plus free-text manual tasks, same table, same list,
 * ordered by due date. The "add task" form is deliberately just description
 * + due date - no dropdown of task types, per the explicit spec requirement.
 */
function TaskTimeline({
  tenderId,
  tasks,
  error,
  people,
}: {
  tenderId: string;
  tasks: TenderTask[];
  error: { message: string } | null;
  people: AssignablePerson[];
}) {
  const addTaskWithId = addTenderTask;

  return (
    <div id="tasks-milestones" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)", marginBottom: 2 }}>Tasks &amp; milestones</div>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 12 }}>
        Closing date is seeded automatically, and so is the briefing date once a buyer&apos;s addendum states
        it. The original tender&apos;s briefing, clarification and submission dates aren&apos;t extracted
        automatically yet - add them here when known. Add anything else specific to this
        tender (lining up a subcontractor, sourcing a product, a reference letter from a client) as a
        plain task - there&apos;s no fixed list to pick from.
      </div>

      {error && <ErrorBanner message="Couldn't load tasks. If it keeps happening, let us know." />}

      {!error && tasks.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", padding: "6px 0 12px" }}>No tasks yet.</div>
      )}

      {!error && tasks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", marginBottom: 14 }}>
          {tasks.map((t) => {
            const left = taskDaysLeft(t.due_date);
            const overdue = left !== null && left < 0 && t.status !== "done";
            return (
              <div
                key={t.id}
                style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid var(--border)" }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{t.description}</span>
                    {t.kind && (
                      <span className="bg-muted text-foreground" style={{ fontSize: 10, fontWeight: 600, borderRadius: 100, padding: "2px 8px" }}>
                        {KIND_TAG[t.kind] ?? t.kind}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: overdue ? "var(--destructive)" : "var(--muted-foreground)", marginTop: 2 }}>
                    {t.due_date ? `Due ${(formatDate(t.due_date) ?? "—")}` : "No due date set"}
                    {left !== null && t.status !== "done" && (
                      <span style={{ marginLeft: 6, fontWeight: 600 }}>
                        ({left >= 0 ? `${left} day${left === 1 ? "" : "s"} left` : `${-left} day${-left === 1 ? "" : "s"} overdue`})
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <TaskAssigneeSelect taskId={t.id} tenderId={tenderId} assignedTo={t.assigned_to} people={people} taskDescription={t.description} />
                  <TaskStatusButton taskId={t.id} tenderId={tenderId} status={t.status} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Submission deadline + bid opening reminders (0065, feature 1) - two
          small, dedicated forms, deliberately NOT a kind dropdown bolted
          onto the generic "Add a task" form below (that form's free-text
          shape is an explicit spec decision, see 0009's header comment). A
          SA public bid often has a separate, scheduled public bid-opening
          event, sometimes days after closing, worth its own reminder. */}
      <div style={{ borderTop: tasks.length > 0 ? "1px solid var(--border)" : undefined, paddingTop: tasks.length > 0 ? 14 : 0, marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)", marginBottom: 8 }}>Submission &amp; opening</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <ReminderForm
            tenderId={tenderId}
            kind="submission"
            label="Submission deadline reminder"
            defaultDescription="Submit the tender"
            existing={tasks.find((t) => t.kind === "submission") ?? null}
          />
          <ReminderForm
            tenderId={tenderId}
            kind="opening"
            label="Bid opening reminder"
            defaultDescription="Tender opening"
            existing={tasks.find((t) => t.kind === "opening") ?? null}
          />
        </div>
      </div>

      <form action={addTaskWithId} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <input type="hidden" name="tender_id" value={tenderId} />
        <div style={{ flex: "1 1 220px", minWidth: 180 }}>
          <label htmlFor="new-task-description" style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>Add a task</label>
          <input
            id="new-task-description"
            type="text"
            name="description"
            placeholder="e.g. Confirm subcontractor for electrical works"
            required
            style={{ width: "100%", boxSizing: "border-box", minHeight: 40, padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, fontFamily: "inherit" }}
          />
        </div>
        <div>
          <label htmlFor="new-task-due-date" style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>Due date</label>
          <input
            id="new-task-due-date"
            type="date"
            name="due_date"
            style={{ minHeight: 40, padding: "9px 11px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, fontFamily: "inherit" }}
          />
        </div>
        <div>
          <label htmlFor="new-task-assigned-to" style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>Assign to (optional)</label>
          <select
            id="new-task-assigned-to"
            name="assigned_to"
            defaultValue=""
            style={{ minHeight: 40, padding: "0 11px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, fontFamily: "inherit", background: "var(--card)", color: "var(--foreground)" }}
          >
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          style={{ minHeight: 40, padding: "0 16px", borderRadius: 8, background: "var(--primary)", color: "var(--primary-foreground)", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          Add task
        </button>
      </form>
    </div>
  );
}

/**
 * One compact row of the "Submission & opening" mini-section (0065) - a
 * description (editable, prefilled with a sensible default) + a date,
 * upserted on (company_id, tender_id, kind) by setTenderReminder. Prefills
 * from the existing tender_tasks row of that kind, if one is already set, so
 * re-submitting corrects it rather than starting blank.
 */
function ReminderForm({
  tenderId,
  kind,
  label,
  defaultDescription,
  existing,
}: {
  tenderId: string;
  kind: "submission" | "opening";
  label: string;
  defaultDescription: string;
  existing: TenderTask | null;
}) {
  return (
    <form action={setTenderReminder} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <input type="hidden" name="tender_id" value={tenderId} />
      <input type="hidden" name="kind" value={kind} />
      <div style={{ flex: "1 1 220px", minWidth: 180 }}>
        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>{label}</label>
        <input
          type="text"
          name="description"
          defaultValue={existing?.description ?? defaultDescription}
          required
          style={{ width: "100%", boxSizing: "border-box", minHeight: 38, padding: "8px 11px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, fontFamily: "inherit" }}
        />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>Date</label>
        <input
          type="date"
          name="due_date"
          defaultValue={existing?.due_date ?? ""}
          required
          style={{ minHeight: 38, padding: "8px 11px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, fontFamily: "inherit" }}
        />
      </div>
      <button
        type="submit"
        style={{
          minHeight: 38,
          padding: "0 14px",
          borderRadius: 8,
          background: existing ? "var(--card)" : "var(--primary)",
          color: existing ? "var(--foreground)" : "var(--primary-foreground)",
          fontSize: 12,
          fontWeight: 600,
          border: existing ? "1px solid var(--border)" : "none",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {existing ? "Update" : "Set reminder"}
      </button>
    </form>
  );
}

/**
 * "Won - record the completed project" (0065, feature 2). Shown only once
 * pipeline_stage reaches 'won' (/pipeline's moveTenderStage). Lists the
 * confirmed key positions read-only first - so it's clear exactly whose
 * project history this will touch before submitting - with any unconfirmed
 * position shown as "Not confirmed" rather than silently left out, then the
 * record/edit form, which calls syncWonProjectToTeam.
 */
function WonProjectCard({
  tenderId,
  tenderPack,
  positions,
  assignments,
  peopleName,
}: {
  tenderId: string;
  tenderPack: TenderPack;
  positions: string[];
  assignments: Assignment[];
  peopleName: Map<string, string>;
}) {
  const completed = !!tenderPack.project_completed_at;
  const rows = positions.map((code) => {
    const a = assignments.find((x) => x.position_code === code) ?? null;
    const personId = a?.confirmed_person_id ?? null;
    return { code, name: personId ? a?.people?.name ?? peopleName.get(personId) ?? "Person on file" : null };
  });
  const completionValue = tenderPack.project_completion_value_rm;
  const submittedPrice = tenderPack.submitted_price_zar;
  const defaultValueRm =
    completionValue != null
      ? String(completionValue)
      : submittedPrice != null
        ? (Number(submittedPrice) / 1_000_000).toFixed(2)
        : "";

  return (
    <div id="won-project" style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)", marginBottom: 2 }}>Won - record the completed project</div>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 12 }}>
        This updates each confirmed team member&apos;s own project history, so it&apos;s ready the next time you build their CV.
      </div>

      {completed && (
        <div style={{ fontSize: 13, color: "var(--success)", fontWeight: 600, marginBottom: 2 }}>
          Completed {(formatDate(tenderPack.project_completed_at!) ?? "—")}
          {completionValue != null && `, valued at ${formatZAR(Number(completionValue) * 1_000_000, { compact: true })}`}
        </div>
      )}
      {completed && tenderPack.project_completion_note && (
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginBottom: 10 }}>{tenderPack.project_completion_note}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", margin: completed ? "10px 0 12px" : "0 0 12px" }}>
        {rows.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", padding: "6px 0" }}>No key positions on this pack yet.</div>
        )}
        {rows.map(({ code, name }) => (
          <div key={code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
            <span style={{ color: "var(--foreground)", fontWeight: 600 }}>{code}</span>
            <span style={{ color: name ? "var(--success)" : "var(--warning)", fontWeight: name ? 400 : 600 }}>{name ?? "Not confirmed"}</span>
          </div>
        ))}
      </div>

      <form
        action={syncWonProjectToTeam}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", borderTop: "1px solid var(--border)", paddingTop: 12 }}
      >
        <input type="hidden" name="tender_id" value={tenderId} />
        <input type="hidden" name="tender_pack_id" value={tenderPack.id} />
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>Completion date</label>
          <input
            type="date"
            name="project_completed_at"
            defaultValue={tenderPack.project_completed_at ?? ""}
            required
            style={{ minHeight: 38, padding: "8px 11px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, fontFamily: "inherit" }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>Value (R million)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            name="project_completion_value_rm"
            defaultValue={defaultValueRm}
            style={{ minHeight: 38, padding: "8px 11px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, fontFamily: "inherit", width: 120 }}
          />
        </div>
        <div style={{ flex: "1 1 220px", minWidth: 180 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--foreground)", marginBottom: 4 }}>Note (optional)</label>
          <input
            type="text"
            name="project_completion_note"
            defaultValue={tenderPack.project_completion_note ?? ""}
            placeholder="e.g. scope change, variation order, handover detail"
            style={{ width: "100%", boxSizing: "border-box", minHeight: 38, padding: "8px 11px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, fontFamily: "inherit" }}
          />
        </div>
        <button
          type="submit"
          style={{ minHeight: 38, padding: "0 16px", borderRadius: 8, background: "var(--primary)", color: "var(--primary-foreground)", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          {completed ? "Update & re-sync" : "Record & sync to team"}
        </button>
      </form>
    </div>
  );
}

// Phase 2 sticky header banner (2026-10-23): one holistic status word for
// the whole tender, built from the same packStatus/tenderReadiness this
// page already computes - never a second, independent judgement of "where
// is this tender" that could disagree with the readiness score right below
// it on the same card.
function WorkspaceStatusBadge({
  tenderPack,
  tenderReadiness,
  packStatus,
}: {
  tenderPack: { pipeline_stage: string } | null;
  tenderReadiness: { thingsLeft: number } | null;
  packStatus: { label: string; className: string } | null;
}) {
  let label: string;
  let className: string;
  if (tenderPack && tenderPack.pipeline_stage === "won") {
    label = "Won";
    className = "bg-success/10 text-success";
  } else if (tenderPack && tenderPack.pipeline_stage === "lost") {
    label = "Lost";
    className = "bg-muted text-muted-foreground";
  } else if (tenderPack && tenderPack.pipeline_stage === "submitted") {
    label = "Submitted";
    className = "bg-success/10 text-success";
  } else if (tenderReadiness && tenderReadiness.thingsLeft === 0) {
    label = "Ready to submit";
    className = "bg-success/10 text-success";
  } else if (tenderPack) {
    label = "Assessing & building";
    className = packStatus?.className ?? "bg-warning/10 text-warning";
  } else {
    label = "Not started";
    className = "bg-muted text-muted-foreground";
  }
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", padding: "4px 12px", borderRadius: 100, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

// Phase 2 sticky header banner's primary action: links to the real
// generate-pack control already further down this page (SubmissionPack /
// GeneralTenderWorkspace's own pack section) instead of a second, new
// mutation path - a disabled-looking span with the reason when a real gate
// (no pack yet, an unconfirmed key position, an unresolved readiness item)
// blocks it, a real link when it doesn't. A plain anchor has no native
// disabled state, so "disabled" here is deliberately a span, not a
// non-functional <a>, which would still be keyboard-focusable and clickable.
function PrimaryPackActionLink({ href, ready, disabledReason }: { href: string; ready: boolean; disabledReason: string | null }) {
  if (!ready && disabledReason) {
    return (
      <div>
        <span
          aria-disabled="true"
          title={disabledReason}
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 40,
            padding: "0 18px",
            borderRadius: 8,
            background: "var(--muted)",
            color: "var(--muted-foreground)",
            fontSize: 13,
            fontWeight: 600,
            cursor: "not-allowed",
          }}
        >
          Generate submission pack
        </span>
        {/* title= (hover) doesn't reach touch devices - same reason
            submission-pack.tsx's own disabled "Fill SANRAL schedules" button
            already pairs its title with this exact visible line, so a phone
            user isn't left guessing why this one is grey too. */}
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--warning)" }}>{disabledReason}</div>
      </div>
    );
  }
  return (
    <a
      href={href}
      style={{
        display: "inline-flex",
        alignItems: "center",
        minHeight: 40,
        padding: "0 18px",
        borderRadius: 8,
        background: "var(--accent)",
        color: "var(--accent-foreground)",
        fontSize: 13,
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      Generate submission pack
    </a>
  );
}

// At-a-glance counts on the facts card, so "is this ready to submit" is
// answerable without scrolling past Tasks & Key positions to the report
// cards below - same idea as a compliance dashboard's top-of-page summary.
function SummaryChip({ count, label, className }: { count: number; label: string; className: string }) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600 }}>
      {count} {label}
    </span>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="bg-destructive/10 border-destructive/30 text-destructive"
      style={{
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: 9,
        padding: "11px 16px",
        marginBottom: 16,
        fontSize: 13,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <span>{message}</span>
      <RetryButton />
    </div>
  );
}

function ReportCard({
  title,
  count,
  className,
  emptyText,
  children,
}: {
  title: string;
  count: number;
  className: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 11, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{title}</div>
        <span className={className} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 20, height: 20, padding: "0 6px", borderRadius: 100, fontSize: 11, fontWeight: 700 }}>
          {count}
        </span>
      </div>
      {count === 0 ? (
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", paddingTop: 6 }}>{emptyText}</div>
      ) : (
        <div>{children}</div>
      )}
    </div>
  );
}
