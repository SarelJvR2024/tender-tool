// A company's stated discipline interest (company_tender_preferences.
// interested_disciplines, migration 0088) vs. one discovered_opportunity's
// own categories (discovered_opportunities.categories, migration 0004 - the
// scoring engine's own fit-scoring output, discipline_categories/0040 slugs).
// Used by app/app/discovery/page.tsx to sort matching opportunities first
// within the current verdict tab - additive (never removes a row, never
// changes verdict), same honesty principle assess_tender.py's own
// known_disciplines branch and disciplineTaggingNudge.ts already apply: "we
// don't know yet" is never treated as "out of scope".

import { expandDisciplines, type DisciplineTaxonomy } from "./disciplineTaxonomy.ts";

/**
 * Standing review, 2026-11-04: a company's INTEREST side must not expand a
 * selected group to every one of its children unconditionally - the same
 * matched_by_group_tag flag (0058) engine/discovery/taxonomy.py's
 * fit_overlap() already uses to split "exact" from "peripheral" (a company
 * tagged professional_services is not thereby a property valuer). The live
 * seed (config/discipline_taxonomy.json) has 17 real children with this flag
 * off, e.g. rail_infrastructure under roads_civil - selecting just "Roads &
 * Civil" must not sort rail-tagged tenders to the top as a confident match.
 * The TENDER's own categories side keeps the unrestricted expandDisciplines()
 * (a tender known only at group level still broadly matches a company's
 * specific child interest - taxonomy.py's "broad" bucket, never excluded).
 */
function expandGroupTagMatchingInterests(t: DisciplineTaxonomy, slugs: string[]): string[] {
  const out = new Set(slugs);
  for (const s of slugs) for (const c of t.categories) if (c.parent_slug === s && c.matched_by_group_tag) out.add(c.slug);
  return Array.from(out);
}

/**
 * True when this company has either stated no discipline preference yet, the
 * tender itself has no categories to compare against, or the two overlap.
 * The tender's own categories expand unrestricted (expandDisciplines(), same
 * call page.tsx's own market-pricing lookup already makes) so a tender
 * tagged only with a group still matches a company that selected one of that
 * group's specific children. The company's own interest expands via
 * expandGroupTagMatchingInterests() instead, so a company that selected a
 * whole group only counts as matching that group's children whose own
 * matched_by_group_tag is on - not every child regardless of fit.
 */
export function matchesInterestedDisciplines(
  taxonomy: DisciplineTaxonomy,
  interestedDisciplines: string[],
  categories: string[] | null,
): boolean {
  if (interestedDisciplines.length === 0) return true;
  if (!categories || categories.length === 0) return true;
  const expandedInterest = new Set(expandGroupTagMatchingInterests(taxonomy, interestedDisciplines));
  const expandedCategories = expandDisciplines(taxonomy, categories);
  return expandedCategories.some((c) => expandedInterest.has(c));
}
