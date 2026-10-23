import { DowngradeFlag } from "../../discovery/downgrade-flag";
import { ACTIVE_PURSUIT_STAGES, DOWNGRADE_COLUMNS, isDowngraded, isOpenDowngrade, verdictLabel, type Downgrade } from "@/lib/discoveryReassessment";
import { createClient } from "@/lib/supabase/server";
import { JOB_STATUS_STYLE, type EngineJob } from "@/lib/generalTender";
import type { TenderIntake } from "@/lib/manualTender";
import { AutoRefresh } from "../../_components/AutoRefresh";
import { AddTenderDocumentsForm } from "../new/manual-tender-form";

/**
 * "How this tender was read" - the intake step every tender's documents go
 * through (engine/general/process_general_jobs.py run_extraction, migration
 * 0024): where it came from, the SANRAL-vs-general routing decision and the
 * signal behind it, the SANRAL templates it registered, the fingerprint
 * check, documents that couldn't be read, and the fit for this company
 * (discovered_opportunities - the same row Discovery shows).
 */

const chipClassName = "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap";
const chip = (className: string) => `${chipClassName} ${className}`;

const VERDICT: Record<string, { label: string; className: string }> = {
  strong_fit: { label: "Strong fit", className: "bg-success/10 text-success" },
  possible: { label: "Possible", className: "bg-warning/10 text-warning" },
  needs_review: { label: "Needs review", className: "bg-warning/10 text-warning" },
  not_a_fit: { label: "Not a fit", className: "bg-destructive/10 text-destructive" },
  closed: { label: "Closed", className: "bg-muted text-muted-foreground" },
};
const FP_STYLE: Record<string, { label: string; className: string }> = {
  ok: { label: "Template unchanged", className: "bg-success/10 text-success" },
  mismatch: { label: "Template changed", className: "bg-destructive/10 text-destructive" },
  no_baseline: { label: "No baseline yet", className: "bg-warning/10 text-warning" },
  error: { label: "Fingerprint failed", className: "bg-destructive/10 text-destructive" },
};
// Mirrors lib/generalTender.ts's JOB_STATUS_STYLE semantics (queued/working
// -> warning, ready -> success, failed -> destructive) as Tailwind classes -
// kept local rather than changing that shared hex-based export, which other
// not-yet-migrated files still read directly (out of scope for this pass).
const JOB_BADGE_CLASS: Record<string, string> = {
  requested: "bg-warning/10 text-warning",
  generating: "bg-warning/10 text-warning",
  ready: "bg-success/10 text-success",
  failed: "bg-destructive/10 text-destructive",
};

type Opportunity = Downgrade & { id: string; verdict: string; reasons: string[] | null; score_outlook: { summary?: string[] } | null; source: string };
const OPP_COLUMNS = `id, verdict, reasons, score_outlook, source, ${DOWNGRADE_COLUMNS}`;

export async function IntakeCard({ tenderId }: { tenderId: string }) {
  const supabase = await createClient();
  const { data: tender } = await supabase
    .from("tenders")
    .select("id, source, ocid, owner_company_id, intake, family")
    .eq("id", tenderId)
    .maybeSingle();
  if (!tender) return null;
  // With private documents on a shared tender (0032), this company's own
  // intake record (on its tender_packs row) describes what was read.
  const { data: ownPack } = await supabase.from("tender_packs").select("intake, pipeline_stage").eq("tender_id", tenderId).maybeSingle();
  const pursuingStage = ownPack?.pipeline_stage && ACTIVE_PURSUIT_STAGES.includes(ownPack.pipeline_stage as string) ? (ownPack.pipeline_stage as string) : null;
  const intake = ((ownPack?.intake ?? tender.intake) as TenderIntake | null) ?? null;
  const source = tender.source as string;

  const [{ data: jobRows }, { data: oppRows }] = await Promise.all([
    supabase.from("tender_engine_jobs").select("id, kind, status, error_message, requested_at, completed_at")
      .eq("tender_id", tenderId).eq("kind", "extract_requirements").order("requested_at", { ascending: false }).limit(1),
    supabase.from("discovered_opportunities").select(OPP_COLUMNS).eq("tender_id", tenderId).limit(1),
  ]);
  let opp = ((oppRows ?? [])[0] as Opportunity | undefined) ?? null;
  if (!opp && tender.ocid) {
    const { data } = await supabase.from("discovered_opportunities").select(OPP_COLUMNS).eq("ocid", tender.ocid as string).limit(1);
    opp = ((data ?? [])[0] as Opportunity | undefined) ?? null;
  }
  const job = ((jobRows ?? [])[0] as Pick<EngineJob, "id" | "status" | "error_message" | "requested_at" | "completed_at"> | undefined) ?? null;

  // SANRAL seed tenders (source 'sanral') never go through intake - nothing to show.
  if (source === "sanral" && !intake && !job) return null;

  const active = job?.status === "requested" || job?.status === "generating";
  const isManual = source === "manual";
  const ownerId = (tender.owner_company_id as string | null) ?? null;
  const jobStyle = job ? JOB_STATUS_STYLE[job.status] : null;

  return (
    <div id="intake" className="mb-4 rounded-xl border border-border bg-card px-5 py-[18px]">
      <AutoRefresh active={active} />
      <div className="mb-1.5 flex flex-wrap items-start justify-between gap-2.5">
        <div className="text-[15px] font-bold text-foreground">How this tender was read</div>
        <div className="flex flex-wrap gap-1.5">
          <span className={chip("bg-muted text-foreground")}>{isManual ? "Loaded manually" : source === "etenders_ocds" ? "From Discovery (eTenders)" : "SANRAL list"}</span>
          {jobStyle && <span className={chip(JOB_BADGE_CLASS[job!.status] ?? "bg-muted text-muted-foreground")}>Analysis: {jobStyle.label}</span>}
        </div>
      </div>

      {active && (
        <div className="mb-2.5 rounded-lg bg-warning/10 px-3.5 py-2.5 text-[13px] text-warning">
          Reading the documents: working out what this tender requires and how it fits your company. This page refreshes
          by itself. If it stays queued, the Tender Ready worker isn&apos;t running yet.
        </div>
      )}

      {job?.status === "failed" && (
        <div role="alert" className="mb-2.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive">
          <div className="mb-1 font-bold">The analysis failed - nothing below has been checked against this tender&apos;s documents.</div>
          <div className="break-words">{job.error_message ?? "No reason recorded."}</div>
        </div>
      )}

      {intake && (
        <>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className={chip(intake.route === "sanral" ? "bg-foreground text-white" : "bg-muted text-foreground")}>
              {intake.route === "sanral" ? `SANRAL pack flow - ${intake.family}` : "General flow"}
            </span>
            {intake.fingerprint && (
              <span className={chip(FP_STYLE[intake.fingerprint.status].className)}>{FP_STYLE[intake.fingerprint.status].label}</span>
            )}
          </div>
          <div className="mb-2 text-xs leading-relaxed text-muted-foreground">{intake.signal}</div>
          {intake.fingerprint && intake.fingerprint.status !== "ok" && (
            <div className={`mb-2 text-xs ${intake.fingerprint.status === "no_baseline" ? "text-warning" : "text-destructive"}`}>
              {intake.fingerprint.detail}
              {intake.fingerprint.changes.length > 0 && ` Changed: ${intake.fingerprint.changes.join(", ")}.`}
            </div>
          )}
          {intake.sanral_documents.length > 0 && (
            <div className="mb-2 text-xs text-muted-foreground">
              <div className="mb-0.5 font-semibold text-foreground">SANRAL templates found</div>
              <ul className="m-0 pl-[18px]">
                {intake.sanral_documents.map((d) => (
                  <li key={d.doc_type}>{d.label}: <span className="text-muted-foreground">{d.document}</span></li>
                ))}
              </ul>
            </div>
          )}
          {intake.setup && intake.setup.positions.length > 0 && (
            <div className="mb-2 text-xs text-muted-foreground">
              Key positions on this tender&apos;s SETUP sheet:{" "}
              {intake.setup.positions.map((p) => `${p.code} (${p.description ?? "-"}${p.managerial ? ", managerial" : ""})`).join("; ")}
            </div>
          )}
          {intake.notes.length > 0 && (
            <ul className="mb-2 pl-[18px] text-xs text-warning">
              {intake.notes.map((n, i) => <li key={i} className="mb-0.5">{n}</li>)}
            </ul>
          )}
          {intake.unreadable_documents.length > 0 && (
            <div className="mb-2 text-xs text-destructive">
              <div className="font-semibold">Couldn&apos;t read ({intake.unreadable_documents.length})</div>
              <ul className="m-0 pl-[18px]">
                {intake.unreadable_documents.map((d) => <li key={d.document}>{d.document}: {d.reason}</li>)}
              </ul>
            </div>
          )}
        </>
      )}

      {opp && isOpenDowngrade(opp) && (
        <div className="mt-1.5">
          <DowngradeFlag opportunityId={opp.id} verdict={opp.verdict} downgrade={opp} pursuingStage={pursuingStage} returnTo={`/tenders/${tenderId}`} acknowledgedByLabel={null} />
        </div>
      )}
      {opp && (
        <div className="mt-1.5 rounded-lg border border-border bg-card px-3 py-2.5">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-bold text-foreground">Fit for your company</span>
            <span className={chip((VERDICT[opp.verdict] ?? VERDICT.closed).className)}>{(VERDICT[opp.verdict] ?? { label: opp.verdict }).label}</span>
            {isDowngraded(opp) && (
              <span className={`${chip("bg-card text-muted-foreground")} border border-border line-through`}>was {verdictLabel(opp.downgraded_from)}</span>
            )}
          </div>
          <ul className="m-0 pl-4 text-xs text-muted-foreground">
            {(opp.reasons ?? []).map((r, i) => <li key={i}>{r}</li>)}
            {(opp.score_outlook?.summary ?? []).map((r, i) => <li key={`s${i}`} className="text-muted-foreground">{r}</li>)}
          </ul>
        </div>
      )}

      {isManual && ownerId && !active && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="mb-1.5 text-xs text-muted-foreground">
            Missing something (an addendum{intake?.route === "sanral" ? ", the SANRAL workbook" : ""}, a readable copy of a scanned page)? Add
            it and the tender is read again.
          </div>
          <AddTenderDocumentsForm companyId={ownerId} tenderId={tenderId} />
        </div>
      )}
    </div>
  );
}
