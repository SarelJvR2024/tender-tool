/**
 * Task item 3 (app/AGENTS.md-level decision): turn the opaque "why is this
 * uncategorized/needs-review match here" into an honest, actionable nudge,
 * using data that already exists - no new schema.
 *
 * engine/discovery/assess_tender.py's assess_fit() has its own confirmed-
 * deliberate `elif not known_disciplines:` branch (an empty disciplines list
 * is "we don't know yet", not "we checked and this is out of scope") -
 * engine/discovery/company_profiles.py's profile_from_company_rows() computes
 * `known_disciplines` as:
 *
 *   sorted({d for i in items if i.get("tagged_at") for d in (i.get("disciplines") or [])})
 *
 * i.e. the union of disciplines on every Experience Library item that has
 * been TAGGED (tagged_at set) - untagged items don't count (same rule
 * app/app/experience/page.tsx's own untagged/tagged split already enforces
 * for its own Provide-type gap). This is the exact same condition, just read
 * from the app side (Supabase `experience_items` - the same table and the
 * same two columns, `disciplines`/`tagged_at`) instead of the Python engine
 * side - no new column, no new table, no scoring change.
 */

export type ExperienceDisciplineRow = {
  tagged_at: string | null;
  disciplines: string[] | null;
};

/**
 * True exactly when this company's `known_disciplines` (as the engine
 * computes it) would be empty - i.e. assess_fit()'s "we don't know yet"
 * branch is the reason a brand-new or not-yet-tagged company sees
 * "Needs review" on tenders that don't clearly match or not-match, rather
 * than a tighter, disciplines-aware verdict either way.
 */
export function hasNoTaggedDisciplines(items: ExperienceDisciplineRow[]): boolean {
  return !items.some((i) => i.tagged_at && (i.disciplines ?? []).length > 0);
}
