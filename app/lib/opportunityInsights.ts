// Pure, DB-free logic for the Opportunities card enrichment (Sarel's live
// feedback, 2026-10-22: "indicate ... if they have done similar tenders
// before"). Kept separate from app/app/discovery/page.tsx (which only reads
// Supabase and renders) so the matching rule is unit-testable without a
// database - same split as lib/marketTrendLogic.ts / lib/marketPricing.ts.
//
// PR #123 reconciliation note (2026-10-23): buildDoneHistory()'s own
// signature here is unchanged from the original PR #120 - it takes whatever
// rows the caller gives it and does not know or care whether the page is
// paginated. What changed is only what app/app/discovery/page.tsx now passes
// in: a dedicated, un-paginated "this company's own pursued opportunities"
// query, not the paginated/filtered `rows` window. See that page's own
// comment at the call site.

/** Reached at least a submitted bid - "found"/"bidding" alone isn't "done before". */
const DONE_STAGES = new Set(["submitted", "won", "lost"]);

export type PursuedRecord = { tenderId: string | null; buyer: string | null; categories: string[] | null };

export type HistoryEntry = { tenderId: string; buyer: string | null; categories: string[]; stage: string };

/** Loose match for a government buyer name across listings (no legal-entity
 * noise-word stripping like marketPricing.normName - that's for comparing a
 * COMPANY's own trading names, a different problem). */
function normBuyer(name: string | null): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Every one of this company's own opportunity rows that actually reached a
 * bid (tracked in tender_packs with a stage in DONE_STAGES) - the real
 * history to match new/open opportunities against. Pure function: takes
 * whatever rows the caller passes - the caller (page.tsx) is responsible for
 * passing this company's FULL pursued set, not a paginated window, since a
 * history match needs to never silently undercount.
 */
export function buildDoneHistory(opportunityRows: PursuedRecord[], stageByTenderId: Map<string, string>): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const r of opportunityRows) {
    if (!r.tenderId) continue;
    const stage = stageByTenderId.get(r.tenderId);
    if (!stage || !DONE_STAGES.has(stage)) continue;
    out.push({ tenderId: r.tenderId, buyer: r.buyer, categories: r.categories ?? [], stage });
  }
  return out;
}

export type SimilarHistory = { count: number; wonCount: number; sameBuyerCount: number; stages: string[] };

/** Past tenders (excluding the target itself) that share this one's buyer or
 * at least one discipline category. */
export function similarTendersBefore(
  target: { tenderId: string | null; buyer: string | null; categories: string[] | null },
  history: HistoryEntry[],
): SimilarHistory | null {
  const targetBuyer = normBuyer(target.buyer);
  const targetCategories = new Set((target.categories ?? []).filter((c) => !c.startsWith("uncategorized")));
  const matches = history.filter((h) => {
    if (h.tenderId === target.tenderId) return false;
    const sameBuyer = !!targetBuyer && normBuyer(h.buyer) === targetBuyer;
    const sameCategory = h.categories.some((c) => targetCategories.has(c));
    return sameBuyer || sameCategory;
  });
  if (matches.length === 0) return null;
  return {
    count: matches.length,
    wonCount: matches.filter((m) => m.stage === "won").length,
    sameBuyerCount: matches.filter((m) => !!targetBuyer && normBuyer(m.buyer) === targetBuyer).length,
    stages: [...new Set(matches.map((m) => m.stage))],
  };
}

/** The categories actually worth a market-pricing lookup for one card -
 * drops the "uncategorized:..." catch-all bucket, which has no taxonomy
 * group and is never a real discipline to benchmark against. */
export function pricingCategoriesFor(categories: string[] | null): string[] {
  return (categories ?? []).filter((c) => !c.startsWith("uncategorized"));
}

/** Stable key for deduping pricing lookups across many cards that share the
 * same discipline mix - see the page's MAX_PRICING_LOOKUPS cap. */
export function pricingSegmentKey(categories: string[]): string {
  return [...categories].sort().join("|");
}
