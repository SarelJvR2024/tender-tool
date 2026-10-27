"use client";

import { useMemo, useState } from "react";
import TenderCatalogRow, { type TenderCatalogRowData } from "./TenderCatalogRow";
import { taxonomyGroups, taxonomyLabel, type DisciplineTaxonomy } from "@/lib/disciplineTaxonomy";

const field = "min-h-11 rounded-lg border border-border bg-card px-2.5 text-[12.5px] text-foreground";

type SortKey = "closing_date" | "created_at" | "pursuing_count";

/** Basic client-side filter/sort over the full catalog - same "state lives in
 * this component" pattern as OpportunityTable.tsx; proportionate to an admin
 * triage screen, no new searchParams-based filter convention invented. */
export default function TenderCatalogTable({ rows, taxonomy }: { rows: TenderCatalogRowData[]; taxonomy: DisciplineTaxonomy }) {
  const [buyer, setBuyer] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [cidb, setCidb] = useState<string>("all");
  const [extraction, setExtraction] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("closing_date");

  const buyers = useMemo(() => Array.from(new Set(rows.map((r) => r.buyer).filter(Boolean))).sort() as string[], [rows]);
  const cidbGradings = useMemo(() => Array.from(new Set(rows.map((r) => r.cidbGrading).filter(Boolean))).sort() as string[], [rows]);
  // Category options come from the taxonomy itself (every real group +
  // discipline slug), not just the ones already tagged on a tender - a
  // reviewer should be able to filter down to "zero results" for a category
  // nothing in the catalog has yet, same as any other admin filter here.
  const categoryOptions = useMemo(
    () => taxonomyGroups(taxonomy).flatMap((g) => [g.group, ...g.children]),
    [taxonomy],
  );

  const filtered = useMemo(() => {
    let out = rows;
    if (buyer !== "all") out = out.filter((r) => r.buyer === buyer);
    if (category !== "all") out = out.filter((r) => r.industryTags.includes(category) || r.disciplineTags.includes(category));
    if (cidb !== "all") out = out.filter((r) => r.cidbGrading === cidb);
    if (extraction !== "all") out = out.filter((r) => r.extractionStatus === extraction);
    out = [...out].sort((a, b) => {
      if (sort === "pursuing_count") return b.pursuingCount - a.pursuingCount;
      if (sort === "created_at") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      const ad = a.closingDate ? new Date(a.closingDate).getTime() : Infinity;
      const bd = b.closingDate ? new Date(b.closingDate).getTime() : Infinity;
      return ad - bd;
    });
    return out;
  }, [rows, buyer, category, cidb, extraction, sort]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <select aria-label="Filter by buyer / organ of state" value={buyer} onChange={(e) => setBuyer(e.target.value)} className={field}>
          <option value="all">Every client / organ of state</option>
          {buyers.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
          <option value="all">Every category</option>
          {categoryOptions.map((c) => <option key={c.slug} value={c.slug}>{c.parent_slug ? `— ${c.label}` : c.label}</option>)}
        </select>
        <select aria-label="Filter by CIDB grading" value={cidb} onChange={(e) => setCidb(e.target.value)} className={field}>
          <option value="all">Every CIDB grading</option>
          {cidbGradings.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Filter by extraction status" value={extraction} onChange={(e) => setExtraction(e.target.value)} className={field}>
          <option value="all">Every extraction status</option>
          <option value="not_extracted">Not yet extracted</option>
          <option value="native_text_ready">Native Text Ready</option>
          <option value="ocr_required">OCR Required</option>
          <option value="parsing_failed">Parsing Failed</option>
        </select>
        <select aria-label="Sort order" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={field}>
          <option value="closing_date">Sort: closing soonest</option>
          <option value="created_at">Sort: newest first</option>
          <option value="pursuing_count">Sort: most tracked</option>
        </select>
        <span className="self-center text-xs text-muted-foreground/70">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {category !== "all" && (
        <p className="mb-2.5 text-[11px] text-muted-foreground/70">
          Filtering to {taxonomyLabel(taxonomy, category)}.
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {filtered.length === 0 && (
          <div className="p-4.5 text-[13px] text-muted-foreground">No tenders match these filters.</div>
        )}
        {filtered.map((r) => <TenderCatalogRow key={r.id} row={r} taxonomy={taxonomy} />)}
      </div>
    </div>
  );
}
