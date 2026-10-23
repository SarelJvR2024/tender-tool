// A company's stated discipline interest (company_tender_preferences.
// interested_disciplines, migration 0087) vs. one discovered_opportunity's
// own categories (discovered_opportunities.categories, migration 0004 - the
// scoring engine's own fit-scoring output, discipline_categories/0040 slugs).
// Used by app/app/discovery/page.tsx to sort matching opportunities first
// within the current verdict tab - additive (never removes a row, never
// changes verdict), same honesty principle assess_tender.py's own
// known_disciplines branch and disciplineTaggingNudge.ts already apply: "we
// don't know yet" is never treated as "out of scope".

import { expandDisciplines, type DisciplineTaxonomy } from "./disciplineTaxonomy.ts";

/**
 * True when this company has either stated no discipline preference yet, the
 * tender itself has no categories to compare against, or the two overlap.
 * Expands BOTH sides (same expandDisciplines() call page.tsx's own market-
 * pricing lookup already makes on an opportunity's categories) so a company
 * that selected a whole group matches a tender tagged with one of that
 * group's specific children, and a tender tagged only with a group matches a
 * company that selected one of that group's specific children.
 */
export function matchesInterestedDisciplines(
  taxonomy: DisciplineTaxonomy,
  interestedDisciplines: string[],
  categories: string[] | null,
): boolean {
  if (interestedDisciplines.length === 0) return true;
  if (!categories || categories.length === 0) return true;
  const expandedInterest = new Set(expandDisciplines(taxonomy, interestedDisciplines));
  const expandedCategories = expandDisciplines(taxonomy, categories);
  return expandedCategories.some((c) => expandedInterest.has(c));
}
