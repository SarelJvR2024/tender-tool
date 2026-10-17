import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReviewButton } from "./review-button";
import { TaskStatusButton } from "./task-status-button";
import { TaskAssigneeSelect, type AssignablePerson } from "./task-assignee-select";
import { ComplianceReport } from "./compliance-report";
import { GeneralTenderWorkspace } from "./general-workspace";
import { GENERAL_FAMILY } from "@/lib/generalTender";
import { SANRAL_CONVENTIONAL_FAMILY } from "@/lib/tenderCompliance";
import { requestTenderCv, addTenderTask, ensureClosingMilestone, type TenderTaskStatus } from "./actions";
import { SiteNav } from "../../_components/SiteNav";
import { SubmissionPack } from "./submission-pack";
import { IntakeCard } from "./intake-card";

// Reads the signed-in user's session (via RLS) and per-tender data on every
// request - can't be prerendered. Same escape hatch as app/app/dashboard/page.tsx.
export const instant = false;

type TenderFacts = {
  id: string;
  contract_no: string | null;
  nra_reference: string | null;
  description: string | null;
  closing_date: string | null;
  family: string | null;
  source: string | null;
};

type TenderPack = {
  id: string;
  status: string;
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

function daysLeft(closingDate: string | null): number | null {
  if (!closingDate) return null;
  const ms = new Date(closingDate).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export default async function TenderWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  // Every action on this page (requestTenderCv, addTenderTask,
  // requestSubmissionPack) reports a refusal as ?error=... - shown at the top.
  const { error: actionError, saved } = await searchParams;
  const supabase = await createClient();

  const { data: tender, error: tenderError } = await supabase
    .from("tenders")
    .select("id, contract_no, nra_reference, description, closing_date, family, source")
    .eq("id", id)
    .maybeSingle();

  if (!tender && !tenderError) {
    notFound();
  }

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
    const { data: taskRows, error } = await supabase
      .from("tender_tasks")
      .select("id, description, due_date, status, kind, is_standard, assigned_to, people:assigned_to(name)")
      .eq("tender_id", id)
      .order("due_date", { ascending: true, nullsFirst: false });
    tasks = (taskRows ?? []) as unknown as TenderTask[];
    tasksError = error ? { message: error.message } : null;
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
    .select("id, status")
    .eq("tender_id", id)
    .maybeSingle();

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
  }

  const confirmedRows = provenance.filter((r) => r.status === "confirmed" || r.status === "computed");
  const reviewRows = provenance.filter((r) => r.status === "assumed_default");
  const missingRows = provenance.filter((r) => r.status === "missing");

  // Key positions + "Generate tender-specific CV" (integration point B,
  // Sarel's own direction 2026-10-16) - only meaningful once a pack exists.
  let assignments: Assignment[] = [];
  let generatedCvs: GeneratedCv[] = [];
  if (tenderPack) {
    const { data: assignmentRows } = await supabase
      .from("tender_pack_assignments")
      .select("id, position_code, confirmed_person_id, suggested_person_id, people:confirmed_person_id(name)")
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

  const left = daysLeft(tenderFacts?.closing_date ?? null);
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
  const showSubmissionPack =
    !!tenderPack && (isSanralFamily || tenderFacts?.family === "RRM Consultant Tender");
  // Non-SANRAL tenders (pursued from Discovery, migration 0018) get the
  // general preparation flow instead of the SANRAL compliance report.
  const isGeneralFamily = tenderFacts?.family === GENERAL_FAMILY;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", background: "#F6F5F1" }}>
      <SiteNav active="dashboard" />

      <div style={{ flex: 1, padding: "20px 16px", maxWidth: 820, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        {actionError && <ErrorBanner message={actionError} />}

        {tenderError && (
          <ErrorBanner message={`Could not load this tender: ${tenderError.message}`} />
        )}

        {!tenderFacts && !tenderError && (
          <ErrorBanner message="This tender could not be found." />
        )}

        {tenderFacts && (
          <>
            {/* Tender facts */}
            <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
                <div>
                  <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "#16233B" }}>{tenderFacts.contract_no ?? "No contract number"}</div>
                  <div style={{ fontSize: 11, color: "#9A9684" }}>{tenderFacts.nra_reference ?? "No NRA reference"}</div>
                </div>
                {packStatus && (
                  <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 12px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: packStatus.bg, color: packStatus.color, whiteSpace: "nowrap" }}>
                    {packStatus.label}
                  </span>
                )}
              </div>
              <h1 style={{ fontSize: 18, fontWeight: 700, color: "#16233B", margin: "0 0 10px", lineHeight: 1.35 }}>
                {tenderFacts.description ?? "Untitled tender"}
              </h1>
              <div style={{ fontSize: 13, color: "#6B6758" }}>
                Closes{" "}
                {tenderFacts.closing_date ? new Date(tenderFacts.closing_date).toLocaleDateString() : "- no closing date on file"}
                {left !== null && (
                  <span style={{ marginLeft: 8, fontWeight: 600, color: left <= 7 ? "#B45309" : "#9A9684" }}>
                    ({left >= 0 ? `${left} days left` : "closed"})
                  </span>
                )}
              </div>

              {tenderPack && provenance.length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: "1px solid #F0EEE6" }}>
                  {confirmedRows.length > 0 && (
                    <SummaryChip count={confirmedRows.length} label="confirmed" bg="#DCFCE7" color="#15803D" />
                  )}
                  {reviewRows.length > 0 && (
                    <SummaryChip count={reviewRows.length} label="to review" bg="#FEF3C7" color="#B45309" />
                  )}
                  {missingRows.length > 0 && (
                    <SummaryChip count={missingRows.length} label="missing" bg="#FEE2E2" color="#B91C1C" />
                  )}
                  {overdueTaskCount > 0 && (
                    <SummaryChip count={overdueTaskCount} label={overdueTaskCount === 1 ? "task overdue" : "tasks overdue"} bg="#FEE2E2" color="#B91C1C" />
                  )}
                </div>
              )}
            </div>

            {/* Jump nav - this page stacks up to 9 report/management cards once
                a pack exists, so a sticky row of anchors beats blind-scrolling
                to find one (same idea as Stripe's data-dense dashboards: a
                wayfinding strip, not more scrolling, when a screen gets long).
                The pack link (the page's actual deliverable) leads the row in
                its "primary" color, so it's never scrolled out of view on a
                narrow screen behind the report links ahead of it. */}
            {(tenderPack || isSanralFamily) && (
              <div
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 5,
                  display: "flex",
                  gap: 6,
                  overflowX: "auto",
                  WebkitOverflowScrolling: "touch",
                  background: "#F6F5F1",
                  padding: "8px 2px",
                  marginBottom: 12,
                }}
              >
                {showSubmissionPack && <JumpLink href="#submission-pack" label="Submission pack" variant="primary" />}
                {isGeneralFamily && <JumpLink href="#general-pack" label="Pack" variant="primary" />}
                {tenderFacts.source !== "sanral" && <JumpLink href="#intake" label="Intake" />}
                {tenderPack && provenance.length > 0 && <JumpLink href="#readiness-report" label="Readiness" />}
                {isSanralFamily && <JumpLink href="#compliance-check" label="Documents" />}
                {isSanralFamily && <JumpLink href="#key-people" label="Key people" />}
                {isSanralFamily && <JumpLink href="#company-experience" label="Experience" />}
                {isSanralFamily && <JumpLink href="#score-estimate" label="Score" />}
                {isGeneralFamily && <JumpLink href="#general-preparation" label="Needs" />}
                {isGeneralFamily && <JumpLink href="#general-documents" label="Documents" />}
                {isGeneralFamily && <JumpLink href="#general-questions" label="Questions" />}
                <JumpLink href="#tasks-milestones" label="Tasks" />
                {tenderPack && assignments.length > 0 && <JumpLink href="#key-positions" label="CVs" />}
              </div>
            )}

            {packError && <ErrorBanner message={`Could not load this company's pack for this tender: ${packError.message}`} />}

            {!tenderPack && !packError && (
              <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", fontSize: 13, color: "#6B6758" }}>
                No tender pack exists yet for this tender at your company - nothing to review until one is created.
              </div>
            )}

            {tenderPack && (
              <>
                {provenanceError && <ErrorBanner message={`Could not load the readiness report: ${provenanceError.message}`} />}

                {provenance.length === 0 && !provenanceError && (
                  <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", fontSize: 13, color: "#6B6758" }}>
                    No readiness data recorded yet for this pack.
                  </div>
                )}

                {provenance.length > 0 && (
                  <div id="readiness-report" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginBottom: 16 }}>
                    <ReportCard
                      title="Already confirmed"
                      count={confirmedRows.length}
                      accent="#15803D"
                      bg="#DCFCE7"
                      emptyText="Nothing confirmed yet."
                    >
                      {confirmedRows.map((row) => (
                        <div key={row.field_key} style={{ padding: "9px 0", borderTop: "1px solid #F0EEE6" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{humanizeFieldKey(row.field_key)}</div>
                          <div style={{ fontSize: 12, color: "#4B5563", wordBreak: "break-word" }}>{row.value ?? "-"}</div>
                        </div>
                      ))}
                    </ReportCard>

                    <ReportCard
                      title="Please review"
                      count={reviewRows.length}
                      accent="#B45309"
                      bg="#FEF3C7"
                      emptyText="Nothing waiting on review."
                    >
                      {reviewRows.map((row) => (
                        <div key={row.field_key} style={{ padding: "10px 0", borderTop: "1px solid #F0EEE6" }}>
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
                    </ReportCard>

                    <ReportCard
                      title="Needs your input"
                      count={missingRows.length}
                      accent="#B91C1C"
                      bg="#FEE2E2"
                      emptyText="Nothing missing."
                    >
                      {missingRows.map((row) => (
                        <div key={row.field_key} style={{ padding: "9px 0", borderTop: "1px solid #F0EEE6" }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#16233B" }}>{humanizeFieldKey(row.field_key)}</div>
                          {row.reason && (
                            <div style={{ fontSize: 12, color: "#B91C1C", marginTop: 2 }}>{row.reason}</div>
                          )}
                        </div>
                      ))}
                    </ReportCard>
                  </div>
                )}
              </>
            )}

            {/* Intake (0024): how the documents were read and routed - SANRAL
                pack flow vs. general - and the fit for this company. */}
            <IntakeCard tenderId={id} />

            {/* Document/CV compliance + functionality score estimate for pursuing this tender.
                A tender whose documents haven't been analysed yet (family
                still null - a manual load waiting on its intake) has no
                family to report against; the intake card says so. */}
            {isGeneralFamily ? (
              <GeneralTenderWorkspace tenderId={id} saved={saved ?? null} />
            ) : tenderFacts.family ? (
              <ComplianceReport tenderId={id} />
            ) : null}

            <TaskTimeline tenderId={id} tasks={tasks} error={tasksError} people={assignablePeople} />

            {tenderPack && assignments.length > 0 && (
              <div id="key-positions" style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>Key positions</div>
                <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 12 }}>
                  Generates the tender-customized CV (requirement-matching cover page) for a
                  confirmed key person on this position. Fulfilled out-of-band by
                  engine/cv/process_cv_jobs.py - the web app cannot run Python/LibreOffice -
                  so this records a request, not an instant result.
                </div>
                {assignments.map((a) => {
                  const personName = a.people?.name ?? null;
                  const positionJobs = generatedCvs.filter((g) => g.position_code === a.position_code);
                  return (
                    <div key={a.id} style={{ borderTop: "1px solid #F0EEE6", padding: "12px 0" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B" }}>{a.position_code}</div>
                          <div style={{ fontSize: 12, color: "#4B5563", marginTop: 2 }}>
                            {personName ? `Confirmed: ${personName}` : "No key person confirmed yet for this position"}
                          </div>
                        </div>
                        {a.confirmed_person_id && (
                          <form action={requestTenderCv} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <input type="hidden" name="tender_id" value={id} />
                            <input type="hidden" name="tender_pack_id" value={tenderPack.id} />
                            <input type="hidden" name="position_code" value={a.position_code} />
                            <input type="hidden" name="person_id" value={a.confirmed_person_id} />
                            <select name="format" defaultValue="sanral_keyperson" style={{ minHeight: 36, borderRadius: 7, border: "1px solid #E5E1D5", fontSize: 12, padding: "0 8px" }}>
                              <option value="sanral_keyperson">SANRAL key-person</option>
                              <option value="world_bank">World Bank format</option>
                            </select>
                            <select name="detail" defaultValue="summary" style={{ minHeight: 36, borderRadius: 7, border: "1px solid #E5E1D5", fontSize: 12, padding: "0 8px" }}>
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
                        )}
                      </div>
                      {positionJobs.length > 0 && (
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                          {positionJobs.map((g) => {
                            const st = GENERATED_CV_STATUS_LABEL[g.status] ?? { label: g.status, bg: "#F0EEE6", color: "#6B6758" };
                            return (
                              <div key={g.id} style={{ fontSize: 11, color: "#6B6758", display: "flex", alignItems: "center", gap: 8 }}>
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

            {/* Whole SANRAL submission pack as one PDF (pack_generation_jobs, 0017). */}
            {showSubmissionPack && tenderPack && <SubmissionPack tenderId={id} tenderPackId={tenderPack.id} />}
          </>
        )}
      </div>
    </div>
  );
}

const KIND_TAG: Record<string, string> = {
  closing: "Closing",
  briefing: "Briefing",
  clarification: "Clarification",
  submission: "Submission",
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
    <div id="tasks-milestones" style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B", marginBottom: 2 }}>Tasks &amp; milestones</div>
      <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 12 }}>
        Closing date is seeded automatically. Briefing, clarification and submission dates aren&apos;t
        extracted automatically yet - add them here when known. Add anything else specific to this
        tender (lining up a subcontractor, sourcing a product, a reference letter from a client) as a
        plain task - there&apos;s no fixed list to pick from.
      </div>

      {error && <ErrorBanner message={`Could not load tasks: ${error.message}`} />}

      {!error && tasks.length === 0 && (
        <div style={{ fontSize: 12, color: "#9A9684", padding: "6px 0 12px" }}>No tasks yet.</div>
      )}

      {!error && tasks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", marginBottom: 14 }}>
          {tasks.map((t) => {
            const left = taskDaysLeft(t.due_date);
            const overdue = left !== null && left < 0 && t.status !== "done";
            return (
              <div
                key={t.id}
                style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid #F0EEE6" }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#16233B" }}>{t.description}</span>
                    {t.kind && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#16233B", background: "#F0EEE6", borderRadius: 100, padding: "2px 8px" }}>
                        {KIND_TAG[t.kind] ?? t.kind}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: overdue ? "#B91C1C" : "#6B6758", marginTop: 2 }}>
                    {t.due_date ? `Due ${new Date(t.due_date).toLocaleDateString()}` : "No due date set"}
                    {left !== null && t.status !== "done" && (
                      <span style={{ marginLeft: 6, fontWeight: 600 }}>
                        ({left >= 0 ? `${left} day${left === 1 ? "" : "s"} left` : `${-left} day${-left === 1 ? "" : "s"} overdue`})
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <TaskAssigneeSelect taskId={t.id} tenderId={tenderId} assignedTo={t.assigned_to} people={people} />
                  <TaskStatusButton taskId={t.id} tenderId={tenderId} status={t.status} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form action={addTaskWithId} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", borderTop: tasks.length > 0 ? "1px solid #F0EEE6" : undefined, paddingTop: tasks.length > 0 ? 14 : 0 }}>
        <input type="hidden" name="tender_id" value={tenderId} />
        <div style={{ flex: "1 1 220px", minWidth: 180 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#16233B", marginBottom: 4 }}>Add a task</label>
          <input
            type="text"
            name="description"
            placeholder="e.g. Confirm subcontractor for electrical works"
            required
            style={{ width: "100%", boxSizing: "border-box", minHeight: 40, padding: "9px 11px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 13, fontFamily: "inherit" }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#16233B", marginBottom: 4 }}>Due date</label>
          <input
            type="date"
            name="due_date"
            style={{ minHeight: 40, padding: "9px 11px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 13, fontFamily: "inherit" }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#16233B", marginBottom: 4 }}>Assign to (optional)</label>
          <select
            name="assigned_to"
            defaultValue=""
            style={{ minHeight: 40, padding: "0 11px", borderRadius: 8, border: "1px solid #E5E1D5", fontSize: 13, fontFamily: "inherit", background: "#FFFFFF", color: "#16233B" }}
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
        border: variant === "primary" ? "1px solid #D97706" : "1px solid #E5E1D5",
      }}
    >
      {label}
    </a>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 16, fontSize: 13, color: "#B91C1C" }}>
      {message}
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
    <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: "14px 16px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#16233B" }}>{title}</div>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 20, height: 20, padding: "0 6px", borderRadius: 100, fontSize: 11, fontWeight: 700, background: bg, color: accent }}>
          {count}
        </span>
      </div>
      {count === 0 ? (
        <div style={{ fontSize: 12, color: "#9A9684", paddingTop: 6 }}>{emptyText}</div>
      ) : (
        <div>{children}</div>
      )}
    </div>
  );
}
