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

export const DISCOVERED_TENDER_VERDICTS = ["strong_fit", "possible", "needs_review"] as const;

/**
 * Bounds scripts/send-discovered-tenders.ts's own candidate query - which
 * rows are still worth a "newly discovered tender" email, regardless of how
 * long ago they were discovered. Standing review, 2026-11-07: the prior
 * bound was a fixed 2-day `created_at` window (same shape
 * send-corrigendum-alerts.ts uses, just much narrower), which this file's
 * own header comment already flagged as a real, if improved-not-closed,
 * gap - a company with zero opted-in recipients for MORE than 2 days loses
 * whichever opportunities aged out of that window before a recipient ever
 * appeared, permanently and silently (they fall out of the query, never
 * claimed, never retried, even once that company later adds a recipient).
 *
 * Replaced the creation-date window with the thing that actually decides
 * whether this email is still worth sending: has the tender's own closing
 * date passed. A tender that already closed is never worth a "newly
 * discovered" digest about, no matter when it was discovered - so bounding
 * on `closing_date` closes the gap outright instead of just widening it,
 * while staying naturally bounded: the set of currently-open tenders any
 * company has ever been matched against does not grow without bound the
 * way `discovered_opportunities`' own full history does (that table's
 * `verdict` column is set once at discovery/re-score time and is never
 * swept back to `closed` as a tender's own deadline later passes -
 * confirmed by reading every writer of that column - which is exactly why
 * `created_at` windowing was load-bearing here in the first place, and
 * exactly why it's the wrong axis: `closing_date`, not `created_at` or
 * `verdict`, is the one field that tracks whether this is still live).
 * `closing_date is null` is kept in (never known to have closed) rather
 * than excluded, the same "don't know, so don't drop it" rule this engine
 * already follows elsewhere.
 */
export function openDiscoveredOpportunityWindow(now: Date = new Date()): { verdicts: readonly string[]; closingDateOrFilter: string } {
  return {
    verdicts: DISCOVERED_TENDER_VERDICTS,
    closingDateOrFilter: `closing_date.is.null,closing_date.gte.${now.toISOString()}`,
  };
}
