import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteNav } from "../../_components/SiteNav";
import RequirementItemTable from "./RequirementItemTable";
import type { RequirementItemRowData } from "./RequirementItemRow";

// Reads per-request session/DB data (platform_admin_low_confidence_requirement_items,
// gated by is_platform_admin() - 0074) - same escape hatch as every other admin page.
export const instant = false;

const DEFAULT_THRESHOLD = 60;

type Rpc = {
  tender_id: string;
  tender_title: string | null;
  tender_contract_no: string | null;
  tender_buyer: string | null;
  company_id: string | null;
  item_type: RequirementItemRowData["itemType"];
  item_key: string;
  item: Record<string, unknown>;
};

/**
 * Platform-admin review queue for engine/general/requirements.py's low-
 * confidence extraction items (migration 0074, per-item confidence work -
 * Sarel: "an admin-level review/correction mechanism that feeds back to
 * improve future confidence/accuracy"). Every item below the threshold,
 * across every tender's shared manifest AND every company's private-
 * document override, so an admin can mark each one correct / corrected /
 * false positive - which feeds extract_requirements()'s own few-shot
 * correction examples (see that function's comment, and the migration's).
 *
 * The confidence number here is 100% regex/heuristic (exact form match vs a
 * vague mention vs a poor OCR scan) - there is no LLM anywhere in this path,
 * so this page never calls it "AI confidence".
 */
export default async function AdminRequirementExtractionsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: actionError } = await searchParams;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("platform_admin_low_confidence_requirement_items", {
    p_threshold: DEFAULT_THRESHOLD,
    p_limit: 200,
  });
  if (error) console.error("platform_admin_low_confidence_requirement_items rpc failed", error);
  const rpcRows = (data ?? []) as Rpc[];

  const rows: RequirementItemRowData[] = rpcRows.map((r) => ({
    tenderId: r.tender_id,
    tenderTitle: r.tender_title,
    tenderContractNo: r.tender_contract_no,
    tenderBuyer: r.tender_buyer,
    companyId: r.company_id,
    itemType: r.item_type,
    itemKey: r.item_key,
    item: r.item,
  }));

  return (
    <div style={{ minHeight: "100vh", fontFamily: "system-ui, sans-serif", background: "#FFFFFF" }}>
      <SiteNav active="admin" />

      <div style={{ padding: "24px 32px", maxWidth: 1200, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ display: "flex", gap: 14, fontSize: 13, marginBottom: 12, flexWrap: "wrap" }}>
          <Link href="/admin" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Alerts &amp; harness results</Link>
          <Link href="/admin/customers" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Customers</Link>
          <Link href="/admin/settings" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Settings</Link>
          <Link href="/admin/taxonomy" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Discipline list</Link>
          <Link href="/admin/discovered-opportunities" style={{ color: "#D97706", textDecoration: "none", fontWeight: 600 }}>Discovered opportunities</Link>
          <span style={{ color: "#16233B", fontWeight: 600 }}>Requirement extractions</span>
        </div>

        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#16233B", margin: "0 0 4px" }}>Requirement extractions below {DEFAULT_THRESHOLD}/100</h1>
        <p style={{ fontSize: 13, color: "#5B6472", margin: "0 0 10px", maxWidth: 860 }}>
          Every form, buyer form, returnable, role, person registration, CIDB and briefing item that
          engine/general/requirements.py read out of a tender&apos;s documents with a confidence below {DEFAULT_THRESHOLD}, across
          every tender&apos;s shared manifest and every company&apos;s own private-document override. This confidence is
          regex/heuristic pattern-matching against the actual documents (an exact form match scores high, a vague mention
          or a poorly scanned page scores low) - there is no AI model reading these, so don&apos;t read this as a machine
          judging itself; it&apos;s just how strong the match was. Mark each item correct, corrected, or a false positive -
          those verdicts feed back into future extractions.
        </p>
        <p style={{ fontSize: 12, color: "#8A93A0", margin: "0 0 16px" }}>
          {rows.length} item{rows.length === 1 ? "" : "s"} below threshold.
        </p>

        {(error || actionError) && (
          <div style={{ background: "#FEE2E2", border: "1px solid #FCA5A5", borderRadius: 9, padding: "11px 16px", marginBottom: 20, fontSize: 13, color: "#B91C1C" }}>
            {error ? "Couldn't load the review queue - try refreshing. If it keeps happening, let us know." : actionError}
          </div>
        )}

        <RequirementItemTable rows={rows} />
      </div>
    </div>
  );
}
