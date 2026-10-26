"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/dates";
import { markHarnessRunReviewed, clearHarnessRunReview } from "./actions";

export type HarnessDocument = { label: string; url: string | null; isPdf: boolean };

type Props = {
  runId: string;
  testCompany: string;
  tenderRef: string;
  kind: "forms" | "pack";
  status: string;
  runAt: string;
  details: string | null;
  counts: Record<string, number> | null;
  documents: HarnessDocument[];
  reviewedAt: string | null;
  reviewNote: string | null;
};

const KIND_LABEL = { forms: "Form fill", pack: "Submission pack" } as const;
const COUNT_LABEL: Record<string, string> = { confirmed: "confirmed", computed: "computed", assumed_default: "assumed default", missing: "missing" };

// Tailwind's scanner needs full, static class strings - see the same note
// in SystemAlertRow.tsx.
const CHIP_TONE_CLASS = {
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  success: "bg-success/10 text-success border-success/20",
} as const;

function chipClass(tone: keyof typeof CHIP_TONE_CLASS) {
  return `inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${CHIP_TONE_CLASS[tone]}`;
}

const COUNT_TEXT_CLASS: Record<string, string> = {
  missing: "text-destructive",
  assumed_default: "text-warning",
};

// Client-only because of the expand/collapse and document-picker state - the
// data itself is server-rendered by page.tsx (signed URLs included), and the
// review buttons post to Server Actions in ./actions.ts.
//
// Color-token migration (2026-10-21): was raw inline-CSSProperties
// throughout - see SystemAlertRow.tsx (the near-identical sibling row this
// shares its whole visual pattern with) for the shared reasoning on the
// soft-tint chip convention and accent-for-the-one-CTA rule.
export default function HarnessRunRow(props: Props) {
  const { runId, testCompany, tenderRef, kind, status, runAt, details, counts, documents, reviewedAt, reviewNote } = props;
  const [open, setOpen] = useState(false);
  const [docIndex, setDocIndex] = useState(0);
  const ok = status === "ok";
  const chipTone = ok ? ("success" as const) : ("destructive" as const);
  const chipLabel = ok ? "ok" : "flagged";
  const reviewTone = reviewedAt ? ("success" as const) : ("warning" as const);
  const reviewLabel = reviewedAt ? "reviewed" : "not reviewed";
  const doc = documents[docIndex] ?? null;

  return (
    <div className="border-t border-border first:border-t-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1.5 px-4.5 py-2.5 text-left font-[inherit] ${open ? "bg-card" : "bg-transparent"}`}
      >
        <span className={chipClass(chipTone)}>{chipLabel}</span>
        <span className="text-[13px] font-semibold text-foreground">{testCompany}</span>
        <span className="min-w-0 flex-[1_1_220px]">
          <span className="font-mono text-xs text-muted-foreground">{tenderRef}</span>
          <span className="ml-1.5 text-[11px] text-muted-foreground">{KIND_LABEL[kind]}</span>
        </span>
        <span className={chipClass(reviewTone)}>{reviewLabel}</span>
        <span className="text-[11px] text-muted-foreground">
          {formatDateTime(runAt) ?? runAt}
          <span className="ml-1.5 text-accent">{open ? "hide ▲" : "open ▼"}</span>
        </span>
      </button>

      {open && (
        <div className="bg-card px-4.5 pb-4.5 pt-1">
          {details && (
            <div className="mb-2.5 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
              {details}
            </div>
          )}
          {counts && Object.keys(counts).length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {Object.entries(counts).map(([k, n]) => (
                <span
                  key={k}
                  className={`rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] ${COUNT_TEXT_CLASS[k] ?? "text-muted-foreground"}`}
                >
                  {n} {COUNT_LABEL[k] ?? k}
                </span>
              ))}
            </div>
          )}

          {/* Generated documents, rendered inline */}
          {documents.length === 0 ? (
            <div className="mb-3 text-xs text-muted-foreground">
              No generated document stored for this run{status !== "ok" ? " (the run was refused or failed - see above)" : ""}.
            </div>
          ) : (
            <div className="mb-3.5">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {documents.map((d, i) => (
                  <button
                    key={d.label}
                    onClick={() => setDocIndex(i)}
                    className={`min-h-11 rounded-md border px-2.5 text-xs font-[inherit] ${
                      i === docIndex ? "border-foreground bg-foreground text-white" : "border-border bg-card text-foreground"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
                {doc?.url && (
                  <a href={doc.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs font-medium text-accent">
                    {doc.isPdf ? "Open in new tab ↗" : "Download ↓"}
                  </a>
                )}
              </div>
              {!doc?.url ? (
                <div className="text-xs text-destructive">Could not create a link to this document (missing from storage?).</div>
              ) : doc.isPdf ? (
                <iframe
                  key={doc.url}
                  src={doc.url}
                  title={`${testCompany} - ${tenderRef} - ${doc.label}`}
                  className="h-[75vh] w-full rounded-lg border border-border bg-card"
                />
              ) : (
                <div className="text-xs text-muted-foreground">
                  Stored as .docx (LibreOffice wasn&apos;t available to make a PDF preview) - download to read it.
                </div>
              )}
            </div>
          )}

          {/* Review */}
          <div className="rounded-lg border border-border bg-card p-3.5">
            {reviewedAt ? (
              <form action={clearHarnessRunReview} className="flex items-start gap-3">
                <input type="hidden" name="run_id" value={runId} />
                <div className="flex-1 text-xs text-success">
                  Reviewed {formatDateTime(reviewedAt) ?? reviewedAt}
                  {reviewNote && <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{reviewNote}</div>}
                </div>
                <button type="submit" className="min-h-11 rounded-md border border-border bg-card px-3 text-xs text-foreground">
                  Undo review
                </button>
              </form>
            ) : (
              <form action={markHarnessRunReviewed} className="flex items-start gap-2.5">
                <input type="hidden" name="run_id" value={runId} />
                <textarea
                  name="note"
                  rows={2}
                  placeholder="Note (optional) - e.g. what you checked"
                  className="flex-1 resize-y rounded-md border border-border px-2.5 py-1.5 font-[inherit] text-xs"
                />
                <button type="submit" className="min-h-11 rounded-md bg-accent px-3.5 text-xs font-semibold text-accent-foreground">
                  Mark reviewed
                </button>
              </form>
            )}
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              A review stays while later runs produce the same result; a changed result clears it automatically.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
