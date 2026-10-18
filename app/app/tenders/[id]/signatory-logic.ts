/**
 * Picking a default signatory out of a company's several recorded
 * signatories (migration 0061, signatory_scopes), scored against one
 * tender's own region/industry/discipline tags. Pure, no Supabase - same
 * "testable without a database" split as pack-review-logic.ts.
 *
 * Advisory only (Sarel, 2026-10-18): this never removes anyone from the
 * list the company can pick from - it only decides which one is
 * pre-selected when nobody has chosen yet. The caller is always free to
 * submit a different signatory_person_id.
 */

export type Signatory = { id: string; name: string; signatory_capacity: string };

export type SignatoryScope = {
  person_id: string;
  region: string | null;
  industry_tag: string | null;
  discipline_tag: string | null;
};

export type TenderScopeTags = {
  region: string | null;
  industryTags: string[];
  disciplineTags: string[];
};

/**
 * Score one person's scope rows against a tender. A discipline-tag match
 * is the most specific signal (2 points), an industry-tag or region match
 * is broader (1 point each); a person can rack up more than one row's
 * worth of points if several of their scopes line up with this tender.
 * Unscoped (no rows) scores 0, same as a scoped person none of whose rows
 * match - both fall back to "no particular preference" before being broken
 * by list order.
 */
function scoreFor(personId: string, scopes: SignatoryScope[], tender: TenderScopeTags): number {
  let score = 0;
  for (const s of scopes) {
    if (s.person_id !== personId) continue;
    if (s.discipline_tag && tender.disciplineTags.includes(s.discipline_tag)) score += 2;
    if (s.industry_tag && tender.industryTags.includes(s.industry_tag)) score += 1;
    if (s.region && tender.region && s.region.trim().toLowerCase() === tender.region.trim().toLowerCase()) score += 1;
  }
  return score;
}

/**
 * The default to pre-select when nobody has chosen a signatory for this
 * tender yet: the highest-scoring signatory, ties broken by list order
 * (callers pass `signers` oldest-first, same as the pre-existing "first
 * signatory on file" fallback) - a tie, or no scope data at all, keeps that
 * same familiar behaviour. Returns null only when there are no signers.
 */
export function pickDefaultSignatory(input: {
  signers: Signatory[];
  scopes: SignatoryScope[];
  tender: TenderScopeTags;
}): Signatory | null {
  if (input.signers.length === 0) return null;
  let best = input.signers[0];
  let bestScore = scoreFor(best.id, input.scopes, input.tender);
  for (const s of input.signers.slice(1)) {
    const score = scoreFor(s.id, input.scopes, input.tender);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** Empty tag set - used where a tender hasn't been enriched (0060) yet. */
export const NO_TENDER_SCOPE: TenderScopeTags = { region: null, industryTags: [], disciplineTags: [] };
