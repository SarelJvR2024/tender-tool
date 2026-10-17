import { createClient } from "@/lib/supabase/server";
import { JOB_STATUS_STYLE, type EngineJob } from "@/lib/generalTender";
import type { TenderIntake } from "@/lib/manualTender";
import { PackAutoRefresh } from "./pack-auto-refresh";
import { AddTenderDocumentsForm } from "../new/manual-tender-form";

/**
 * "How this tender was read" - the intake step every tender's documents go
 * through (engine/general/process_general_jobs.py run_extraction, migration
 * 0023): where it came from, the SANRAL-vs-general routing decision and the
 * signal behind it, the SANRAL templates it registered, the fingerprint
 * check, documents that couldn't be read, and the fit for this company
 * (discovered_opportunities - the same row Discovery shows).
 */

const card: React.CSSProperties = { background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 12, padding: "18px 20px", marginBottom: 16 };
const chip = (bg: string, color: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: bg, color, whiteSpace: "nowrap" });

const VERDICT: Record<string, { label: string; bg: string; color: string }> = {
  strong_fit: { label: "Strong fit", bg: "#DCFCE7", color: "#15803D" },
  possible: { label: "Possible", bg: "#FEF3C7", color: "#B45309" },
  needs_review: { label: "Needs review", bg: "#FEF3C7", color: "#B45309" },
  not_a_fit: { label: "Not a fit", bg: "#FEE2E2", color: "#B91C1C" },
  closed: { label: "Closed", bg: "#F1F5F9", color: "#475569" },
};
const FP_STYLE: Record<string, { label: string; bg: string; color: string }> = {
  ok: { label: "Template unchanged", bg: "#DCFCE7", color: "#15803D" },
  mismatch: { label: "Template changed", bg: "#FEE2E2", color: "#B91C1C" },
  no_baseline: { label: "No baseline yet", bg: "#FEF3C7", color: "#B45309" },
  error: { label: "Fingerprint failed", bg: "#FEE2E2", color: "#B91C1C" },
};

type Opportunity = { verdict: string; reasons: string[] | null; score_outlook: { summary?: string[] } | null; source: string };

export async function IntakeCard({ tenderId }: { tenderId: string }) {
  const supabase = await createClient();
  const { data: tender } = await supabase
    .from("tenders")
    .select("id, source, ocid, owner_company_id, intake, family")
    .eq("id", tenderId)
    .maybeSingle();
  if (!tender) return null;
  const intake = (tender.intake as TenderIntake | null) ?? null;
  const source = tender.source as string;

  const [{ data: jobRows }, { data: oppRows }] = await Promise.all([
    supabase.from("tender_engine_jobs").select("id, kind, status, error_message, requested_at, completed_at")
      .eq("tender_id", tenderId).eq("kind", "extract_requirements").order("requested_at", { ascending: false }).limit(1),
    supabase.from("discovered_opportunities").select("verdict, reasons, score_outlook, source").eq("tender_id", tenderId).limit(1),
  ]);
  let opp = ((oppRows ?? [])[0] as Opportunity | undefined) ?? null;
  if (!opp && tender.ocid) {
    const { data } = await supabase.from("discovered_opportunities").select("verdict, reasons, score_outlook, source").eq("ocid", tender.ocid as string).limit(1);
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
    <div id="intake" style={card}>
      <PackAutoRefresh active={active} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#16233B" }}>How this tender was read</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={chip("#F0EEE6", "#16233B")}>{isManual ? "Loaded manually" : source === "etenders_ocds" ? "From Discovery (eTenders)" : "SANRAL list"}</span>
          {jobStyle && <span style={chip(jobStyle.bg, jobStyle.color)}>Analysis: {jobStyle.label}</span>}
        </div>
      </div>

      {active && (
        <div style={{ fontSize: 13, color: "#B45309", background: "#FEF3C7", borderRadius: 9, padding: "10px 14px", marginBottom: 10 }}>
          Reading the documents: working out whether this is a SANRAL template tender or a general one, what it requires, and how
          it fits your company. This page refreshes by itself. If it stays queued, the Tender Tool worker isn&apos;t running yet.
        </div>
      )}

      {job?.status === "failed" && (
        <div role="alert" style={{ fontSize: 13, color: "#B91C1C", background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "10px 14px", marginBottom: 10 }}>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>The analysis failed - nothing below has been checked against this tender&apos;s documents.</div>
          <div style={{ wordBreak: "break-word" }}>{job.error_message ?? "No reason recorded."}</div>
        </div>
      )}

      {intake && (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <span style={chip(intake.route === "sanral" ? "#16233B" : "#F0EEE6", intake.route === "sanral" ? "#FFFFFF" : "#16233B")}>
              {intake.route === "sanral" ? `SANRAL pack flow - ${intake.family}` : "General (non-SANRAL) flow"}
            </span>
            {intake.fingerprint && (
              <span style={chip(FP_STYLE[intake.fingerprint.status].bg, FP_STYLE[intake.fingerprint.status].color)}>{FP_STYLE[intake.fingerprint.status].label}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#4B5563", lineHeight: 1.5, marginBottom: 8 }}>{intake.signal}</div>
          {intake.fingerprint && intake.fingerprint.status !== "ok" && (
            <div style={{ fontSize: 12, color: intake.fingerprint.status === "no_baseline" ? "#B45309" : "#B91C1C", marginBottom: 8 }}>
              {intake.fingerprint.detail}
              {intake.fingerprint.changes.length > 0 && ` Changed: ${intake.fingerprint.changes.join(", ")}.`}
            </div>
          )}
          {intake.sanral_documents.length > 0 && (
            <div style={{ fontSize: 12, color: "#4B5563", marginBottom: 8 }}>
              <div style={{ fontWeight: 600, color: "#16233B", marginBottom: 2 }}>SANRAL templates found</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {intake.sanral_documents.map((d) => (
                  <li key={d.doc_type}>{d.label}: <span style={{ color: "#6B6758" }}>{d.document}</span></li>
                ))}
              </ul>
            </div>
          )}
          {intake.setup && intake.setup.positions.length > 0 && (
            <div style={{ fontSize: 12, color: "#4B5563", marginBottom: 8 }}>
              Key positions on this tender&apos;s SETUP sheet:{" "}
              {intake.setup.positions.map((p) => `${p.code} (${p.description ?? "-"}${p.managerial ? ", managerial" : ""})`).join("; ")}
            </div>
          )}
          {intake.notes.length > 0 && (
            <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 12, color: "#B45309" }}>
              {intake.notes.map((n, i) => <li key={i} style={{ marginBottom: 2 }}>{n}</li>)}
            </ul>
          )}
          {intake.unreadable_documents.length > 0 && (
            <div style={{ fontSize: 12, color: "#B91C1C", marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>Couldn&apos;t read ({intake.unreadable_documents.length})</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {intake.unreadable_documents.map((d) => <li key={d.document}>{d.document}: {d.reason}</li>)}
              </ul>
            </div>
          )}
        </>
      )}

      {opp && (
        <div style={{ marginTop: 6, padding: "10px 12px", background: "#F6F5F1", border: "1px solid #E5E1D5", borderRadius: 9 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#16233B" }}>Fit for your company</span>
            <span style={chip((VERDICT[opp.verdict] ?? VERDICT.closed).bg, (VERDICT[opp.verdict] ?? VERDICT.closed).color)}>{(VERDICT[opp.verdict] ?? { label: opp.verdict }).label}</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "#4B5563" }}>
            {(opp.reasons ?? []).map((r, i) => <li key={i}>{r}</li>)}
            {(opp.score_outlook?.summary ?? []).map((r, i) => <li key={`s${i}`} style={{ color: "#6B6758" }}>{r}</li>)}
          </ul>
        </div>
      )}

      {isManual && ownerId && !active && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #F0EEE6" }}>
          <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 6 }}>
            Missing something (an addendum, the SANRAL workbook, a readable copy of a scanned page)? Add it and the tender is read again.
          </div>
          <AddTenderDocumentsForm companyId={ownerId} tenderId={tenderId} />
        </div>
      )}
    </div>
  );
}
