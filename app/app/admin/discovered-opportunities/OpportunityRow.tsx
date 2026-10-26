"use client";

import { useState } from "react";
import { overrideOpportunityConfidence } from "./actions";
import type { CompileReadiness, CompileConfidence } from "@/lib/compileReadiness";
import { formatDate, formatDateTime } from "@/lib/dates";

export type OpportunityRowData = {
  id: string;
  company_name: string;
  contract_number: string | null;
  buyer: string | null;
  title: string | null;
  closing_date: string | null;
  verdict: string | null;
  source: string | null;
  tender_type: string | null;
  province: string | null;
  first_seen: string;
  document_urls: { url?: string | null; title?: string | null }[];
  requirements_status: "not_downloaded" | "extracted";
  requirements_route: string | null;
  requirements_family: string | null;
  requirements_signal: string | null;
  requirements_missing: string[] | null;
  confidence_override: number | null;
  confidence_override_note: string | null;
  readiness: CompileReadiness;
  computedConfidence: CompileConfidence;
  effective: { level: number; band: "low" | "medium" | "high"; isOverridden: boolean; note: string | null };
};

type Tone = "destructive" | "warning" | "success";

const STATUS_TONE: Record<string, Tone> = {
  flagged: "destructive",
  needs_documents: "warning",
  looks_ready: "success",
};
const BAND_TONE: Record<string, Tone> = { low: "destructive", medium: "warning", high: "success" };

// Tailwind's scanner needs full, static class strings - a template-literal
// class name is invisible to it, so each tone is spelled out in full (same
// note as SystemAlertRow.tsx/HarnessRunRow.tsx's identical chip pattern).
const PILL_TONE_CLASS: Record<Tone, string> = {
  destructive: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
  success: "bg-success/10 text-success",
};

function Pill({ text, tone }: { text: string; tone: Tone }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${PILL_TONE_CLASS[tone]}`}>
      {text}
    </span>
  );
}

// Color-token migration (2026-10-21): was raw inline-CSSProperties
// throughout, including a dynamic `color + "1A"` hex-alpha trick to fake a
// 10%-tint pill from any passed hex - replaced with the same static
// tone -> soft-tint-class map every other row in this pass uses, since
// Tailwind can't see a runtime-built class name.
export default function OpportunityRow({ row }: { row: OpportunityRowData }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4.5 py-3 text-left font-[inherit] ${open ? "bg-card" : "bg-transparent"}`}
      >
        <span className="min-w-0 flex-[1_1_260px] overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-semibold text-foreground">
          {row.title || row.contract_number || "(untitled)"}
        </span>
        <span className="flex-[0_1_160px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
          {row.company_name}
        </span>
        <span className="text-[11px] text-muted-foreground/70">{row.verdict || "-"}</span>
        <Pill text={row.readiness.label} tone={STATUS_TONE[row.readiness.status]} />
        <Pill
          text={`${row.effective.isOverridden ? "override" : "confidence"} ${row.effective.level}/100`}
          tone={BAND_TONE[row.effective.band]}
        />
        <span className="text-[11px] text-muted-foreground/70">
          {row.closing_date ? `closes ${(formatDate(row.closing_date) ?? "—")}` : "no closing date"}
          <span className="ml-1.5 text-accent">{open ? "hide ▲" : "open ▼"}</span>
        </span>
      </button>

      {open && (
        <div className="bg-card px-4.5 pb-4.5 pt-1 text-[12.5px] text-foreground">
          <div className="mb-3.5 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
            <Field label="Contract / reference">{row.contract_number || "-"}</Field>
            <Field label="Buyer">{row.buyer || "-"}</Field>
            <Field label="Source">{row.source || "-"}</Field>
            <Field label="Tender type">{row.tender_type || "-"}</Field>
            <Field label="Province">{row.province || "-"}</Field>
            <Field label="First seen">{(formatDateTime(row.first_seen) ?? "—")}</Field>
          </div>

          <div className="mb-3 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
            <div className="mb-1 font-semibold">Compile-readiness: {row.readiness.label}</div>
            {row.readiness.detail.map((d, i) => (
              <div key={i} className="mb-0.5 text-muted-foreground">{d}</div>
            ))}
          </div>

          <div className="mb-3 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
            <div className="mb-1 font-semibold">
              Requirements extraction: {row.requirements_status === "extracted" ? "done" : "not yet extracted - documents not downloaded"}
            </div>
            {row.requirements_status === "extracted" ? (
              <>
                <div className="mb-0.5 text-muted-foreground">
                  Route: {row.requirements_route || "-"}{row.requirements_family ? ` (${row.requirements_family})` : ""}
                </div>
                <div className="mb-0.5 text-muted-foreground">{row.requirements_signal}</div>
                {row.requirements_missing && row.requirements_missing.length > 0 && (
                  <div className="text-warning">Missing: {row.requirements_missing.join(", ")}</div>
                )}
              </>
            ) : (
              <div className="text-muted-foreground">
                No documents have been downloaded for this release yet (or it is a SANRAL release - those are never
                auto-downloaded, see the document store&apos;s own migration). Nothing here can say what is required until that happens.
              </div>
            )}
          </div>

          <div className="mb-3 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
            <div className="mb-1 font-semibold">
              Confidence: computed {row.computedConfidence.level}/100 ({row.computedConfidence.band})
              {row.effective.isOverridden && ` - overridden to ${row.effective.level}/100`}
            </div>
            {row.computedConfidence.basis.map((b, i) => (
              <div key={i} className="mb-px text-[11.5px] text-muted-foreground">{b}</div>
            ))}
          </div>

          <div className="mb-3 rounded-lg border border-border bg-card px-3.5 py-2.5">
            {row.document_urls.length === 0 ? (
              <div className="text-muted-foreground/70">No documents listed.</div>
            ) : (
              row.document_urls.map((d, i) => (
                <div key={i} className="mb-1">
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="text-accent">{d.title || d.url}</a>
                  ) : (
                    <span className="text-muted-foreground/70">{d.title || "(untitled document, no direct link)"}</span>
                  )}
                </div>
              ))
            )}
          </div>

          <form action={overrideOpportunityConfidence} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="opportunity_id" value={row.id} />
            <label className="text-[11px] text-muted-foreground">
              Your confidence (0-100)
              <input
                type="number" name="level" min={0} max={100} defaultValue={row.confidence_override ?? ""}
                className="mt-0.5 block min-h-11 w-[90px] rounded-md border border-border px-2 text-[12.5px]"
              />
            </label>
            <label className="flex-[1_1_220px] text-[11px] text-muted-foreground">
              Note
              <input
                type="text" name="note" defaultValue={row.confidence_override_note ?? ""}
                placeholder="Why you're adjusting it"
                className="mt-0.5 block min-h-11 w-full rounded-md border border-border px-2 text-[12.5px]"
              />
            </label>
            <button type="submit" className="min-h-11 rounded-md border border-border bg-foreground px-3 text-xs text-white">
              Save
            </button>
          </form>
          {row.confidence_override !== null && (
            <form action={overrideOpportunityConfidence} className="mt-1.5">
              <input type="hidden" name="opportunity_id" value={row.id} />
              <input type="hidden" name="level" value="" />
              <button
                type="submit"
                className="min-h-11 rounded-md border border-destructive/40 bg-card px-3 text-xs text-destructive"
              >
                Clear override
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-px text-[10.5px] text-muted-foreground/70">{label}</div>
      <div>{children}</div>
    </div>
  );
}
