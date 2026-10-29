// A company's stated preferred clients/buyers (company_tender_preferences.
// preferred_buyers, migration 0104) vs. one discovered_opportunity's own
// buyer (discovered_opportunities.buyer, migration 0004 - raw text straight
// from whichever source scraper read it, never normalised - confirmed by
// grep, no canonical buyer table/view exists anywhere in this repo). Same
// additive, never-hides-a-row sort-boost role as
// lib/opportunityDisciplineMatch.ts's matchesInterestedDisciplines() - this
// never changes discovered_opportunities.verdict and never removes a row,
// only moves a matching one earlier within whatever tab/window is already
// showing. Because there is no canonical buyer list (unlike disciplines,
// which have a real taxonomy, migration 0040), matching here is a plain
// case-insensitive substring check in both directions, not an exact slug
// comparison - "SANRAL" should match a row whose buyer is "South African
// National Roads Agency SOC Ltd (SANRAL)" and vice versa.

const MAX_PREFERRED_BUYERS = 25;
const MAX_BUYER_LENGTH = 120;

/** Case/whitespace-insensitive key for deduping and matching. */
function normaliseBuyer(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Never trust the client's array blindly, same "degrade, don't throw, don't
 * pass through garbage" discipline SLUG_RE validation uses for disciplines -
 * there is no fixed taxonomy to validate a buyer name against, so this caps
 * shape instead: trims, drops empty/oversized entries, dedupes case-
 * insensitively (keeping the first-seen casing), caps the list length.
 */
export function sanitizePreferredBuyers(raw: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw ?? []) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().replace(/\s+/g, " ");
    if (!trimmed || trimmed.length > MAX_BUYER_LENGTH) continue;
    const key = normaliseBuyer(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_PREFERRED_BUYERS) break;
  }
  return out;
}

/**
 * True when this company has stated no preferred buyers yet, the tender
 * itself has no buyer on file, or one of the preferred names is a
 * substring of (or contains) the tender's buyer, case-insensitively.
 */
export function matchesPreferredBuyers(preferredBuyers: string[], buyer: string | null): boolean {
  if (preferredBuyers.length === 0) return true;
  if (!buyer || !buyer.trim()) return true;
  const normalisedBuyer = normaliseBuyer(buyer);
  return preferredBuyers.some((p) => {
    const normalisedPreferred = normaliseBuyer(p);
    return normalisedPreferred.length > 0 && (normalisedBuyer.includes(normalisedPreferred) || normalisedPreferred.includes(normalisedBuyer));
  });
}
