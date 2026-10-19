"use client";

import { useState } from "react";
import { overrideOpportunityConfidence } from "./actions";
import type { CompileReadiness, CompileConfidence } from "@/lib/compileReadiness";

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

const STATUS_COLOR: Record<string, string> = {
  flagged: "#B91C1C",
  needs_documents: "#92400E",
  looks_ready: "#15803D",
};
const BAND_COLOR: Record<string, string> = { low: "#B91C1C", medium: "#92400E", high: "#15803D" };

function Pill({ text, color }: { text: string; color: string }) {
  return (
    <span style={{
      display: "inline-flex", padding: "3px 9px", borderRadius: 100, fontSize: 11, fontWeight: 600,
      background: color + "1A", color,
    }}>
      {text}
    </span>
  );
}

export default function OpportunityRow({ row }: { row: OpportunityRowData }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ borderTop: "1px solid #ECEEF1" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%", display: "flex", flexWrap: "wrap", gap: "6px 12px", alignItems: "center",
          padding: "12px 18px", background: open ? "#FFFFFF" : "transparent", border: "none",
          textAlign: "left", cursor: "pointer", font: "inherit", boxSizing: "border-box",
        }}
      >
        <span style={{ flex: "1 1 260px", minWidth: 0, fontSize: 13.5, fontWeight: 600, color: "#16233B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.title || row.contract_number || "(untitled)"}
        </span>
        <span style={{ fontSize: 12, color: "#5B6472", flex: "0 1 160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.company_name}
        </span>
        <span style={{ fontSize: 11, color: "#8A93A0" }}>{row.verdict || "-"}</span>
        <Pill text={row.readiness.label} color={STATUS_COLOR[row.readiness.status]} />
        <Pill
          text={`${row.effective.isOverridden ? "override" : "confidence"} ${row.effective.level}/100`}
          color={BAND_COLOR[row.effective.band]}
        />
        <span style={{ fontSize: 11, color: "#8A93A0" }}>
          {row.closing_date ? `closes ${new Date(row.closing_date).toLocaleDateString()}` : "no closing date"}
          <span style={{ marginLeft: 6, color: "#D97706" }}>{open ? "hide ▲" : "open ▼"}</span>
        </span>
      </button>

      {open && (
        <div style={{ padding: "4px 18px 18px 18px", background: "#FFFFFF", fontSize: 12.5, color: "#16233B" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, marginBottom: 14 }}>
            <Field label="Contract / reference">{row.contract_number || "-"}</Field>
            <Field label="Buyer">{row.buyer || "-"}</Field>
            <Field label="Source">{row.source || "-"}</Field>
            <Field label="Tender type">{row.tender_type || "-"}</Field>
            <Field label="Province">{row.province || "-"}</Field>
            <Field label="First seen">{new Date(row.first_seen).toLocaleString()}</Field>
          </div>

          <div style={{ background: "#FAFBFC", border: "1px solid #E3E6EA", borderRadius: 9, padding: "11px 14px", marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Compile-readiness: {row.readiness.label}</div>
            {row.readiness.detail.map((d, i) => (
              <div key={i} style={{ color: "#5B6472", marginBottom: 2 }}>{d}</div>
            ))}
          </div>

          <div style={{ background: "#FAFBFC", border: "1px solid #E3E6EA", borderRadius: 9, padding: "11px 14px", marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Requirements extraction: {row.requirements_status === "extracted" ? "done" : "not yet extracted - documents not downloaded"}
            </div>
            {row.requirements_status === "extracted" ? (
              <>
                <div style={{ color: "#5B6472", marginBottom: 2 }}>
                  Route: {row.requirements_route || "-"}{row.requirements_family ? ` (${row.requirements_family})` : ""}
                </div>
                <div style={{ color: "#5B6472", marginBottom: 2 }}>{row.requirements_signal}</div>
                {row.requirements_missing && row.requirements_missing.length > 0 && (
                  <div style={{ color: "#B45309" }}>Missing: {row.requirements_missing.join(", ")}</div>
                )}
              </>
            ) : (
              <div style={{ color: "#5B6472" }}>
                No documents have been downloaded for this release yet (or it is a SANRAL release - those are never
                auto-downloaded, see the document store&apos;s own migration). Nothing here can say what is required until that happens.
              </div>
            )}
          </div>

          <div style={{ background: "#FAFBFC", border: "1px solid #E3E6EA", borderRadius: 9, padding: "11px 14px", marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              Confidence: computed {row.computedConfidence.level}/100 ({row.computedConfidence.band})
              {row.effective.isOverridden && ` - overridden to ${row.effective.level}/100`}
            </div>
            {row.computedConfidence.basis.map((b, i) => (
              <div key={i} style={{ color: "#5B6472", marginBottom: 1, fontSize: 11.5 }}>{b}</div>
            ))}
          </div>

          <div style={{ background: "#FFFFFF", border: "1px solid #E3E6EA", borderRadius: 9, padding: "11px 14px", marginBottom: 12 }}>
            {row.document_urls.length === 0 ? (
              <div style={{ color: "#8A93A0" }}>No documents listed.</div>
            ) : (
              row.document_urls.map((d, i) => (
                <div key={i} style={{ marginBottom: 3 }}>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" style={{ color: "#D97706" }}>{d.title || d.url}</a>
                  ) : (
                    <span style={{ color: "#8A93A0" }}>{d.title || "(untitled document, no direct link)"}</span>
                  )}
                </div>
              ))
            )}
          </div>

          <form action={overrideOpportunityConfidence} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
            <input type="hidden" name="opportunity_id" value={row.id} />
            <label style={{ fontSize: 11, color: "#5B6472" }}>
              Your confidence (0-100)
              <input
                type="number" name="level" min={0} max={100} defaultValue={row.confidence_override ?? ""}
                style={{ display: "block", width: 90, marginTop: 2, padding: "6px 8px", borderRadius: 7, border: "1px solid #E3E6EA", fontSize: 12.5 }}
              />
            </label>
            <label style={{ fontSize: 11, color: "#5B6472", flex: "1 1 220px" }}>
              Note
              <input
                type="text" name="note" defaultValue={row.confidence_override_note ?? ""}
                placeholder="Why you're adjusting it"
                style={{ display: "block", width: "100%", marginTop: 2, padding: "6px 8px", borderRadius: 7, border: "1px solid #E3E6EA", fontSize: 12.5, boxSizing: "border-box" }}
              />
            </label>
            <button type="submit" style={{ fontSize: 12, padding: "7px 12px", borderRadius: 7, border: "1px solid #E3E6EA", background: "#16233B", color: "#FFFFFF", cursor: "pointer" }}>
              Save
            </button>
          </form>
          {row.confidence_override !== null && (
            <form action={overrideOpportunityConfidence} style={{ marginTop: 6 }}>
              <input type="hidden" name="opportunity_id" value={row.id} />
              <input type="hidden" name="level" value="" />
              <button
                type="submit"
                style={{ fontSize: 12, padding: "7px 12px", borderRadius: 7, border: "1px solid #FCA5A5", background: "#FFFFFF", color: "#B91C1C", cursor: "pointer" }}
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
      <div style={{ fontSize: 10.5, color: "#8A93A0", marginBottom: 1 }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}
