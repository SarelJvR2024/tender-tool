import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../../_components/AppShell";
import { AdminNav } from "../AdminNav";
import TenderCatalogTable from "./TenderCatalogTable";
import type { TenderCatalogRowData } from "./TenderCatalogRow";
import { loadDisciplineTaxonomy } from "@/lib/disciplineTaxonomy";

// Reads per-request session/DB data (platform_admin_tender_catalog, gated by
// is_platform_admin() - 0043/0103), same escape hatch as every other admin
// RPC page.
export const instant = false;

type Rpc = {
  tender_id: string; title: string | null; contract_no: string | null; buyer: string | null;
  closing_date: string | null; region: string | null; status: string | null;
  industry_tags: string[] | null; discipline_tags: string[] | null;
  cidb_grading: string | null; cidb_ambiguous: boolean | null;
  extraction_status: "not_extracted" | "native_text_ready" | "ocr_required" | "parsing_failed";
  pursuing_count: number; last_seen_at: string | null; created_at: string;
};

/**
 * Tender Catalog & Intelligence (Admin Command Center Phase 5, the last tab
 * from the original 7-tab brief): every tender in the catalog, filterable by
 * buyer/category/CIDB grading/closing date, with an honest extraction-status
 * badge and a real popularity counter. See migration 0103's own header for
 * exactly which stored signal each filter/badge reads - this page does no
 * classification of its own, only renders what that RPC already computed.
 */
export default async function AdminTendersPage() {
  const supabase = await createClient();

  const [{ data, error }, taxonomy] = await Promise.all([
    supabase.rpc("platform_admin_tender_catalog"),
    loadDisciplineTaxonomy(supabase),
  ]);
  if (error) console.error("platform_admin_tender_catalog rpc failed", error);
  const rpcRows = (data ?? []) as Rpc[];

  const rows: TenderCatalogRowData[] = rpcRows.map((r) => ({
    id: r.tender_id, title: r.title, contractNo: r.contract_no, buyer: r.buyer,
    closingDate: r.closing_date, region: r.region, status: r.status,
    industryTags: r.industry_tags ?? [], disciplineTags: r.discipline_tags ?? [],
    cidbGrading: r.cidb_grading, cidbAmbiguous: r.cidb_ambiguous ?? false,
    extractionStatus: r.extraction_status, pursuingCount: r.pursuing_count,
    lastSeenAt: r.last_seen_at, createdAt: r.created_at,
  }));

  const activeCount = rows.filter((r) => !r.closingDate || new Date(r.closingDate) >= new Date()).length;
  const extractedCount = rows.filter((r) => r.extractionStatus !== "not_extracted").length;
  const failedCount = rows.filter((r) => r.extractionStatus === "parsing_failed").length;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1200px] p-4 sm:p-6 md:px-8 md:py-6">
        <AdminNav active="tenders" />

        <h1 className="mb-1 font-display text-[22px] font-bold text-foreground">Tender catalog</h1>
        <p className="mb-2.5 max-w-[820px] text-[13px] text-muted-foreground">
          Every tender in the database, across every company. CIDB grading and extraction status come from the same
          real document reading every company&apos;s own pack already runs - not re-classified here. &quot;Tracking&quot;
          counts how many companies have a pack open against a tender, closed or not.
        </p>
        <p className="mb-4 text-xs text-muted-foreground/70">
          {rows.length} tender{rows.length === 1 ? "" : "s"} - {activeCount} still open, {extractedCount} extracted
          ({failedCount} with a parsing failure).
        </p>

        {error && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
            Couldn&apos;t load the tender catalog - try refreshing. If it keeps happening, let us know.
          </div>
        )}

        <TenderCatalogTable rows={rows} taxonomy={taxonomy} />
      </div>
    </AppShell>
  );
}
