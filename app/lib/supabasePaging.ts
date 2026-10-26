// Shared PostgREST pagination helper - extracted from lib/marketPricing.ts
// (PR #111: "silently reading a 2.5% sample, not the real table") so every
// other heavy, unfiltered read of a large/shared table can reuse the same
// fix rather than re-discovering it. marketPricing.ts re-exports
// `fetchAllRows` for its own existing callers/tests.
//
// PostgREST's own hard response cap on this project (db-max-rows) - confirmed
// live 2026-10-23 during the Market Intelligence QA pass: requesting
// .limit(5000) still only ever returned rows 0-999 (content-range
// "0-999/39536" on a direct, unfiltered check). A client-side .limit() past
// this is silently truncated, not an error - any query that can plausibly
// return more than this many rows must paginate with .range() instead of
// trusting .limit() alone.
export const POSTGREST_PAGE_SIZE = 1000;

/** Pages through .range() in POSTGREST_PAGE_SIZE chunks until maxRows is hit
 * or a page comes back short (no more rows) - see POSTGREST_PAGE_SIZE. */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  maxRows: number,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  for (let offset = 0; offset < maxRows; offset += POSTGREST_PAGE_SIZE) {
    const to = Math.min(offset + POSTGREST_PAGE_SIZE, maxRows) - 1;
    const { data, error } = await page(offset, to);
    if (error) return { rows, error: error.message };
    rows.push(...(data ?? []));
    if (!data || data.length < to - offset + 1) break;
  }
  return { rows, error: null };
}
