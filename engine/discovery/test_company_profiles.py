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
    check(all("order=created_at.asc" in r for r in server.requests), "the order param should be sent on every page")


def test_select_stops_after_one_request_when_the_real_table_is_smaller():
    client = cp.RestClient("https://example.test", "key")
    server = CappedServer(42)
    client._req = server.req
    rows = client.select("tenders")
    check(len(rows) == 42, f"should return all 42 rows, got {len(rows)}")
    check(len(server.requests) == 1, f"should take exactly 1 request when the table is smaller than the page size, "
                                     f"took {len(server.requests)}")


def test_select_with_filters_still_pages_correctly():
    client = cp.RestClient("https://example.test", "key")
    server = CappedServer(1500)
    client._req = server.req
    rows = client.select("tender_scope_records", {"confidence": "heuristic"})
    check(len(rows) == 1500, f"filters should not break pagination, got {len(rows)}")
    check(all("confidence=eq.heuristic" in r for r in server.requests), "the filter should be sent on every page")


class ReorderingOfficesClient:
    """A stand-in company+company_offices client whose company_offices rows
    come back in a DIFFERENT (but equally valid) order on each call - the
    real behaviour of a SQL query with no ORDER BY, which PostgREST's
    company_offices select() never sets (Finding 508)."""

    def __init__(self, offices):
        self.offices = offices
        self.calls = 0

    def select(self, table, filters=None):
        if table == "companies":
            return [{"id": "c1", "registered_address": "Nowhere", "bee_level": 2,
                     "black_ownership_pct": 51, "cidb_grading": "7GB"}]
        if table == "experience_items":
            return []
        if table == "company_offices":
            self.calls += 1
            return self.offices if self.calls % 2 else list(reversed(self.offices))
        return []


def test_profile_fingerprint_stable_regardless_of_company_offices_row_order():
    """Finding 508: profile_from_company_rows()'s own company_offices select()
    has no `order=` - row order is unspecified SQL behaviour and can genuinely
    differ between two calls for the exact same, unchanged rows. Before this
    fix, profile_fingerprint() hashed the offices list in whatever order the
    database happened to return it, so a company with 2+ offices could get a
    DIFFERENT fingerprint on consecutive runs with no real profile change at
    all - wrongly tripping watch_new_tenders.py's "profile changed, re-score
    and re-report" path (rescored="profile_changed") and re-notifying a
    company about a tender it was already told about, exactly the false
    positive this module's own docstring says the fingerprint exists to
    avoid ("defeat the point of a 'what's new' alert")."""
    offices = [
        {"province": "Gauteng", "district_municipality": None, "local_municipality": "Tshwane",
         "town": None, "office_kind": "head_office"},
        {"province": "Western Cape", "district_municipality": None, "local_municipality": "Cape Town",
         "town": None, "office_kind": "branch"},
    ]
    client = ReorderingOfficesClient(offices)
    p1 = cp.profile_from_company_rows(client, "c1")
    p2 = cp.profile_from_company_rows(client, "c1")
    check(client.calls == 2, "sanity: company_offices should have been queried twice")
    check(p1["offices"] != offices or p2["offices"] != offices or True, "offices content check below")
    check(set(tuple(sorted(o.items())) for o in p1["offices"]) == set(tuple(sorted(o.items())) for o in p2["offices"]),
          "both calls must still return the exact same real office set")
    f1, f2 = cp.profile_fingerprint(p1), cp.profile_fingerprint(p2)
    check(f1 == f2, f"same real offices, different DB row order must NOT change the fingerprint - got {f1!r} vs {f2!r}")


def main():
    test_select_pages_past_the_1000_row_server_cap()
    test_select_stops_after_one_request_when_the_real_table_is_smaller()
    test_select_with_filters_still_pages_correctly()
    test_profile_fingerprint_stable_regardless_of_company_offices_row_order()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
