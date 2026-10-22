import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RetryButton } from "./retry-button";
import { ReviewButton } from "./review-button";
import { TaskStatusButton } from "./task-status-button";
import { TaskAssigneeSelect, type AssignablePerson } from "./task-assignee-select";
import { ComplianceReport } from "./compliance-report";
import { GeneralTenderWorkspace } from "./general-workspace";
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
import { ScrollFade } from "../../_components/ScrollFade";
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
import { computeTenderReadiness } from "./tender-readiness";
import { DisqualificationGuard } from "./disqualification-guard";
import { SubmissionPlanView } from "./submission-plan-view";

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

const GENERATED_CV_STATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  requested: { label: "Requested", bg: "#FEF3C7", color: "#B45309" },
  generating: { label: "Generating…", bg: "#FEF3C7", color: "#B45309" },
  ready: { label: "Ready", bg: "#DCFCE7", color: "#15803D" },
  failed: { label: "Failed", bg: "#FEE2E2", color: "#B91C1C" },
};

// tender_packs.status is a flat enum ('suggested' | 'confirmed' | 'filled') -
// there's no multi-stage workflow modeled in the schema, so this is an honest
// single badge rather than an invented stepper UI.
const PACK_STATUS_LABEL: Record<string, { label: string; bg: string; color: string }> = {
  suggested: { label: "Suggested - not yet confirmed", bg: "#FEF3C7", color: "#B45309" },
  confirmed: { label: "Confirmed", bg: "#DCFCE7", color: "#15803D" },
  filled: { label: "Filled", bg: "#DCFCE7", color: "#15803D" },
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
    .select("id, contract_no, nra_reference, description, closing_date, briefing_date, briefing_time, family, source, buyer")
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
      "id, status, pipeline_stage, submitted_at, submitted_price_zar, project_completed_at, project_completion_value_rm, project_completion_note",
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

  const countdown = closingCountdown(tenderFacts?.closing_date ?? null);
  const packStatus = tenderPack ? PACK_STATUS_LABEL[tenderPack.status] : null;
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
  if (isSanralFamily || isGeneralFamily) {
    try {
      disqualificationGuardSection = await DisqualificationGuard({ tenderId: id, isSanralFamily, isGeneralFamily });
    } catch (err) {
      console.error("DisqualificationGuard failed to render for tender", id, err);
      disqualificationGuardSection = <ErrorBanner message="Couldn't load the Disqualification guard. If it keeps happening, let us know." />;
    }
  }

  let complianceSection: React.ReactNode = null;
  try {
    if (isGeneralFamily) {
      complianceSection = await GeneralTenderWorkspace({ tenderId: id, saved: saved ?? null });
    } else if (tenderFacts?.family) {
      complianceSection = await ComplianceReport({ tenderId: id });
    }
  } catch (err) {
    console.error("Compliance/pack check failed to render for tender", id, err);
    complianceSection = <ErrorBanner message="Couldn't load the compliance check. If it keeps happening, let us know." />;
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
            {/* Tender facts */}
            <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#16233B" }}>{tenderFacts.contract_no ?? "No contract number"}</div>
                  <div style={{ fontSize: 11, color: "#8A93A0" }}>{tenderFacts.nra_reference ?? "No NRA reference"}</div>
                </div>
                {packStatus && (
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 12px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: packStatus.bg, color: packStatus.color, whiteSpace: "nowrap" }}>
                    {packStatus.label}
                  </span>
                )}
              </div>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: "#16233B", margin: "0 0 2px", lineHeight: 1.35 }}>
                {tenderFacts.description ?? "Untitled tender"}
              </h1>
              <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 8 }}>
                {tenderFacts.buyer ?? "No client on file"}
              </div>
              <div style={{ fontSize: 13, color: "#5B6472" }}>
                Closes{" "}
                {tenderFacts.closing_date ? new Date(tenderFacts.closing_date).toLocaleDateString() : "- no closing date on file"}
                {countdown && (
                  <span style={{ marginLeft: 8, fontWeight: 600, color: countdown.urgent ? "#B45309" : "#8A93A0" }}>
                    ({countdown.text})
                  </span>
                )}
              </div>
              {tenderReadiness && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, paddingTop: 10, borderTop: "1px solid #ECEEF1" }}>
                  <span
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
                      background: tenderReadiness.thingsLeft === 0 ? "#DCFCE7" : tenderReadiness.fix.length > 0 ? "#FEE2E2" : "#FEF3C7",
                      color: tenderReadiness.thingsLeft === 0 ? "#15803D" : tenderReadiness.fix.length > 0 ? "#B91C1C" : "#B45309",
                    }}
                  >
                    {tenderReadiness.score}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#16233B" }}>
                      {tenderReadiness.thingsLeft === 0
                        ? "Ready to submit"
                        : `${tenderReadiness.thingsLeft} thing${tenderReadiness.thingsLeft === 1 ? "" : "s"} left before you can submit`}
                    </div>
                    <div style={{ fontSize: 11, color: "#8A93A0" }}>Readiness score</div>
                  </div>
                </div>
              )}
              {tenderFacts.briefing_date && (
                <div style={{ fontSize: 13, color: "#5B6472", marginTop: 2 }}>
                  Briefing {formatDay(tenderFacts.briefing_date)}
                  {tenderFacts.briefing_time ? ` at ${tenderFacts.briefing_time}` : ""}
                  <span style={{ color: "#8A93A0" }}> - from the buyer&apos;s addendum (see below)</span>
                </div>
              )}

              {/* The actual record of submission (0021's trigger stamps this
                  the moment pipeline_stage first reaches submitted/won/lost)
                  - separate from the submission-deadline reminder below,
                  which is "remind us before it's due". */}
              {tenderPack && ["submitted", "won", "lost"].includes(tenderPack.pipeline_stage) && tenderPack.submitted_at && (
                <div style={{ fontSize: 13, color: "#15803D", fontWeight: 600, marginTop: 6 }}>
                  Submitted on {new Date(tenderPack.submitted_at).toLocaleDateString()}
                </div>
              )}

              {tenderPack && provenance.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: "1px solid #ECEEF1" }}>
                  {confirmedRows.length > 0 && (
                    <SummaryChip count={confirmedRows.length} label="confirmed" bg="#DCFCE7" color="#15803D" />
                  )}
                  {reviewRows.length > 0 && (
                    <SummaryChip count={reviewRows.length} label="to verify" bg="#DCFCE7" color="#15803D" />
                  )}
                  {missingRows.length > 0 && (
                    <SummaryChip count={missingRows.length} label="to provide" bg="#FEF3C7" color="#B45309" />
                  )}
                  {overdueTaskCount > 0 && (
                    <SummaryChip count={overdueTaskCount} label={overdueTaskCount === 1 ? "task overdue" : "tasks overdue"} bg="#FEE2E2" color="#B91C1C" />
                  )}
                </div>
              )}
            </div>

            {/* Addenda, changed dates and other documents the buyer added after
                discovery (0039) - straight under the facts, since a moved
                closing date changes everything below it. Nothing when none. */}
            <TenderUpdates tenderId={id} />

            {/* Disqualification guard - the checks most likely to disqualify a
                bid outright, read from the same data the rest of the page
                already reads. Mounted early, right after the facts, since
                it's meant to be the first thing a director checks. */}
            {disqualificationGuardSection}

            {/* Submission plan - the full assessment-engine step list (every
                form/returnable/role/question/gap), not just the Guard's
                curated disqualification-risk subset above. General-family
                only: SANRAL has no requirements.py-shaped manifest to build
                this from. */}
            {isGeneralFamily && <SubmissionPlanView tenderId={id} />}

            {/* Jump nav - this page stacks up to 9 report/management cards once
                a pack exists, so a sticky row of anchors beats blind-scrolling
                to find one (same idea as Stripe's data-dense dashboards: a
                wayfinding strip, not more scrolling, when a screen gets long).
                The pack link (the page's actual deliverable) leads the row in
                its "primary" color, so it's never scrolled out of view on a
                narrow screen behind the report links ahead of it.
                A full SANRAL pack row can carry 13+ pills - more than this
                page's 820px reading-width column fits at ANY viewport size,
                not just on mobile, so there was nothing marking that the row
                scrolls - the same stranded-content problem the pipeline board
                and Discovery's right rail were fixed for. The fade-only
                ScrollFade (no text hint - this bar is sticky, so a permanent
                hint line would add height to something pinned on screen for
                the whole page scroll) gives the same edge cue without that
                cost. minWidthToHide is set unreachably high because the
                overflow here doesn't depend on viewport width the way
                Pipeline's board does - the column is capped at 820px, so it
                never actually fits. */}
            {(tenderPack || isSanralFamily) && (
              <div
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 5,
                  background: "#FFFFFF",
                  padding: "8px 2px",
                  marginBottom: 12,
                }}
              >
                <div style={{ position: "relative" }}>
                  <div style={{ display: "flex", gap: 6, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
                    {showSubmissionPack && <JumpLink href="#submission-pack" label="Submission pack" variant="primary" />}
                    {showSubmissionPack && <JumpLink href="#cover-page" label="Cover page" />}
                    {isGeneralFamily && <JumpLink href="#general-pack" label="Pack" variant="primary" />}
                    {(isSanralFamily || isGeneralFamily) && <JumpLink href="#disqualification-guard" label="Guard" />}
                    {isGeneralFamily && <JumpLink href="#submission-plan" label="Plan" />}
                    {tenderFacts.source !== "sanral" && <JumpLink href="#intake" label="Intake" />}
                    {tenderPack && provenance.length > 0 && <JumpLink href="#readiness-report" label="Readiness" />}
                    {isSanralFamily && <JumpLink href="#compliance-check" label="Documents" />}
                    {isSanralFamily && <JumpLink href="#key-people" label="Key people" />}
                    {isSanralFamily && <JumpLink href="#company-experience" label="Experience" />}
                    {isSanralFamily && <JumpLink href="#score-estimate" label="Score" />}
                    {isGeneralFamily && <JumpLink href="#general-preparation" label="Needs" />}
                    {isGeneralFamily && <JumpLink href="#general-documents" label="Documents" />}
                    {isGeneralFamily && <JumpLink href="#general-questions" label="Questions" />}
                    <JumpLink href="#market" label="Market" />
                    <JumpLink href="#tasks-milestones" label="Tasks" />
                    {tenderPack && tenderPack.pipeline_stage === "won" && <JumpLink href="#won-project" label="Won project" />}
                    <JumpLink href="#activity" label="Notes & activity" />
                    {tenderPack && (positions.length > 0 || isSanralPackFamily) && <JumpLink href="#key-positions" label="Key positions" />}
                    {showSubmissionPack && <JumpLink href="#tender-templates" label="Templates" />}
                    {showSubmissionPack && <JumpLink href="#form-b7" label="Form B7" />}
                    {showSubmissionPack && <JumpLink href="#pack-review" label="Pack review" />}
                    {isGeneralFamily && <JumpLink href="#general-pack-review" label="Pack review" />}
                    <JumpLink href="#narrative-documents" label="Cover letter" />
                  </div>
                  <ScrollFade fadeColor="255, 255, 255" minWidthToHide={99999} hint={false} />
                </div>
              </div>
            )}

            {packError && <ErrorBanner message="Couldn't load this tender's pack. If it keeps happening, let us know." />}

            {!tenderPack && !packError && (
              <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px", fontSize: 13, color: "#5B6472", marginBottom: 16 }}>
                No tender pack exists yet for this tender at your company - nothing to review until one is created.
                {isSanralPackFamily && (
                  <form action={startTenderPack} style={{ marginTop: 12 }}>
                    <input type="hidden" name="tender_id" value={id} />
                    <button
                      type="submit"
                      style={{ minHeight: 40, padding: "0 16px", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}
                    >
                      Start a pack for this tender
                    </button>
                  </form>
                )}
              </div>
            )}

            {tenderPack && (
              <>
                {provenanceError && <ErrorBanner message="Couldn't load the readiness report. If it keeps happening, let us know." />}

                {provenance.length === 0 && !provenanceError && (
                  <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px", fontSize: 13, color: "#5B6472" }}>
                    No readiness data recorded yet for this pack.
                  </div>
                )}

                {provenance.length > 0 && (
                  <div id="readiness-report" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginBottom: 16 }}>
                    {/* Verify/Provide, the Product promise's own grouping (app/AGENTS.md) -
                        "Already confirmed" and "Please review" merged into one Verify card
                        (AI-filled, green once confirmed - same pattern compliance-report.tsx
                        uses) since both are the same type of task, just at different points
                        of being confirmed. "Needs your input" is Provide, not Fix: a missing
                        intake fact isn't a disqualification risk the way a missing mandatory
                        compliance document is, so it's recolored amber, not red. */}
                    <ReportCard
                      title="Verify"
                      count={confirmedRows.length + reviewRows.length}
                      accent="#15803D"
                      bg="#DCFCE7"
                      emptyText="Nothing to verify yet."
                    >
                      {reviewRows.map((row) => (
                        <div key={row.field_key} style={{ padding: "10px 0", borderTop: "1px solid #ECEEF1" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{humanizeFieldKey(row.field_key)}</div>
                            <ReviewButton fieldKey={row.field_key} />
                          </div>
                          <div style={{ fontSize: 12, color: "#4B5563", wordBreak: "break-word", marginTop: 2 }}>{row.value ?? "-"}</div>
                          {row.reason && (
                            <div style={{ fontSize: 11, color: "#B45309", marginTop: 3 }}>{row.reason}</div>
                          )}
                        </div>
                      ))}
                      {confirmedRows.map((row) => (
                        <div key={row.field_key} style={{ padding: "9px 0", borderTop: "1px solid #ECEEF1" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{humanizeFieldKey(row.field_key)}</div>
                          <div style={{ fontSize: 12, color: "#4B5563", wordBreak: "break-word" }}>{row.value ?? "-"}</div>
                        </div>
                      ))}
                    </ReportCard>

                    <ReportCard
                      title="Provide"
                      count={missingRows.length}
                      accent="#B45309"
                      bg="#FEF3C7"
                      emptyText="Nothing left for you to supply."
                    >
                      {missingRows.map((row) => (
                        <div key={row.field_key} style={{ padding: "9px 0", borderTop: "1px solid #ECEEF1" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{humanizeFieldKey(row.field_key)}</div>
                          {row.reason && (
                            <div style={{ fontSize: 12, color: "#B45309", marginTop: 2 }}>{row.reason}</div>
                          )}
                        </div>
                      ))}
                    </ReportCard>
                  </div>
                )}
              </>
            )}

            {/* Feature item 9: carry over last time's reusable answers /
                key-position people from a submitted tender (reuse-past-submission.tsx). */}
            <ReusePastSubmission tenderId={id} reuseFrom={reuseFrom} saved={saved} reused={reused} />

            {/* Intake (0024): how the documents were read and routed - SANRAL
                pack flow vs. general - and the fit for this company. */}
            <IntakeCard tenderId={id} />

            {/* Document/CV compliance + functionality score estimate for pursuing this tender.
                A tender whose documents haven't been analysed yet (family
                still null - a manual load waiting on its intake) has no
                family to report against; the intake card says so. */}
            {complianceSection}

            {/* Published bids/awards for this tender + similar tenders (0044,
                market-context.tsx): where this company's price sat, and how
                crowded / price-driven this kind of tender is. */}
            <MarketContext tender={{ id, buyer: tenderFacts.buyer, family: tenderFacts.family }} />

            <TaskTimeline tenderId={id} tasks={tasks} error={tasksError} people={assignablePeople} />

            {/* Won & completed projects (0065, feature 2): once the pipeline
                board has this tender at 'won', record the actual completed
                project and sync it into each confirmed team member's own
                CV-feeding project history. */}
            {tenderPack && tenderPack.pipeline_stage === "won" && (
              <WonProjectCard
                tenderId={id}
                tenderPack={tenderPack}
                positions={positions}
                assignments={assignments}
                peopleName={peopleName}
              />
            )}

            {/* Notes + one chronological history of this tender (item 15; tender_comments, 0033). */}
            <ActivityLog tenderId={id} showAll={activity === "all"} />

            {tenderPack && (positions.length > 0 || isSanralPackFamily) && (
              <div id="key-positions" style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 2 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B" }}>Key positions</div>
                  {positions.length > 0 && (() => {
                    const open = positions.filter((code) => !assignments.find((a) => a.position_code === code)?.confirmed_person_id).length;
                    return (
                      <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", background: open ? "#FEF3C7" : "#DCFCE7", color: open ? "#B45309" : "#15803D" }}>
                        {open ? `${open} of ${positions.length} to confirm` : "All confirmed"}
                      </span>
                    );
                  })()}
                </div>
                <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 12 }}>
                  Choose who fills each position on this tender - the submission pack is built with exactly these
                  people and won&apos;t generate until every position has one. Tender Ready suggests the best match among
                  the people tagged on their People page as fitting the role (scored on their qualifications, projects
                  and years against the position), with up to two alternatives - confirm it, or pick anyone else from the
                  list. Once confirmed, you can request the tender-customized CV
                  (requirement-matching cover page); that is fulfilled out-of-band by engine/cv/process_cv_jobs.py, so it
                  records a request, not an instant result.
                </div>
                {positions.length === 0 && (
                  <div style={{ fontSize: 12, color: "#8A93A0", borderTop: "1px solid #ECEEF1", paddingTop: 10 }}>
                    No positions listed yet. They are read from this tender&apos;s own Technical Submission workbook (its
                    SETUP sheet) - upload it under Blank tender templates below, and they appear here once the pack
                    builder has read it.
                  </div>
                )}
                {assignablePeople.length === 0 && positions.length > 0 && (
                  <div style={{ fontSize: 12, color: "#B45309", marginBottom: 8 }}>
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
                    <div key={code} style={{ borderTop: "1px solid #ECEEF1", padding: "12px 0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B" }}>{code}</div>
                          {req?.position_description && (
                            <div style={{ fontSize: 12, color: "#5B6472", marginTop: 1 }}>{req.position_description}</div>
                          )}
                          {confirmedId ? (
                            <div style={{ fontSize: 12, color: "#15803D", marginTop: 2, fontWeight: 600 }}>
                              Confirmed: {a?.people?.name ?? peopleName.get(confirmedId) ?? "person on file"}
                            </div>
                          ) : (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FEE2E2", color: "#B91C1C", borderRadius: 100, padding: "3px 10px", fontSize: 11, fontWeight: 700, marginTop: 4 }}>
                              Fix: no key person confirmed - blocks the submission pack
                            </div>
                          )}
                          {!confirmedId && roleCode && tagged.length === 0 && (
                            <div style={{ fontSize: 11, color: "#8A93A0", marginTop: 4 }}>
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
                            <select name="format" defaultValue="sanral_keyperson" style={{ minHeight: 36, borderRadius: 7, border: "1px solid #E3E6EA", fontSize: 12, padding: "0 8px" }}>
                              <option value="sanral_keyperson">SANRAL key-person</option>
                              <option value="world_bank">World Bank format</option>
                            </select>
                            <select name="detail" defaultValue="summary" style={{ minHeight: 36, borderRadius: 7, border: "1px solid #E3E6EA", fontSize: 12, padding: "0 8px" }}>
                              <option value="summary">Summary</option>
                              <option value="detailed">Detailed</option>
                            </select>
                            <button
                              type="submit"
                              style={{ minHeight: 36, padding: "0 14px", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
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
                            const st = GENERATED_CV_STATUS_LABEL[g.status] ?? { label: g.status, bg: "#ECEEF1", color: "#5B6472" };
                            return (
                              <div key={g.id} style={{ fontSize: 11, color: "#5B6472", display: "flex", alignItems: "center", gap: 8 }}>
                                <span>{g.format} / {g.detail}</span>
                                <span style={{ display: "inline-flex", padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 600, background: st.bg, color: st.color }}>
                                  {st.label}
                                </span>
                                {g.error_message && <span style={{ color: "#B91C1C" }}>{g.error_message}</span>}
                                {g.storage_path_docx && cvSignedUrls[g.storage_path_docx] && (
                                  <a href={cvSignedUrls[g.storage_path_docx]} style={{ color: "#D97706", fontWeight: 600 }}>Word</a>
                                )}
                                {g.storage_path_pdf && cvSignedUrls[g.storage_path_pdf] && (
                                  <a href={cvSignedUrls[g.storage_path_pdf]} style={{ color: "#D97706", fontWeight: 600 }}>PDF</a>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
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

            {/* The tender's blank SANRAL templates, uploaded by hand (0025). */}
            {showSubmissionPack && <TenderTemplates tenderId={id} saved={saved === "template"} />}

            {/* SANRAL Form B7: the company's own subcontracting answer (0056) - gates the pack below. */}
            {showSubmissionPack && <SubcontractingPlan tenderId={id} saved={saved === "b7"} />}

            {/* Pack review: the full pre-compile preview (pack_review_confirmations, 0059) - shown before the generate button. */}
            {packReviewSection}

            {/* SANRAL submission pack: technical pack + separate Envelope 2 PDF (pack_generation_jobs, 0017). */}
            {submissionPackSection}

            {/* Cover letter / methodology statement generator (narrative_documents, 0085). */}
            {narrativeDocumentsSection}
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
    <div id="tasks-milestones" style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>Tasks &amp; milestones</div>
      <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 12 }}>
        Closing date is seeded automatically, and so is the briefing date once a buyer&apos;s addendum states
        it. The original tender&apos;s briefing, clarification and submission dates aren&apos;t extracted
        automatically yet - add them here when known. Add anything else specific to this
        tender (lining up a subcontractor, sourcing a product, a reference letter from a client) as a
        plain task - there&apos;s no fixed list to pick from.
      </div>

      {error && <ErrorBanner message="Couldn't load tasks. If it keeps happening, let us know." />}

      {!error && tasks.length === 0 && (
        <div style={{ fontSize: 12, color: "#8A93A0", padding: "6px 0 12px" }}>No tasks yet.</div>
      )}

      {!error && tasks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", marginBottom: 14 }}>
          {tasks.map((t) => {
            const left = taskDaysLeft(t.due_date);
            const overdue = left !== null && left < 0 && t.status !== "done";
            return (
              <div
                key={t.id}
                style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid #ECEEF1" }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#16233B" }}>{t.description}</span>
                    {t.kind && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#16233B", background: "#ECEEF1", borderRadius: 100, padding: "2px 8px" }}>
                        {KIND_TAG[t.kind] ?? t.kind}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: overdue ? "#B91C1C" : "#5B6472", marginTop: 2 }}>
                    {t.due_date ? `Due ${new Date(t.due_date).toLocaleDateString()}` : "No due date set"}
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
      <div style={{ borderTop: tasks.length > 0 ? "1px solid #ECEEF1" : undefined, paddingTop: tasks.length > 0 ? 14 : 0, marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#16233B", marginBottom: 8 }}>Submission &amp; opening</div>
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

      <form action={addTaskWithId} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", borderTop: "1px solid #ECEEF1", paddingTop: 14 }}>
        <input type="hidden" name="tender_id" value={tenderId} />
        <div style={{ flex: "1 1 220px", minWidth: 180 }}>
          <label htmlFor="new-task-description" style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#16233B", marginBottom: 4 }}>Add a task</label>
          <input
            id="new-task-description"
            type="text"
            name="description"
            placeholder="e.g. Confirm subcontractor for electrical works"
            required
            style={{ width: "100%", boxSizing: "border-box", minHeight: 40, padding: "9px 11px", borderRadius: 8, border: "1px solid #E3E6EA", fontSize: 13, fontFamily: "inherit" }}
          />
        </div>
        <div>
          <label htmlFor="new-task-due-date" style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#16233B", marginBottom: 4 }}>Due date</label>
          <input
            id="new-task-due-date"
            type="date"
            name="due_date"
            style={{ minHeight: 40, padding: "9px 11px", borderRadius: 8, border: "1px solid #E3E6EA", fontSize: 13, fontFamily: "inherit" }}
          />
        </div>
        <div>
          <label htmlFor="new-task-assigned-to" style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#16233B", marginBottom: 4 }}>Assign to (optional)</label>
          <select
            id="new-task-assigned-to"
            name="assigned_to"
            defaultValue=""
            style={{ minHeight: 40, padding: "0 11px", borderRadius: 8, border: "1px solid #E3E6EA", fontSize: 13, fontFamily: "inherit", background: "#FFFFFF", color: "#16233B" }}
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
          style={{ minHeight: 40, padding: "0 16px", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
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
        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#16233B", marginBottom: 4 }}>{label}</label>
        <input
          type="text"
          name="description"
          defaultValue={existing?.description ?? defaultDescription}
          required
          style={{ width: "100%", boxSizing: "border-box", minHeight: 38, padding: "8px 11px", borderRadius: 8, border: "1px solid #E3E6EA", fontSize: 12, fontFamily: "inherit" }}
        />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#16233B", marginBottom: 4 }}>Date</label>
        <input
          type="date"
          name="due_date"
          defaultValue={existing?.due_date ?? ""}
          required
          style={{ minHeight: 38, padding: "8px 11px", borderRadius: 8, border: "1px solid #E3E6EA", fontSize: 12, fontFamily: "inherit" }}
        />
      </div>
      <button
        type="submit"
        style={{
          minHeight: 38,
          padding: "0 14px",
          borderRadius: 8,
          background: existing ? "#FFFFFF" : "#16233B",
          color: existing ? "#16233B" : "#FFFFFF",
          fontSize: 12,
          fontWeight: 600,
          border: existing ? "1px solid #E3E6EA" : "none",
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
    <div id="won-project" style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>Won - record the completed project</div>
      <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 12 }}>
        This updates each confirmed team member&apos;s own project history, so it&apos;s ready the next time you build their CV.
      </div>

      {completed && (
        <div style={{ fontSize: 13, color: "#15803D", fontWeight: 600, marginBottom: 2 }}>
          Completed {new Date(tenderPack.project_completed_at!).toLocaleDateString()}
          {completionValue != null && `, valued at R${Number(completionValue).toLocaleString("en-ZA")}m`}
        </div>
      )}
      {completed && tenderPack.project_completion_note && (
        <div style={{ fontSize: 12, color: "#5B6472", marginBottom: 10 }}>{tenderPack.project_completion_note}</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", margin: completed ? "10px 0 12px" : "0 0 12px" }}>
        {rows.length === 0 && (
          <div style={{ fontSize: 12, color: "#8A93A0", padding: "6px 0" }}>No key positions on this pack yet.</div>
        )}
        {rows.map(({ code, name }) => (
          <div key={code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "6px 0", borderTop: "1px solid #ECEEF1" }}>
            <span style={{ color: "#16233B", fontWeight: 600 }}>{code}</span>
            <span style={{ color: name ? "#15803D" : "#B45309", fontWeight: name ? 400 : 600 }}>{name ?? "Not confirmed"}</span>
          </div>
        ))}
      </div>

      <form
        action={syncWonProjectToTeam}
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", borderTop: "1px solid #ECEEF1", paddingTop: 12 }}
      >
        <input type="hidden" name="tender_id" value={tenderId} />
        <input type="hidden" name="tender_pack_id" value={tenderPack.id} />
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#16233B", marginBottom: 4 }}>Completion date</label>
          <input
            type="date"
            name="project_completed_at"
            defaultValue={tenderPack.project_completed_at ?? ""}
            required
            style={{ minHeight: 38, padding: "8px 11px", borderRadius: 8, border: "1px solid #E3E6EA", fontSize: 12, fontFamily: "inherit" }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#16233B", marginBottom: 4 }}>Value (R million)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            name="project_completion_value_rm"
            defaultValue={defaultValueRm}
            style={{ minHeight: 38, padding: "8px 11px", borderRadius: 8, border: "1px solid #E3E6EA", fontSize: 12, fontFamily: "inherit", width: 120 }}
          />
        </div>
        <div style={{ flex: "1 1 220px", minWidth: 180 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#16233B", marginBottom: 4 }}>Note (optional)</label>
          <input
            type="text"
            name="project_completion_note"
            defaultValue={tenderPack.project_completion_note ?? ""}
            placeholder="e.g. scope change, variation order, handover detail"
            style={{ width: "100%", boxSizing: "border-box", minHeight: 38, padding: "8px 11px", borderRadius: 8, border: "1px solid #E3E6EA", fontSize: 12, fontFamily: "inherit" }}
          />
        </div>
        <button
          type="submit"
          style={{ minHeight: 38, padding: "0 16px", borderRadius: 8, background: "#16233B", color: "#FFFFFF", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}
        >
          {completed ? "Update & re-sync" : "Record & sync to team"}
        </button>
      </form>
    </div>
  );
}

// At-a-glance counts on the facts card, so "is this ready to submit" is
// answerable without scrolling past Tasks & Key positions to the report
// cards below - same idea as a compliance dashboard's top-of-page summary.
function SummaryChip({ count, label, bg, color }: { count: number; label: string; bg: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: bg, color }}>
      {count} {label}
    </span>
  );
}

// variant "primary" marks the jump-nav's one link to the page's actual
// deliverable (the submission pack) - every other link is a report or an
// input form along the way, so it shouldn't look like just one more pill
// in the row once this page stacks up to 10 cards.
function JumpLink({ href, label, variant = "default" }: { href: string; label: string; variant?: "default" | "primary" }) {
  return (
    <a
      href={href}
      style={{
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        minHeight: 32,
        padding: "0 12px",
        borderRadius: 100,
        fontSize: 12,
        fontWeight: variant === "primary" ? 700 : 600,
        textDecoration: "none",
        whiteSpace: "nowrap",
        background: variant === "primary" ? "#D97706" : "#FFFFFF",
        color: variant === "primary" ? "#FFFFFF" : "#16233B",
        border: variant === "primary" ? "1px solid #D97706" : "1px solid #E3E6EA",
      }}
    >
      {label}
    </a>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      style={{
        background: "#FEE2E2",
        border: "1px solid #FCA5A5",
        borderRadius: 9,
        padding: "11px 16px",
        marginBottom: 16,
        fontSize: 13,
        color: "#B91C1C",
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
  accent,
  bg,
  emptyText,
  children,
}: {
  title: string;
  count: number;
  accent: string;
  bg: string;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 11, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B" }}>{title}</div>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 20, height: 20, padding: "0 6px", borderRadius: 100, fontSize: 11, fontWeight: 700, background: bg, color: accent }}>
          {count}
        </span>
      </div>
      {count === 0 ? (
        <div style={{ fontSize: 12, color: "#8A93A0", paddingTop: 6 }}>{emptyText}</div>
      ) : (
        <div>{children}</div>
      )}
    </div>
  );
}
