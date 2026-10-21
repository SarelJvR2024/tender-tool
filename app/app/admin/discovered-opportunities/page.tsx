import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../../_components/AppShell";
import { AdminNav } from "../AdminNav";
import OpportunityTable from "./OpportunityTable";
import type { OpportunityRowData } from "./OpportunityRow";
import { assessCompileConfidence, assessCompileReadiness, effectiveConfidence } from "@/lib/compileReadiness";

// Reads per-request session/DB data (platform_admin_discovered_opportunities,
// gated by is_platform_admin() - 0043/0072), same escape hatch as ../page.tsx.
export const instant = false;

type Rpc = {
  id: string; company_id: string; company_name: string;
  contract_number: string | null; buyer: string | null; title: string | null; closing_date: string | null;
  categories: string[] | null; document_depth: string | null; verdict: string | null; reasons: string[] | null;
  source: string | null; tender_type: string | null; province: string | null; listing_status: string | null;
  document_urls: { url?: string | null; title?: string | null }[] | null;
  score_outlook: unknown; downgraded_from: string | null; first_seen: string; tender_id: string | null;
  requirements_status: "not_downloaded" | "extracted";
  requirements_route: "sanral" | "general" | null;
  requirements_family: string | null;
  requirements_signal: string | null;
  requirements_documents: unknown;
  requirements_missing: string[] | null;
  requirements_fingerprint_status: "ok" | "mismatch" | "no_baseline" | "error" | null;
  requirements_unreadable: string[] | null;
  requirements_failed_downloads: number | null;
  requirements_document_count: number | null;
  confidence_override: number | null;
  confidence_override_note: string | null;
  confidence_overridden_at: string | null;
};

/**
 * Super admin review of every discovered opportunity, across every company
 * (Sarel, 2026-10-19: "I need to be able to review what came in and if our
 * engines understand and interpret and can compile each one" - plus, same
 * day, the confidence-level scope addition). Migration 0072:
 * platform_admin_discovered_opportunities() (cross-tenant read, same
 * is_platform_admin() escape hatch as /admin/customers),
 * discovered_opportunity_requirements (engine/discovery/opportunity_requirements.py's
 * real classification of a release's downloaded documents), and
 * platform_admin_override_opportunity_confidence() for Sarel's own
 * correction. See lib/compileReadiness.ts for exactly what the status and
 * confidence number can and can't honestly tell a reviewer - this page does
 * no classification of its own, only renders what that module and the RPC
 * already computed.
 */
export default async function AdminDiscoveredOpportunitiesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("platform_admin_discovered_opportunities");
  if (error) console.error("platform_admin_discovered_opportunities rpc failed", error);
  const rpcRows = (data ?? []) as Rpc[];

  const rows: OpportunityRowData[] = rpcRows.map((r) => {
    const readinessInput = {
      source: r.source, document_urls: r.document_urls ?? [], categories: r.categories ?? [],
      reasons: r.reasons ?? [], score_outlook: r.score_outlook,
    };
    const readiness = assessCompileReadiness(readinessInput);
    const requirements = r.requirements_status === "extracted"
      ? {
          status: "extracted" as const, route: r.requirements_route, family: r.requirements_family,
          fingerprint_status: r.requirements_fingerprint_status, missing: r.requirements_missing ?? [],
          unreadable_documents: r.requirements_unreadable ?? [], failed_downloads: r.requirements_failed_downloads ?? 0,
        }
      : { status: "not_downloaded" as const };
    const computedConfidence = assessCompileConfidence(readinessInput, requirements);
    const effective = effectiveConfidence(computedConfidence, {
      level: r.confidence_override, note: r.confidence_override_note,
    });
    return {
      id: r.id, company_name: r.company_name, contract_number: r.contract_number, buyer: r.buyer, title: r.title,
      closing_date: r.closing_date, verdict: r.verdict, source: r.source, tender_type: r.tender_type,
      province: r.province, first_seen: r.first_seen, document_urls: r.document_urls ?? [],
      requirements_status: r.requirements_status, requirements_route: r.requirements_route,
      requirements_family: r.requirements_family, requirements_signal: r.requirements_signal,
      requirements_missing: r.requirements_missing, confidence_override: r.confidence_override,
      confidence_override_note: r.confidence_override_note,
      readiness, computedConfidence, effective,
    };
  });

  const flaggedCount = rows.filter((r) => r.readiness.status === "flagged").length;
  const readyCount = rows.filter((r) => r.readiness.status === "looks_ready").length;
  const extractedCount = rows.filter((r) => r.requirements_status === "extracted").length;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1200px] p-4 sm:p-6 md:px-8 md:py-6">
        <AdminNav active="discovered-opportunities" />

        <h1 className="mb-1 font-display text-[22px] font-bold text-foreground">Discovered opportunities</h1>
        <p className="mb-2.5 max-w-[820px] text-[13px] text-muted-foreground">
          Every tender/RFQ/RFP/EOI Discovery has scored, for every company - not scoped to one tenant. Each row&apos;s
          &quot;compile-readiness&quot; is an honest, listing-level signal (no documents are downloaded for an opportunity
          nobody has pursued yet); once the separate document-download step has fetched a release&apos;s files, &quot;requirements
          extraction&quot; runs the real intake classifier against them and the confidence number reflects what was actually
          found, not a guess. See lib/compileReadiness.ts for exactly what each status/number can and cannot tell you.
        </p>
        <p className="mb-4 text-xs text-muted-foreground/70">
          {rows.length} opportunit{rows.length === 1 ? "y" : "ies"} - {flaggedCount} flagged, {readyCount} look ready,{" "}
          {extractedCount} have real requirements extracted.
        </p>

        {(error || actionError) && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
            {error ? "Couldn't load discovered opportunities - try refreshing. If it keeps happening, let us know." : actionError}
          </div>
        )}

        <OpportunityTable rows={rows} />
      </div>
    </AppShell>
  );
}
