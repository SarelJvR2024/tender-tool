"use client";

import { useState } from "react";
import { formatDate, formatDateTime } from "@/lib/dates";
import { taxonomyLabel, type DisciplineTaxonomy } from "@/lib/disciplineTaxonomy";

export type TenderCatalogRowData = {
  id: string;
  title: string | null;
  contractNo: string | null;
  buyer: string | null;
  closingDate: string | null;
  region: string | null;
  status: string | null;
  industryTags: string[];
  disciplineTags: string[];
  cidbGrading: string | null;
  cidbAmbiguous: boolean;
  extractionStatus: "not_extracted" | "native_text_ready" | "ocr_required" | "parsing_failed";
  pursuingCount: number;
  lastSeenAt: string | null;
  createdAt: string;
};

type Tone = "destructive" | "warning" | "success" | "muted";

// Extraction status labels follow the brief's own wording where a real
// stored signal supports it 1:1 (Native Text Ready / Parsing Failed) - see
// migration 0103's header for exactly why "OCR Required" and "Not yet
// extracted" are the other two honest states, not 3 forced into the brief's
// list.
const EXTRACTION_LABEL: Record<TenderCatalogRowData["extractionStatus"], string> = {
  not_extracted: "Not yet extracted",
  native_text_ready: "Native Text Ready",
  ocr_required: "OCR Required",
  parsing_failed: "Parsing Failed",
};
const EXTRACTION_TONE: Record<TenderCatalogRowData["extractionStatus"], Tone> = {
  not_extracted: "muted",
  native_text_ready: "success",
  ocr_required: "warning",
  parsing_failed: "destructive",
};

// Tailwind's scanner needs full, static class strings - same note as
// OpportunityRow.tsx/SystemAlertRow.tsx's identical chip pattern.
const PILL_TONE_CLASS: Record<Tone, string> = {
  destructive: "bg-destructive/10 text-destructive",
  warning: "bg-warning/10 text-warning",
  success: "bg-success/10 text-success",
  muted: "bg-muted text-muted-foreground",
};

function Pill({ text, tone }: { text: string; tone: Tone }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${PILL_TONE_CLASS[tone]}`}>
      {text}
    </span>
  );
}

export default function TenderCatalogRow({ row, taxonomy }: { row: TenderCatalogRowData; taxonomy: DisciplineTaxonomy }) {
  const [open, setOpen] = useState(false);
  const closed = row.closingDate ? new Date(row.closingDate) < new Date() : false;

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4.5 py-3 text-left font-[inherit] ${open ? "bg-card" : "bg-transparent"}`}
      >
        <span className="min-w-0 flex-[1_1_260px] overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-semibold text-foreground">
          {row.title || row.contractNo || "(untitled)"}
        </span>
        <span className="flex-[0_1_200px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">
          {row.buyer || "no buyer on file"}
        </span>
        <Pill text={EXTRACTION_LABEL[row.extractionStatus]} tone={EXTRACTION_TONE[row.extractionStatus]} />
        {row.cidbGrading && <Pill text={`CIDB ${row.cidbGrading}${row.cidbAmbiguous ? " ?" : ""}`} tone={row.cidbAmbiguous ? "warning" : "muted"} />}
        <span className="text-[11px] text-muted-foreground/70">
          {row.pursuingCount} tracking
        </span>
        <span className="text-[11px] text-muted-foreground/70">
          {row.closingDate ? `${closed ? "closed" : "closes"} ${(formatDate(row.closingDate) ?? "—")}` : "no closing date"}
          <span className="ml-1.5 text-accent">{open ? "hide ▲" : "open ▼"}</span>
        </span>
      </button>

      {open && (
        <div className="bg-card px-4.5 pb-4.5 pt-1 text-[12.5px] text-foreground">
          <div className="mb-3.5 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
            <Field label="Contract / reference">{row.contractNo || "-"}</Field>
            <Field label="Buyer / organ of state">{row.buyer || "-"}</Field>
            <Field label="Region">{row.region || "-"}</Field>
            <Field label="Status">{row.status || "-"}</Field>
            <Field label="First seen">{(formatDateTime(row.createdAt) ?? "—")}</Field>
            <Field label="Last seen">{row.lastSeenAt ? (formatDateTime(row.lastSeenAt) ?? "—") : "-"}</Field>
          </div>

          <div className="mb-3 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
            <div className="mb-1 font-semibold">Category</div>
            {row.industryTags.length === 0 && row.disciplineTags.length === 0 ? (
              <div className="text-muted-foreground/70">Not tagged yet.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {row.industryTags.map((t) => <Pill key={`i-${t}`} text={taxonomyLabel(taxonomy, t)} tone="muted" />)}
                {row.disciplineTags.map((t) => <Pill key={`d-${t}`} text={taxonomyLabel(taxonomy, t)} tone="muted" />)}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5">
            <div className="mb-1 font-semibold">Extraction status: {EXTRACTION_LABEL[row.extractionStatus]}</div>
            <div className="text-muted-foreground">
              {row.extractionStatus === "not_extracted" &&
                "No company has run a requirements extraction against this tender's documents yet."}
              {row.extractionStatus === "native_text_ready" &&
                "Every document read cleanly as native text - no scanned pages, nothing unreadable."}
              {row.extractionStatus === "ocr_required" &&
                "At least one document only read because OCR filled in a scanned page - text extracted, but double-check it against the original."}
              {row.extractionStatus === "parsing_failed" &&
                "At least one document could not be read at all (corrupt, truncated, or no usable text even after OCR) - see that company's own pack for which one."}
            </div>
          </div>
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
