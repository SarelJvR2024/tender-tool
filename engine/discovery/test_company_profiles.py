"""
Tests for company_profiles.RestClient.select()'s own pagination - the exact
same real bug class app/lib/marketPricing.ts was fixed for (PR #111:
"silently reading a 2.5% sample, not the real table" - a client-side
.limit()/.range() with no server-side paging silently truncates at
PostgREST's hard 1000-row-per-request cap, no error). This task's own brief
named checking whether tender_enrichment.py's own backlog read already pages
past 1000 rows (it reads `tenders` via this same RestClient.select()).

Finding: it already does - select() already loops on offset/limit
(self.PAGE = 1000) until a page comes back short, confirmed by reading its
own implementation before writing this test. No code fix was needed here;
this is the Python-equivalent proof marketPricing.spec.ts already has for
the TypeScript side (see its own serverThatCapsAt()/fetchAllRows() tests),
written so this isn't just read-and-trust but read-and-verified.

No network: a CappedServer stand-in enforces PostgREST's real 1000-row cap
regardless of what `limit` the client asks for, the same way
marketPricing.spec.ts's own serverThatCapsAt() does.

Usage: python3 engine/discovery/test_company_profiles.py
"""
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import company_profiles as cp  # noqa: E402

FAILS = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


class CappedServer:
    """A PostgREST stand-in that never returns more than 1000 rows in one
    response, however wide a limit/offset the client requests - confirmed
    live behaviour (marketPricing.ts's own comment: ".limit(5000) still only
    ever returned rows 0-999, content-range '0-999/39536'")."""
    SERVER_CAP = 1000

    def __init__(self, total_rows):
        self.total_rows = total_rows
        self.requests = []

    def req(self, method, path, body=None, prefer=None):
        self.requests.append(path)
        _, _, qs = path.partition("?")
        params = dict(urllib.parse.parse_qsl(qs))
        requested_limit = int(params.get("limit", self.SERVER_CAP))
        offset = int(params.get("offset", 0))
        effective_limit = min(requested_limit, self.SERVER_CAP)
        return [{"id": i} for i in range(offset, min(offset + effective_limit, self.total_rows))]


def test_select_pages_past_the_1000_row_server_cap():
    client = cp.RestClient("https://example.test", "key")
    server = CappedServer(2500)
    client._req = server.req
    rows = client.select("tenders", order="created_at.asc")
    check(len(rows) == 2500, f"should page through all 2500 real rows past the server's 1000-row cap, got {len(rows)}")
    check(rows[0]["id"] == 0 and rows[-1]["id"] == 2499, "rows should be the full, real set, not truncated")
    check(len(server.requests) == 3, f"should take exactly 3 requests (1000+1000+500), took {len(server.requests)}")
    check(all("order=created_at.asc,id.asc" in r for r in server.requests),
          "the order param should be sent on every page, with id.asc appended as a tie-breaker "
          "(QA pass, 2026-11-26, Finding 513) so paging a non-unique sort column can't skip/duplicate rows on a tie")


def test_select_stops_after_one_request_when_the_real_table_is_smaller():
    client = cp.RestClient("https://example.test", "key")
    server = CappedServer(42)
    client._req = server.req
    rows = client.select("tenders")
    check(len(rows) == 42, f"should return all 42 rows, got {len(rows)}")
    check(len(server.requests) == 1, f"should take exactly 1 request when the table is smaller than the page size, "
                                     f"took {len(server.requests)}")


def test_select_paging_is_stable_even_when_the_callers_own_order_column_has_ties():
    """Finding 513 (QA pass, 2026-11-26): the same bug class Finding 511
    already fixed in watch_deadlines.supabase_request() - RestClient.select()
    appended no tie-breaker when the caller passed its own `order` (real
    callers do so on genuinely non-unique columns: tender_enrichment.py's
    `order="created_at.asc"` on `tenders`, discovery_downgrades.py's
    `order="downgraded_at.asc"`, taxonomy.py's `order="sort_order.asc"`),
    and added none at all when no `order` was given - relying on Postgres's
    own undefined default row order across repeated paged executions. The
    CappedServer above never modelled a tie at all (its fake rows are
    already unique by `id`), so it could not have caught this.

    Reproduced directly: a fake server that reads the real `order` the
    client actually sent - stable (by id) once the `,id.asc` tie-breaker is
    present, but free to reorder a tied group differently on each separate
    call when it isn't, the exact legitimate PostgREST/Postgres behaviour
    absent a secondary sort key."""
    print("RestClient.select(): paging stays stable even when the caller's own order column has ties (Finding 513)")

    class TiedServer:
        """3 rows share created_at 'D' (ids 1/2/3), 2 share 'E' (ids 4/5)."""
        ROWS = {1: "D", 2: "D", 3: "D", 4: "E", 5: "E"}
        TIE_ORDERS = [[1, 2, 3], [3, 1, 2]]

        def __init__(self):
            self.calls = 0

        def req(self, method, path, body=None, prefer=None):
            _, _, qs = path.partition("?")
            params = dict(urllib.parse.parse_qsl(qs))
            offset, limit = int(params.get("offset", 0)), int(params.get("limit", 1000))
            order = params.get("order", "")
            if order.endswith(",id.asc"):
                ordered = [1, 2, 3, 4, 5]  # a real secondary key makes this deterministic every time
            else:
                ordered = self.TIE_ORDERS[self.calls % 2] + [4, 5]
            self.calls += 1
            return [{"id": i, "created_at": self.ROWS[i]} for i in ordered[offset:offset + limit]]

    client = cp.RestClient("https://example.test", "key")
    server = TiedServer()
    client._req = server.req
    client.PAGE = 2
    rows = client.select("tenders", order="created_at.asc")
    ids = [r["id"] for r in rows]
    check(sorted(set(ids)) == [1, 2, 3, 4, 5] and len(ids) == len(set(ids)),
          f"every real row is returned exactly once, none skipped or duplicated across the page boundary (got ids {ids})")


def test_select_with_filters_still_pages_correctly():
    client = cp.RestClient("https://example.test", "key")
    server = CappedServer(1500)
    client._req = server.req
    rows = client.select("tender_scope_records", {"confidence": "heuristic"})
    check(len(rows) == 1500, f"filters should not break pagination, got {len(rows)}")
    check(all("confidence=eq.heuristic" in r for r in server.requests), "the filter should be sent on every page")


def main():
    test_select_pages_past_the_1000_row_server_cap()
    test_select_paging_is_stable_even_when_the_callers_own_order_column_has_ties()
    test_select_stops_after_one_request_when_the_real_table_is_smaller()
    test_select_with_filters_still_pages_correctly()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
