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


class SchemaValidatingServer:
    """A closer PostgREST stand-in than CappedServer/TiedServer above: it
    actually validates every column named in `order=`/`select=`/a filter
    against a declared column set and raises, exactly the way a real
    PostgREST 400 ("column <table>.<col> does not exist") would, if asked
    to order by a column the table doesn't have. CappedServer/TiedServer
    only ever modelled tables that DO have `id` (their fake rows are keyed
    by it), so neither could have caught a tie-breaker being appended for
    a column that isn't really there."""

    def __init__(self, columns, rows):
        self.columns = set(columns)
        self.rows = rows

    def req(self, method, path, body=None, prefer=None):
        _, _, qs = path.partition("?")
        params = dict(urllib.parse.parse_qsl(qs))
        for col in params.get("order", "").split(","):
            name = col.split(".")[0]
            if name and name not in self.columns:
                # The real failure mode this models: company_profiles.py's
                # own _req() wraps any HTTPError from PostgREST as a bare
                # RuntimeError naming the status code - a 400 here, not a
                # Python-level column lookup, since select() never touches
                # the schema itself; it just builds the query string.
                raise RuntimeError(f"GET {path.split('?')[0]} failed: 400 column {name!r} does not exist")
        offset, limit = int(params.get("offset", 0)), int(params.get("limit", 1000))
        return self.rows[offset:offset + limit]


def test_select_with_tie_breaker_none_sends_no_forced_tie_breaker_at_all():
    """QA pass, 2026-11-28 (following up on Finding 513, before its own fix
    ever reached main): this method is shared across many different
    tables, and several real ones have no `id` column at all -
    digest_readiness_seen/deadline_reminders_seen (0041),
    discovery_seen_releases (0038), tender_watch_state/
    tender_update_notifications (0039). Blindly appending `,id.asc` (this
    method's own default, unchanged for every table that DOES have `id`)
    would 400 every one of those real reads the moment this fix merged -
    confirmed directly against a server that validates the `order=`
    column exactly like real PostgREST does (CappedServer/TiedServer above
    never could have caught this; their fake rows are already keyed by
    `id`, so a real request naming a missing column would still have
    "succeeded" against them)."""
    print("RestClient.select(tie_breaker=None): no forced tie-breaker is appended at all (Finding 513 follow-up)")
    columns = {"company_id", "field_provenance_id", "status", "first_seen", "updated_at"}  # digest_readiness_seen
    rows = [{"company_id": "c1", "field_provenance_id": "p1", "status": "confirmed"},
            {"company_id": "c1", "field_provenance_id": "p2", "status": "computed"}]
    server = SchemaValidatingServer(columns, rows)
    client = cp.RestClient("https://example.test", "key")
    client._req = server.req

    raised = False
    try:
        client.select("digest_readiness_seen", order="company_id.asc,field_provenance_id.asc")  # default tie_breaker="id"
    except RuntimeError:
        raised = True
    check(raised, "the OLD default (tie_breaker='id') must still 400 against a table that really has no id column - "
                  "this is the exact regression being guarded against, not just a new feature")

    out = client.select("digest_readiness_seen", order="company_id.asc,field_provenance_id.asc", tie_breaker=None)
    check(out == rows, f"with tie_breaker=None, the real read succeeds and returns the real rows, got {out}")


def test_select_with_a_custom_tie_breaker_column():
    """discipline_categories (0040) has no `id` column either, but does
    have a real, always-unique column of its own: `slug` (its actual
    primary key) - taxonomy.py's two real callers pass
    tie_breaker="slug" rather than disabling the tie-break outright, since
    `order="sort_order.asc"` alone is NOT unique (sort_order defaults to
    the same 1000 for many rows)."""
    columns = {"slug", "label", "parent_slug", "sort_order", "keywords"}  # discipline_categories
    rows = [{"slug": "roads_civil", "sort_order": 10}, {"slug": "bridges", "sort_order": 10}]
    server = SchemaValidatingServer(columns, rows)
    client = cp.RestClient("https://example.test", "key")
    client._req = server.req

    out = client.select("discipline_categories", order="sort_order.asc", tie_breaker="slug")
    check(out == rows, f"a custom tie_breaker column is accepted and used instead of id, got {out}")

    raised = False
    try:
        client.select("discipline_categories", order="sort_order.asc")  # default tie_breaker="id" - no such column
    except RuntimeError:
        raised = True
    check(raised, "the default id tie-breaker must still 400 against discipline_categories (no id column) - "
                  "confirms tie_breaker='slug' is doing real work above, not just being accepted and ignored")


def test_select_with_tie_breaker_none_and_no_caller_order_sends_no_order_at_all():
    """tender_update_notifications's own real read (watch_tender_updates.
    pending_digest_updates()) passes no `order` of its own at all - the
    default tie_breaker="id" used to turn that into a bare `order=id.asc`
    even then (the `else "order={tie_breaker}.asc"` branch), which would
    still 400 against this id-less table. tie_breaker=None with no caller
    order must send no `order=` param at all, not an empty one."""
    columns = {"company_id", "watched_document_id", "tender_id", "pipeline_stage", "alerted_at", "digested_at"}
    rows = [{"company_id": "c1", "watched_document_id": "d1", "tender_id": "t1", "digested_at": None}]
    server = SchemaValidatingServer(columns, rows)
    client = cp.RestClient("https://example.test", "key")
    client._req = server.req

    raised = False
    try:
        client.select("tender_update_notifications")  # default tie_breaker="id", no caller order
    except RuntimeError:
        raised = True
    check(raised, "no caller order at all must still 400 under the default tie_breaker against an id-less table")

    out = client.select("tender_update_notifications", tie_breaker=None)
    check(out == rows, f"tie_breaker=None with no caller order sends no order= param and the real read succeeds, got {out}")


def main():
    test_select_pages_past_the_1000_row_server_cap()
    test_select_paging_is_stable_even_when_the_callers_own_order_column_has_ties()
    test_select_stops_after_one_request_when_the_real_table_is_smaller()
    test_select_with_filters_still_pages_correctly()
    test_select_with_tie_breaker_none_sends_no_forced_tie_breaker_at_all()
    test_select_with_a_custom_tie_breaker_column()
    test_select_with_tie_breaker_none_and_no_caller_order_sends_no_order_at_all()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
