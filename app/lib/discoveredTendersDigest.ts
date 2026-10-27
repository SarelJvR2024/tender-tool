// Pure logic for scripts/send-discovered-tenders.ts, split out so it's
// unit-testable without a live Supabase connection - same convention as
// lib/corrigendumAlerts.ts for its own sender script.
import type { DiscoveredTenderCard } from "./emailTemplatesTier1.ts";

export type DiscoveredOpportunityRow = {
  id: string;
  company_id: string;
  contract_number: string | null;
  buyer: string | null;
  title: string | null;
  description: string | null;
  etenders_category: string | null;
  categories: string[] | null;
  closing_date: string | null;
  verdict: string | null;
};

/**
 * Maps one discovered_opportunities row to a digest card. cidbGrading is
 * always null - confirmed by reading every migration, this schema has no
 * per-TENDER CIDB-grade-required field anywhere (CIDB only exists as the
 * company's own cidb_grading on `companies`, a different fact entirely).
 * Rather than fabricate one, the card's own "Category / CIDB" row degrades
 * to category-only when there's nothing else to show - see
 * discoveredTendersDigestEmail's own row-building for the fallback.
 */
export function toDiscoveredTenderCard(row: DiscoveredOpportunityRow): DiscoveredTenderCard {
  return {
    id: row.id,
    contractNumber: row.contract_number,
    buyer: row.buyer,
    title: row.title || row.description,
    category: row.etenders_category || row.categories?.[0] || null,
    cidbGrading: null,
    closingDate: row.closing_date,
    verdict: (row.verdict as DiscoveredTenderCard["verdict"]) || "needs_review",
  };
}

/** The stable idempotency key for this one opportunity row - never includes anything that could change between runs (not title/closing_date, which can be corrected later), so a later correction to the same row doesn't trigger a second email about it. */
export function discoveredTenderIdempotencyKey(opportunityId: string): string {
  return `discovered-tender-${opportunityId}`;
}
