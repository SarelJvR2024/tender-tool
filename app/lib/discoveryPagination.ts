/**
 * Discovery page scaling fix (Sarel, 2026-10-23: "filtering tenders is going
 * to be critical with the load, we need to be smart about how we manage
 * that"). `discovered_opportunities` is a per-company table that accumulates
 * one row for every OCDS release ever scored against that company, forever -
 * no retention/archival exists (see app/AGENTS.md for the proposal, not
 * built here). The Discovery page used to `.select(...)` that whole table on
 * every load with no `.range()`/`.limit()` at all, then do every bit of
 * verdict/changed/reassessed filtering in JS over the full in-memory array.
 *
 * Same class of bug as `lib/marketPricing.ts`'s own `fetchAllRows()` fix
 * (PR #111, "Fix Market Intelligence silently reading a 2.5% sample, not the
 * real table"): PostgREST silently caps any single `.select()` response at
 * 1000 rows (`db-max-rows`, confirmed live in that PR's own investigation) -
 * regardless of a client-side `.limit()` past that. An unpaginated discovery
 * fetch isn't just slow; once a company's scored history passes 1000 rows it
 * silently truncates and starts showing wrong counts/filters. This module is
 * the pure, testable half of the fix - the page itself (`page.tsx`) wires
 * these into real Supabase queries, which this sandbox has no live project to
 * exercise (same standing gap as every other page in this codebase - see
 * docs/specs/System-Status.md).
 *
 * Pagination shape chosen: a monotonically GROWING `.range(0, show)` limit
 * from the start of the (indexed) `first_seen desc` order, not true
 * cursor/keyset pagination and not classic increasing-OFFSET pagination
 * either. Documented tradeoff (see the PR description for the fuller
 * version): true keyset (`WHERE (first_seen, id) < (cursor)`) is what the
 * task asked us to prefer, and the index
 * (`discovered_opportunities_company_first_seen_idx`) supports it directly -
 * but expressing that compound tuple comparison in supabase-js means a
 * hand-rolled `.or()`/`.and()` PostgREST filter string, which this sandbox
 * cannot verify against a live database (no live Supabase session - standing
 * disclosure, see System-Status.md). A silently-wrong hand-rolled filter
 * string is a worse failure mode than the one being fixed. Growing-limit:
 *  - uses only `.order()` + `.range()`, both ordinary supabase-js calls with
 *    no custom filter strings to get subtly wrong;
 *  - never skips or duplicates rows under concurrent inserts the way
 *    classic OFFSET pagination can (there is no offset - "Load more" always
 *    re-asks for "the top `show` rows", so a new row inserted between clicks
 *    simply appears at the top of a bigger, still-fully-consistent window,
 *    the same way a refreshed inbox shows new mail at the top - never a
 *    skipped or duplicated row);
 *  - costs re-transferring already-seen rows on every "Load more" click
 *    instead of only the incremental delta, bounded by `MAX_SHOW` below so
 *    that cost stays small and always far under PostgREST's 1000-row cap.
 * True keyset is a reasonable follow-up once there is a way to verify a
 * compound PostgREST filter against a real project; noted in the PR, not
 * attempted blind here.
 */

export const PAGE_SIZE = 30;

// 10 "Load more" clicks worth - comfortably under PostgREST's confirmed
// 1000-row db-max-rows cap (see the module comment / marketPricing.ts), and a
// sane point past which a company should narrow with the filter tabs instead
// of scrolling an ever-longer single list.
export const MAX_SHOW = 300;

/**
 * Parses the `show` search param into a safe row count: a positive multiple
 * of PAGE_SIZE (rounded down to the nearest one, minimum PAGE_SIZE), clamped
 * to MAX_SHOW. Never throws - a missing, garbage, or out-of-range value
 * degrades to the PAGE_SIZE default rather than erroring the page.
 */
export function parseShowParam(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(n) || n <= 0) return PAGE_SIZE;
  const rounded = Math.max(PAGE_SIZE, Math.floor(n / PAGE_SIZE) * PAGE_SIZE);
  return Math.min(rounded, MAX_SHOW);
}

/** The `show` value a "Load more" click should move to - clamped, never past MAX_SHOW. */
export function nextShow(show: number): number {
  return Math.min(show + PAGE_SIZE, MAX_SHOW);
}

/**
 * Fetch `show + 1` rows (via `.range(0, show)`) and slice to `show` for
 * display - the standard "fetch one extra" trick to know for certain whether
 * there is a further row waiting, without an extra count query. `fetched` is
 * the raw row count the query actually returned (before slicing).
 */
export function hasMore(fetchedCount: number, show: number): boolean {
  return fetchedCount > show;
}

/** Can "Load more" still move the window forward, independent of whether a further row exists? */
export function canLoadMore(show: number, fetchedHasMore: boolean): boolean {
  return fetchedHasMore && show < MAX_SHOW;
}

// "declined" (migration 0089) is a different axis from the rest of this list
// - it's the company's own interest_marker column, not the engine-computed
// verdict - but it's kept in the same exclusive, single-select tab list as
// "reassessed" (downgraded_from) and "changed" (no column at all): this list
// was never strictly "verdict values" to begin with, it's "what the
// Opportunities page's one row of filter tabs can show at a time". See
// page.tsx's own FILTERS array comment for why this composes as one more
// exclusive tab rather than a second, independent toggle.
export type VerdictFilter = "all" | "strong_fit" | "needs_review" | "not_a_fit" | "changed" | "reassessed" | "declined";

/**
 * The verdict-to-query-filter mapping (task item 3 + 4): a declarative,
 * pure description of what each tab should push down to the
 * `discovered_opportunities` query, kept separate from the Supabase call
 * itself so it can be unit tested without a client. `changed` has no SQL
 * shape (needs a cross-reference against `tender_listing_changes`, not a
 * column on this row) - callers fall back to the unfiltered "all" order and
 * filter in JS over whatever page is in view (the documented scoped
 * limitation; see app/AGENTS.md). `reassessed` DOES reduce to a real,
 * indexed-adjacent column predicate (`downgraded_from is not null`) - the
 * task flagged this as worth checking, and it checks out: unlike `changed`,
 * Re-assessed can be a genuine full-history filter, not a page-scoped one.
 */
export type VerdictQuerySpec =
  | { kind: "none" }
  | { kind: "eq"; column: "verdict" | "interest_marker"; value: string }
  | { kind: "in"; column: "verdict"; values: string[] }
  | { kind: "not_null"; column: "downgraded_from" };

export function verdictQuerySpec(filter: VerdictFilter): VerdictQuerySpec {
  switch (filter) {
    case "strong_fit":
      return { kind: "eq", column: "verdict", value: "strong_fit" };
    // Groups assess_tender.py's "possible" and "needs_review" verdicts, same
    // grouping the page's own matchesFilter() used to do in JS.
    case "needs_review":
      return { kind: "in", column: "verdict", values: ["possible", "needs_review"] };
    case "not_a_fit":
      return { kind: "eq", column: "verdict", value: "not_a_fit" };
    case "reassessed":
      return { kind: "not_null", column: "downgraded_from" };
    // 0089: the company's own quick-decline mark, a real indexed column
    // (discovered_opportunities_interest_marker_idx) just like verdict/
    // downgraded_from above, so this is a genuine full-history filter, not a
    // page-scoped one - same reasoning as "reassessed".
    case "declined":
      return { kind: "eq", column: "interest_marker", value: "declined" };
    case "all":
    case "changed":
      return { kind: "none" };
  }
}

// Tabs with an exact, cheap, indexed-adjacent count available ({count:
// "exact", head: true} - no row data transferred). "changed" is excluded
// deliberately: a true count needs the tender_listing_changes cross-reference
// over the company's FULL history, which is exactly the heavy, schema-shaped
// work this batch is scoped to avoid (see app/AGENTS.md's follow-up
// proposal for a dedicated view/function).
export const COUNTABLE_FILTERS: readonly VerdictFilter[] = ["all", "strong_fit", "needs_review", "not_a_fit", "reassessed", "declined"];
