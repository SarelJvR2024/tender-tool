import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "../../_components/SiteNav";
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
    <div style={{ minHeight: "100vh", fontFamily: "system-ui, sans-serif", background: "#FFFFFF" }}>
      <SiteNav active="admin" />

      <div style={{ padding: "24px 32px", maxWidth: 1200, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", gap: 14, fontSize: 13, marginBottom: 12, flexWrap: "wrap" }}>
          <Link href="/admin" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Alerts &amp; harness results</Link>
          <Link href="/admin/customers" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Customers</Link>
          <Link href="/admin/settings" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Settings</Link>
          <Link href="/admin/taxonomy" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Discipline list</Link>
          <span style={{ color: "#16233B", fontWeight: 600 }}>Discovered opportunities</span>
          <Link href="/admin/requirement-extractions" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Requirement extractions</Link>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Discovered opportunities</h1>
        <p style={{ fontSize: 13, color: "#5B6472", margin: "0 0 10px", maxWidth: 820 }}>
          Every tender/RFQ/RFP/EOI Discovery has scored, for every company - not scoped to one tenant. Each row&apos;s
          &quot;compile-readiness&quot; is an honest, listing-level signal (no documents are downloaded for an opportunity
          nobody has pursued yet); once the separate document-download step has fetched a release&apos;s files, &quot;requirements
          extraction&quot; runs the real intake classifier against them and the confidence number reflects what was actually
          found, not a guess. See lib/compileReadiness.ts for exactly what each status/number can and cannot tell you.
        </p>
        <p style={{ fontSize: 12, color: "#8A93A0", margin: "0 0 16px" }}>
          {rows.length} opportunit{rows.length === 1 ? "y" : "ies"} - {flaggedCount} flagged, {readyCount} look ready,{" "}
          {extractedCount} have real requirements extracted.
        </p>

        {(error || actionError) && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 20, fontSize: 13, color: "#B91C1C" }}>
            {error ? "Couldn't load discovered opportunities - try refreshing. If it keeps happening, let us know." : actionError}
          </div>
        )}

        <OpportunityTable rows={rows} />
      </div>
    </div>
  );
}
