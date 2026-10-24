// Tender Ready's own discipline / category list (migration 0040,
// discipline_categories). Sarel, 2026-10-17: "There is no standard list ...
// build our own list ... a list that we're gonna have to maintain and build."
// It is a table, not a code constant: a category added to the table
// (engine/discovery/taxonomy.py add) shows up here - Experience Library
// suggestions, the pricing sector list - with no deploy and no migration.
//
// Two levels: a group (parent_slug null) and its disciplines. The 7 keys
// Tender Ready started with are group slugs, so old tags still resolve.
// Evidence for the seed: docs/specs/Discipline-Taxonomy-Findings.md.

import type { SupabaseClient } from "@supabase/supabase-js";
// Relative, not the "@/" alias (both resolve to the same file - this is the
// same directory): opportunityDisciplineMatch.test.ts (node:test, task item
// 5) is this file's first unit-test importer, and plain
// `node --experimental-strip-types` has no tsconfig "paths" resolution for
// "@/..." the way `tsx`/Next.js's bundler do - a relative import here is the
// only form every one of this repo's required test runners can resolve.
import { DISCIPLINES, disciplineLabel } from "./experience.ts";

export type DisciplineCategory = {
  slug: string;
  label: string;
  parent_slug: string | null;
  sort_order: number;
  /**
   * 0058: does a company tagged with this discipline's GROUP count as doing
   * it? Off for disciplines the group's name doesn't really claim (tagged
   * professional_services is not a claim to be a property valuer) - see
   * engine/discovery/taxonomy.py fit_overlap(). Always true on a group row.
   */
  matched_by_group_tag: boolean;
};

export type DisciplineTaxonomy = {
  categories: DisciplineCategory[];
  /** "table" = the live list; "fallback" = the table couldn't be read (shown to the user). */
  source: "table" | "fallback";
  error: string | null;
};

export type DisciplineGroup = { group: DisciplineCategory; children: DisciplineCategory[] };

/** Used only when the table can't be read (e.g. 0040 not applied yet): the 7 original groups. */
export const FALLBACK_TAXONOMY: DisciplineTaxonomy = {
  categories: DISCIPLINES.map((d, i) => ({ slug: d.value, label: d.label, parent_slug: null, sort_order: (i + 1) * 10, matched_by_group_tag: true })),
  source: "fallback",
  error: null,
};

export async function loadDisciplineTaxonomy(supabase: SupabaseClient): Promise<DisciplineTaxonomy> {
  const { data, error } = await supabase
    .from("discipline_categories")
    .select("slug, label, parent_slug, sort_order, matched_by_group_tag")
    .eq("active", true)
    .order("sort_order");
  if (error || !data || data.length === 0) {
    return { ...FALLBACK_TAXONOMY, error: error?.message ?? "discipline_categories is empty" };
  }
  return { categories: data as DisciplineCategory[], source: "table", error: null };
}

/** Groups in list order, each with its disciplines. */
export function taxonomyGroups(t: DisciplineTaxonomy): DisciplineGroup[] {
  const groups = t.categories.filter((c) => !c.parent_slug);
  return groups.map((g) => ({ group: g, children: t.categories.filter((c) => c.parent_slug === g.slug) }));
}

/** The list's label for a slug; a company's own tag (not on the list) in words. */
export function taxonomyLabel(t: DisciplineTaxonomy, slug: string): string {
  return t.categories.find((c) => c.slug === slug)?.label ?? disciplineLabel(slug);
}

export function isTaxonomySlug(t: DisciplineTaxonomy, slug: string): boolean {
  return t.categories.some((c) => c.slug === slug);
}

export function parentOf(t: DisciplineTaxonomy, slug: string): string | null {
  return t.categories.find((c) => c.slug === slug)?.parent_slug ?? null;
}

/**
 * Strips a leaked taxonomy slug from a stored opportunity "reason" string -
 * "Label (slug)" -> "Label". engine/discovery/assess_tender.py's labels()
 * used to append the raw slug in parens after its own human label "for
 * internal debugging", but it leaked into this user-facing discovery copy
 * (Batch 2B's own fix for that, Sarel's live feedback) - discovered_opportunities.reasons
 * is only ever rewritten when a tender is re-scored for a company that
 * hasn't already seen it, so a row scored before that fix keeps the old
 * text verbatim. Only strips a parenthetical made entirely of lowercase
 * snake_case characters - a real parenthetical already in a label (e.g.
 * "(UPS)", "(Re-Advert)") never matches that shape, so this can't eat
 * genuine content.
 */
export function stripLeakedTaxonomySlugs(text: string): string {
  return text.replace(/ \([a-z][a-z0-9_]*\)/g, "");
}

/**
 * A group stands for every discipline in it: experience tagged
 * "road_maintenance" is roads_civil experience. Returns the slugs plus the
 * children of any group among them, for the experience_matches() overlap
 * query. A discipline does NOT widen to its group (a geotechnical tender is
 * not matched by an item tagged only "professional_services").
 */
export function expandDisciplines(t: DisciplineTaxonomy, slugs: string[]): string[] {
  const out = new Set(slugs);
  for (const s of slugs) for (const c of t.categories) if (c.parent_slug === s) out.add(c.slug);
  return Array.from(out);
}

/** Same slug format as 0036 tt_all_slugs() / 0040 discipline_categories.slug / taxonomy.py SLUG_RE. */
export const SLUG_RE = /^[a-z][a-z0-9_]{0,62}$/;

/** "a, b*, c & d" -> ["a", "b*", "c & d"] (the keyword syntax taxonomy.py matches). */
export function splitKeywords(s: string, sep: string = ","): string[] {
  return Array.from(new Set(s.split(sep).map((k) => k.trim()).filter(Boolean)));
}

/** Every column the admin screen edits (0040), including retired rows. */
export type DisciplineCategoryFull = DisciplineCategory & {
  keywords: string[];
  exclude_keywords: string[];
  etenders_categories: string[];
  l2b_categories: string[];
  cidb_classes: string[];
  active: boolean;
  added_from: string | null;
  updated_at: string;
};
export const DISCIPLINE_CATEGORY_FULL_COLUMNS =
  "slug, label, parent_slug, sort_order, matched_by_group_tag, keywords, exclude_keywords, etenders_categories, l2b_categories, cidb_classes, active, added_from, updated_at";
