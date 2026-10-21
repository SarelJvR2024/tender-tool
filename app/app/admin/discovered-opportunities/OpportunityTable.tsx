"use client";

import { useMemo, useState } from "react";
import OpportunityRow, { type OpportunityRowData } from "./OpportunityRow";

const field = "min-h-11 rounded-lg border border-border bg-card px-2.5 text-[12.5px] text-foreground";

type SortKey = "first_seen" | "closing_date" | "confidence";

/** Basic client-side filter/sort over the full set - proportionate to a
 * once-a-day triage screen, same "state lives in this component" pattern as
 * CustomerRow's expand/collapse; no new searchParams-based filter convention
 * invented for a dataset this size. */
export default function OpportunityTable({ rows }: { rows: OpportunityRowData[] }) {
  const [status, setStatus] = useState<string>("all");
  const [source, setSource] = useState<string>("all");
  const [company, setCompany] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("first_seen");

  const sources = useMemo(() => Array.from(new Set(rows.map((r) => r.source).filter(Boolean))).sort() as string[], [rows]);
  const companies = useMemo(() => Array.from(new Set(rows.map((r) => r.company_name))).sort(), [rows]);

  const filtered = useMemo(() => {
    let out = rows;
    if (status !== "all") out = out.filter((r) => r.readiness.status === status);
    if (source !== "all") out = out.filter((r) => r.source === source);
    if (company !== "all") out = out.filter((r) => r.company_name === company);
    out = [...out].sort((a, b) => {
      if (sort === "closing_date") {
        const ad = a.closing_date ? new Date(a.closing_date).getTime() : Infinity;
        const bd = b.closing_date ? new Date(b.closing_date).getTime() : Infinity;
        return ad - bd;
      }
      if (sort === "confidence") return a.effective.level - b.effective.level;
      return new Date(b.first_seen).getTime() - new Date(a.first_seen).getTime();
    });
    return out;
  }, [rows, status, source, company, sort]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className={field}>
          <option value="all">Every status</option>
          <option value="flagged">Flagged</option>
          <option value="needs_documents">Needs documents downloaded</option>
          <option value="looks_ready">Looks ready</option>
        </select>
        <select aria-label="Filter by source" value={source} onChange={(e) => setSource(e.target.value)} className={field}>
          <option value="all">Every source</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Filter by company" value={company} onChange={(e) => setCompany(e.target.value)} className={field}>
          <option value="all">Every company</option>
          {companies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Sort order" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={field}>
          <option value="first_seen">Sort: newest first</option>
          <option value="closing_date">Sort: closing soonest</option>
          <option value="confidence">Sort: lowest confidence first</option>
        </select>
        <span className="self-center text-xs text-muted-foreground/70">
          {filtered.length} of {rows.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {filtered.length === 0 && (
          <div className="p-4.5 text-[13px] text-muted-foreground">No opportunities match these filters.</div>
        )}
        {filtered.map((r) => <OpportunityRow key={r.id} row={r} />)}
      </div>
    </div>
  );
}
