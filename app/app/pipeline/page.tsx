import type { CSSProperties } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { daysUntil } from "@/lib/dates";
import { GENERAL_FAMILY } from "@/lib/generalTender";
import { NEXT_STAGES, PIPELINE_STAGES, PREVIOUS_STAGE, STAGE_META, type PipelineStage } from "@/lib/pipeline";
import { SiteNav } from "../_components/SiteNav";
import { moveTenderStage } from "./actions";

// Reads the signed-in user's company via RLS on every request (same reasoning
// as app/app/dashboard/page.tsx) - can't be prerendered.
export const instant = false;

type TenderRow = {
  id: string;
  contract_no: string | null;
  title: string | null;
  description: string | null;
  buyer: string | null;
  closing_date: string | null;
  family: string | null;
  status: string;
  ocid: string | null;
  // Only this company's own pack comes back, via RLS (one per company per tender).
  tender_packs: { pipeline_stage: PipelineStage; stage_changed_at: string; submitted_at: string | null }[];
};

type Card = {
  id: string;
  stage: PipelineStage;
  contractNo: string | null;
  title: string;
  buyer: string;
  closingDate: string | null;
  stageChangedAt: string | null;
  submittedAt: string | null;
  verdict: string | null;
};

// Same chip vocabulary as app/app/discovery/page.tsx's verdictChip().
const VERDICT_CHIP: Record<string, { label: string; bg: string; color: string }> = {
  strong_fit: { label: "Strong fit", bg: "#DCFCE7", color: "#15803D" },
  possible: { label: "Possible", bg: "#FEF3C7", color: "#B45309" },
  needs_review: { label: "Needs review", bg: "#FEF3C7", color: "#B45309" },
  not_a_fit: { label: "Not a fit", bg: "#FEE2E2", color: "#B91C1C" },
};

const ACTION_LABEL: Record<PipelineStage, string> = {
  found: "Back to found",
  bidding: "Start bidding",
  submitted: "Mark submitted",
  won: "Won",
  lost: "Lost",
};

// Exact-time check (a tender closing at 12:00 today is closed by 12:01),
// unlike daysUntil()'s whole-day count.
function isPast(d: string | null): boolean {
  return !!d && new Date(d).getTime() < Date.now();
}

function shortDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "-";
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  const [{ data: tenders, error }, { data: opportunities }] = await Promise.all([
    supabase
      .from("tenders")
      .select("id, contract_no, title, description, buyer, closing_date, family, status, ocid, tender_packs(pipeline_stage, stage_changed_at, submitted_at)")
      .order("closing_date", { ascending: true }),
    // Discovery's fit verdict, where this tender came from the scored feed.
    supabase.from("discovered_opportunities").select("ocid, contract_number, verdict"),
  ]);

  const verdictByKey = new Map<string, string>();
  for (const o of (opportunities ?? []) as { ocid: string | null; contract_number: string | null; verdict: string }[]) {
    if (o.ocid) verdictByKey.set(`ocid:${o.ocid}`, o.verdict);
    if (o.contract_number) verdictByKey.set(`no:${o.contract_number}`, o.verdict);
  }

  const cards: Card[] = [];
  for (const t of (tenders ?? []) as unknown as TenderRow[]) {
    const pack = t.tender_packs?.[0];
    if (!pack) {
      // No pack yet: only the shared SANRAL feed (what Tenders lists) counts as
      // "found", and only while still open. A general tender without our pack
      // was pursued by another company - not ours to show.
      if (t.family === GENERAL_FAMILY || t.status !== "open") continue;
      if (isPast(t.closing_date)) continue;
    }
    cards.push({
      id: t.id,
      stage: pack?.pipeline_stage ?? "found",
      contractNo: t.contract_no,
      title: t.title || t.description || "(untitled)",
      buyer: t.buyer || (t.family && t.family !== GENERAL_FAMILY ? "SANRAL" : "(unknown buyer)"),
      closingDate: t.closing_date,
      stageChangedAt: pack?.stage_changed_at ?? null,
      submittedAt: pack?.submitted_at ?? null,
      verdict: (t.ocid && verdictByKey.get(`ocid:${t.ocid}`)) || (t.contract_no && verdictByKey.get(`no:${t.contract_no}`)) || null,
    });
  }

  const byStage = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, [] as Card[]])) as Record<PipelineStage, Card[]>;
  for (const c of cards) byStage[c.stage].push(c);
  // Open work sorts by what closes next; outcomes by most recent first.
  for (const s of ["submitted", "won", "lost"] as const) {
    byStage[s].sort((a, b) => (b.stageChangedAt ?? "").localeCompare(a.stageChangedAt ?? ""));
  }

  const submittedToDate = cards.filter((c) => c.submittedAt).length;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", background: "#F6F5F1" }}>
      <SiteNav active="pipeline" />

      <div style={{ flex: 1, padding: "24px 16px", maxWidth: 1240, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Pipeline</h1>
        <p style={{ fontSize: 13, color: "#6B6758", margin: "0 0 16px" }}>
          Every tender you&apos;re tracking, by stage. Open a card for its workspace; move it on when something changes.
        </p>

        {(error || actionError) && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 20, fontSize: 13, color: "#B91C1C" }}>
            {error ? `Could not load tenders: ${error.message}` : actionError}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 20 }}>
          <StatCard label="In progress" value={byStage.found.length + byStage.bidding.length} color="#16233B" />
          <StatCard label="Submitted to date" value={submittedToDate} color="#16233B" />
          <StatCard label="Won" value={byStage.won.length} color="#15803D" />
          <StatCard label="Lost" value={byStage.lost.length} color="#B91C1C" />
        </div>

        {/* The board scrolls sideways on its own on a phone; the page itself never does. */}
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(220px, 1fr))", gap: 12, alignItems: "start" }}>
            {PIPELINE_STAGES.map((stage) => {
              const meta = STAGE_META[stage];
              const column = byStage[stage];
              return (
                <section key={stage} style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 11, padding: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2px 4px 0" }}>
                    <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 700, background: meta.bg, color: meta.color }}>
                      {meta.label}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#6B6758" }}>{column.length}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#9A9684", padding: "6px 4px 10px" }}>{meta.hint}</div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {column.length === 0 && (
                      <div style={{ fontSize: 12, color: "#9A9684", padding: "14px 8px", textAlign: "center", border: "1px dashed #E5E1D5", borderRadius: 9 }}>
                        Nothing here
                      </div>
                    )}
                    {column.map((c) => (
                      <TenderCard key={c.id} card={c} />
                    ))}
                  </div>

                  {stage === "found" && (
                    <Link href="/discovery" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#D97706", textDecoration: "none", padding: "10px 4px 2px" }}>
                      Find more in Discovery →
                    </Link>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TenderCard({ card }: { card: Card }) {
  const verdict = card.verdict ? VERDICT_CHIP[card.verdict] : null;
  const left = daysUntil(card.closingDate);
  const open = card.stage === "found" || card.stage === "bidding";
  const back = PREVIOUS_STAGE[card.stage];

  let dateLine: { text: string; color: string };
  if (!open) {
    const when = card.stage === "submitted" ? card.submittedAt : card.stageChangedAt;
    dateLine = {
      text: `${card.stage === "submitted" ? "Submitted" : STAGE_META[card.stage].label} ${shortDate(when)}`,
      color: "#6B6758",
    };
  } else if (left === null) {
    dateLine = { text: "No closing date", color: "#9A9684" };
  } else if (isPast(card.closingDate)) {
    // Usually means it was handed in and just needs moving to Submitted.
    dateLine = { text: `Closed ${shortDate(card.closingDate)}`, color: "#B91C1C" };
  } else {
    dateLine = { text: `Closes ${shortDate(card.closingDate)} · ${left} day${left === 1 ? "" : "s"} left`, color: left <= 7 ? "#B45309" : "#6B6758" };
  }

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 9, padding: "10px 12px" }}>
      <Link href={`/tenders/${card.id}`} style={{ display: "block", textDecoration: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
          {card.contractNo && (
            <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 600, color: "#16233B", overflowWrap: "anywhere" }}>{card.contractNo}</span>
          )}
          {verdict && (
            <span style={{ padding: "2px 8px", borderRadius: 100, fontSize: 10, fontWeight: 600, background: verdict.bg, color: verdict.color }}>{verdict.label}</span>
          )}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#16233B", marginBottom: 2, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {card.title}
        </div>
        <div style={{ fontSize: 12, color: "#4B5563", marginBottom: 4 }}>{card.buyer}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: dateLine.color }}>{dateLine.text}</div>
      </Link>

      {(NEXT_STAGES[card.stage].length > 0 || back) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 10, paddingTop: 8, borderTop: "1px solid #F0EEE6" }}>
          {NEXT_STAGES[card.stage].map((next) => (
            <StageButton key={next} tenderId={card.id} stage={next} primary />
          ))}
          {back && <StageButton tenderId={card.id} stage={back} />}
        </div>
      )}
    </div>
  );
}

function StageButton({ tenderId, stage, primary = false }: { tenderId: string; stage: PipelineStage; primary?: boolean }) {
  const label = primary ? ACTION_LABEL[stage] : "← Back";
  const style: CSSProperties = primary
    ? {
        minHeight: 32,
        padding: "0 12px",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        border: stage === "won" ? "1px solid #15803D" : stage === "lost" ? "1px solid #B91C1C" : "none",
        background: stage === "won" ? "#DCFCE7" : stage === "lost" ? "#FEE2E2" : "#16233B",
        color: stage === "won" ? "#15803D" : stage === "lost" ? "#B91C1C" : "#FFFFFF",
      }
    : { minHeight: 32, padding: "0 6px", border: "none", background: "transparent", fontSize: 12, color: "#9A9684", cursor: "pointer" };
  return (
    <form action={moveTenderStage}>
      <input type="hidden" name="tender_id" value={tenderId} />
      <input type="hidden" name="stage" value={stage} />
      <button type="submit" style={style} title={primary ? undefined : `Move back to ${STAGE_META[stage].label}`}>
        {label}
      </button>
    </form>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 9, padding: "13px 16px" }}>
      <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}
