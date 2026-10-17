"use client";

import { useState } from "react";
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

// Client-only because of the expand/collapse and document-picker state - the
// data itself is server-rendered by page.tsx (signed URLs included), and the
// review buttons post to Server Actions in ./actions.ts.
export default function HarnessRunRow(props: Props) {
  const { runId, testCompany, tenderRef, kind, status, runAt, details, counts, documents, reviewedAt, reviewNote } = props;
  const [open, setOpen] = useState(false);
  const [docIndex, setDocIndex] = useState(0);
  const ok = status === "ok";
  const chip = ok
    ? { bg: "#DCFCE7", color: "#15803D", label: "ok" }
    : { bg: "#FEE2E2", color: "#B91C1C", label: "flagged" };
  const review = reviewedAt
    ? { bg: "#DCFCE7", color: "#15803D", label: "reviewed" }
    : { bg: "#FEF3C7", color: "#B45309", label: "not reviewed" };
  const doc = documents[docIndex] ?? null;

  return (
    <div style={{ borderTop: "1px solid #F0EEE6" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "1.3fr 1.6fr 0.7fr 0.9fr 1.3fr",
          gap: 12,
          alignItems: "center",
          padding: "11px 18px",
          background: open ? "#F6F5F1" : "transparent",
          border: "none",
          textAlign: "left",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        <div style={{ fontSize: 13, color: "#16233B", fontWeight: 600 }}>{testCompany}</div>
        <div>
          <div style={{ fontSize: 12, fontFamily: "monospace", color: "#4B5563" }}>{tenderRef}</div>
          <div style={{ fontSize: 11, color: "#9A9684", marginTop: 2 }}>{KIND_LABEL[kind]}</div>
        </div>
        <div>
          <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: chip.bg, color: chip.color }}>
            {chip.label}
          </span>
        </div>
        <div>
          <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: 100, fontSize: 11, fontWeight: 600, background: review.bg, color: review.color }}>
            {review.label}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#9A9684" }}>
          {new Date(runAt).toLocaleString()}
          <span style={{ marginLeft: 6, color: "#D97706" }}>{open ? "hide ▲" : "open ▼"}</span>
        </div>
      </button>

      {open && (
        <div style={{ padding: "4px 18px 18px 18px", background: "#F6F5F1" }}>
          {details && (
            <div style={{ fontSize: 12, color: "#4B5563", whiteSpace: "pre-wrap", fontFamily: "monospace", marginBottom: 10 }}>
              {details}
            </div>
          )}
          {counts && Object.keys(counts).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {Object.entries(counts).map(([k, n]) => (
                <span key={k} style={{ fontSize: 11, padding: "2px 9px", borderRadius: 100, border: "1px solid #E5E1D5", background: "#FFFFFF", color: k === "missing" ? "#B91C1C" : k === "assumed_default" ? "#B45309" : "#4B5563" }}>
                  {n} {COUNT_LABEL[k] ?? k}
                </span>
              ))}
            </div>
          )}

          {/* Generated documents, rendered inline */}
          {documents.length === 0 ? (
            <div style={{ fontSize: 12, color: "#6B6758", marginBottom: 12 }}>
              No generated document stored for this run{status !== "ok" ? " (the run was refused or failed - see above)" : ""}.
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 8 }}>
                {documents.map((d, i) => (
                  <button
                    key={d.label}
                    onClick={() => setDocIndex(i)}
                    style={{
                      font: "inherit", fontSize: 12, padding: "5px 11px", borderRadius: 7, cursor: "pointer",
                      border: i === docIndex ? "1px solid #16233B" : "1px solid #E5E1D5",
                      background: i === docIndex ? "#16233B" : "#FFFFFF",
                      color: i === docIndex ? "#FFFFFF" : "#16233B",
                    }}
                  >
                    {d.label}
                  </button>
                ))}
                {doc?.url && (
                  <a href={doc.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#D97706", marginLeft: "auto" }}>
                    {doc.isPdf ? "Open in new tab ↗" : "Download ↓"}
                  </a>
                )}
              </div>
              {!doc?.url ? (
                <div style={{ fontSize: 12, color: "#B91C1C" }}>Could not create a link to this document (missing from storage?).</div>
              ) : doc.isPdf ? (
                <iframe
                  key={doc.url}
                  src={doc.url}
                  title={`${testCompany} - ${tenderRef} - ${doc.label}`}
                  style={{ width: "100%", height: "75vh", border: "1px solid #E5E1D5", borderRadius: 9, background: "#FFFFFF" }}
                />
              ) : (
                <div style={{ fontSize: 12, color: "#6B6758" }}>
                  Stored as .docx (LibreOffice wasn&apos;t available to make a PDF preview) - download to read it.
                </div>
              )}
            </div>
          )}

          {/* Review */}
          <div style={{ background: "#FFFFFF", border: "1px solid #E5E1D5", borderRadius: 9, padding: "12px 14px" }}>
            {reviewedAt ? (
              <form action={clearHarnessRunReview} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <input type="hidden" name="run_id" value={runId} />
                <div style={{ flex: 1, fontSize: 12, color: "#15803D" }}>
                  Reviewed {new Date(reviewedAt).toLocaleString()}
                  {reviewNote && <div style={{ color: "#4B5563", marginTop: 4, whiteSpace: "pre-wrap" }}>{reviewNote}</div>}
                </div>
                <button type="submit" style={{ fontSize: 12, padding: "6px 12px", borderRadius: 7, border: "1px solid #E5E1D5", background: "#FFFFFF", color: "#16233B", cursor: "pointer" }}>
                  Undo review
                </button>
              </form>
            ) : (
              <form action={markHarnessRunReviewed} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <input type="hidden" name="run_id" value={runId} />
                <textarea
                  name="note"
                  rows={2}
                  placeholder="Note (optional) - e.g. what you checked"
                  style={{ flex: 1, font: "inherit", fontSize: 12, padding: "7px 9px", border: "1px solid #E5E1D5", borderRadius: 7, resize: "vertical" }}
                />
                <button type="submit" style={{ fontSize: 12, fontWeight: 600, padding: "8px 14px", borderRadius: 7, border: "none", background: "#D97706", color: "#FFFFFF", cursor: "pointer" }}>
                  Mark reviewed
                </button>
              </form>
            )}
            <div style={{ fontSize: 11, color: "#9A9684", marginTop: 6 }}>
              A review stays while later runs produce the same result; a changed result clears it automatically.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
