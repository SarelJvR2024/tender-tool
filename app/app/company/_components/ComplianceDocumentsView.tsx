"use client";

import { useState } from "react";
import { LayoutGrid, Pencil, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { VaultSection, ChipBadge } from "./shared";
import { DocumentRow, DocumentUploadAction } from "./DocumentRow";
import { filenameFromPath } from "@/lib/vaultDocuments";
import type { ComplianceDocEntry } from "./ComplianceDocumentsSection";
import { formatDate } from "@/lib/dates";

const fmtDate = (d: string | null) => (d ? (formatDate(d) ?? "—") : "—");
const EDIT_HREF = "/company?edit=1#compliance-documents";

/**
 * Sarel's own live feedback on this exact section: "these cards take up a
 * lot of space, move towards a table row view and not these cards, or have
 * the option to switch between cards and list view." Each document really
 * has only a handful of short facts (name, one identifying detail, expiry,
 * status, an action) - spec v3 §29's own "Expiry / document lists"
 * composition example is literally a table: "Document | ... | Expiry |
 * Status | View / Edit / Replace". Table is the default per his own
 * wording ("move towards"); cards stay one click away, not removed.
 *
 * View choice is plain component state, not persisted anywhere - it's a
 * display preference, not data, so it needs no new column/table.
 */
export function ComplianceDocumentsView({
  companyId,
  entries,
}: {
  companyId: string;
  entries: ComplianceDocEntry[];
}) {
  const [view, setView] = useState<"table" | "cards">("table");

  return (
    <VaultSection
      id="compliance-documents"
      title="Compliance documents"
      actions={
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5">
            <ViewToggleButton active={view === "table"} label="Table view" onClick={() => setView("table")}>
              <Table2 className="size-4" />
            </ViewToggleButton>
            <ViewToggleButton active={view === "cards"} label="Card view" onClick={() => setView("cards")}>
              <LayoutGrid className="size-4" />
            </ViewToggleButton>
          </div>
          <a href={EDIT_HREF} className={buttonVariants({ variant: "ghost", size: "sm", className: "gap-1 text-xs text-muted-foreground" })}>
            <Pencil className="size-3.5" /> Edit
          </a>
        </div>
      }
    >
      {view === "table" ? (
        <div className="flex flex-col">
          {/* Column header row - desktop/tablet only, the stacked mobile row below doesn't need it repeated per row. */}
          <div className="hidden grid-cols-[1.6fr_1fr_0.9fr_auto] items-center gap-3 border-b border-border pb-2 text-xs font-semibold text-muted-foreground sm:grid">
            <span>Document</span>
            <span>Expires</span>
            <span>Status</span>
            <span className="sr-only">Action</span>
          </div>
          {entries.map((e) => (
            <ComplianceDocTableRow key={e.kind} companyId={companyId} entry={e} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col">
          {entries.map((e) => (
            <DocumentRow key={e.kind} companyId={companyId} kind={e.kind} title={e.title} lines={e.lines} status={e.status} path={e.path} url={e.url} />
          ))}
        </div>
      )}
      <div className="mt-2.5 text-xs text-muted-foreground">
        PDF, Word or an image, up to 25 MB each - except the COID letter above, which is capped at 4.4 MB. A QSE or EME sworn
        affidavit is recorded as B-BBEE proof, but check each tender&apos;s own rule: SANRAL&apos;s Form A12 asks for a SANAS
        verification certificate and accepts an affidavit only from an EME with annual revenue under R1.8 million.
      </div>
    </VaultSection>
  );
}

function ViewToggleButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-8 items-center justify-center rounded-md transition-colors",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ComplianceDocTableRow({ companyId, entry }: { companyId: string; entry: ComplianceDocEntry }) {
  const filename = filenameFromPath(entry.path);
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-border py-3 first:border-t-0 sm:grid-cols-[1.6fr_1fr_0.9fr_auto] sm:items-center sm:gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{entry.title}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{entry.detail}</div>
        {entry.url && filename && (
          <a href={entry.url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block truncate text-xs font-semibold text-accent no-underline">
            {filename}
          </a>
        )}
      </div>
      <div className="text-xs text-muted-foreground sm:text-sm">
        <span className="font-semibold text-foreground sm:hidden">Expires: </span>
        {fmtDate(entry.expiry)}
      </div>
      <div>
        <ChipBadge status={entry.status} />
      </div>
      <div className="sm:justify-self-end sm:min-w-[180px]">
        <DocumentUploadAction companyId={companyId} kind={entry.kind} title={entry.title} hasExisting={!!filename} />
      </div>
    </div>
  );
}
