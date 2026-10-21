import { createClient } from "@/lib/supabase/server";
import { AppShell } from "../../_components/AppShell";
import { AdminNav } from "../AdminNav";
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
    <AppShell>
      <div className="mx-auto w-full max-w-[1200px] p-4 sm:p-6 md:px-8 md:py-6">
        <AdminNav active="requirement-extractions" />

        <h1 className="mb-1 font-display text-[22px] font-bold text-foreground">Requirement extractions below {DEFAULT_THRESHOLD}/100</h1>
        <p className="mb-2.5 max-w-[860px] text-[13px] text-muted-foreground">
          Every form, buyer form, returnable, role, person registration, CIDB and briefing item that
          engine/general/requirements.py read out of a tender&apos;s documents with a confidence below {DEFAULT_THRESHOLD}, across
          every tender&apos;s shared manifest and every company&apos;s own private-document override. This confidence is
          regex/heuristic pattern-matching against the actual documents (an exact form match scores high, a vague mention
          or a poorly scanned page scores low) - there is no AI model reading these, so don&apos;t read this as a machine
          judging itself; it&apos;s just how strong the match was. Mark each item correct, corrected, or a false positive -
          those verdicts feed back into future extractions.
        </p>
        <p className="mb-4 text-xs text-muted-foreground/70">
          {rows.length} item{rows.length === 1 ? "" : "s"} below threshold.
        </p>

        {(error || actionError) && (
          <div className="mb-5 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-[13px] text-destructive">
            {error ? "Couldn't load the review queue - try refreshing. If it keeps happening, let us know." : actionError}
          </div>
        )}

        <RequirementItemTable rows={rows} />
      </div>
    </AppShell>
  );
}
