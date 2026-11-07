"""
Focused tests for etenders_national.py's fetch_releases() - no dedicated test
file existed for this module before this.

Finding (standing solution-architect review, 2026-11-07/07b, fixed 2026-11-07c):
fetch_releases() paged the OCDS API and, on a page fetch failure, printed a
WARNING to stdout and returned whatever had already been collected - correct
and intentional when at least one page already succeeded (the documented,
live-confirmed HTTP-500 wall around page 5-6), but when the VERY FIRST page
attempt failed (after its own internal retries), the function returned an
empty list exactly as it would for a genuine "no releases in this window"
result. Every caller only ever sees the return value, never the stdout print
(gov_sources.fetch_all()'s own etenders_portal-failed fallback branch wraps
the call in a plain try/except and reads the return value) - so a total
fetch failure was indistinguishable from "nothing happened to be open" and
never populated errors["etenders_ocds"], never tripped
watch_new_tenders.py's own system_alerts.record() gate. Traced twice
(2026-11-07, 2026-11-07b) as reachable only via gov_sources.fetch_all()'s
OCDS fallback and confirmed never to have actually fired in the
daily-discovery workflow's 15-run history - still structurally real and
flagged for a dedicated fix both times. Fixed this pass: fetch_releases()
now raises when every page attempt failed before a single release was
collected, leaving the original "page N+ fails after page 1..N succeeded"
partial-return behavior untouched.

Run: python3 engine/discovery/test_etenders_national.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import etenders_national as en  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _page(releases, next_url=None):
    return {"releases": releases, "links": ({"next": next_url} if next_url else {})}


def _with_stub(stub, fn):
    """Monkeypatches the module-level fetch_page (fetch_releases looks it up
    by name at call time, so reassigning it here reaches every call inside
    fetch_releases without needing it as an injectable parameter), runs fn(),
    and always restores the real fetch_page afterwards."""
    real = en.fetch_page
    en.fetch_page = stub
    try:
        return fn()
    finally:
        en.fetch_page = real


# --- the real bug: every page attempt fails, zero releases ever collected --

def test_total_fetch_failure_raises_not_silently_empty():
    print("fetch_releases: page 1 itself fails outright (every retry exhausted)")

    def stub(date_from, date_to, page, retries=3, backoff=2.0):
        raise RuntimeError("Failed to fetch page 1 after 3 attempts: <urlopen error timed out>")

    raised = []

    def run():
        try:
            return en.fetch_releases("2026-10-01", "2026-10-14")
        except RuntimeError as e:
            raised.append(e)
            return None

    result = _with_stub(stub, run)
    check("raises RuntimeError rather than returning an empty list silently",
          result is None and len(raised) == 1, (result, raised))
    check("the raised error names the total-failure shape, not a generic message",
          raised and "zero releases" in str(raised[0]) and "fetch itself failed" in str(raised[0]),
          raised[0] if raised else None)


# --- the documented page-5/6 wall case must still behave exactly as before -

def test_partial_success_after_some_pages_still_returns_what_it_has():
    print("fetch_releases: page 1 succeeds, page 2 fails (the documented page-5/6 wall shape)")
    calls = []

    def stub(date_from, date_to, page, retries=3, backoff=2.0):
        calls.append(page)
        if page == 1:
            return _page([{"id": "r1"}, {"id": "r2"}], next_url="https://x/?PageNumber=2")
        raise RuntimeError(f"Failed to fetch page {page} after 3 attempts: <HTTPError 500>")

    result = _with_stub(stub, lambda: en.fetch_releases("2026-10-01", "2026-10-14"))
    check("does NOT raise - returns the releases already fetched before the wall",
          result == [{"id": "r1"}, {"id": "r2"}], result)
    check("stopped after page 2's failure, didn't keep retrying pages forever",
          calls == [1, 2], calls)


# --- a genuine zero-releases result (no error at all) must stay silent -----

def test_genuine_zero_releases_does_not_raise():
    print("fetch_releases: page 1 comes back with an empty releases list, no error at all")

    def stub(date_from, date_to, page, retries=3, backoff=2.0):
        return _page([])

    result = _with_stub(stub, lambda: en.fetch_releases("2026-10-01", "2026-10-14"))
    check("a real empty result (no fetch error) still returns [] with no raise", result == [], result)


# --- the normal, fully-successful multi-page case is unaffected ------------

def test_normal_multi_page_success_unaffected():
    print("fetch_releases: 2 full pages, no failures anywhere")

    def stub(date_from, date_to, page, retries=3, backoff=2.0):
        if page == 1:
            return _page([{"id": "a"}, {"id": "b"}], next_url="https://x/?PageNumber=2")
        return _page([{"id": "c"}])

    result = _with_stub(stub, lambda: en.fetch_releases("2026-10-01", "2026-10-14"))
    check("returns all 3 releases across both pages, in order",
          [r["id"] for r in result] == ["a", "b", "c"], result)


if __name__ == "__main__":
    test_total_fetch_failure_raises_not_silently_empty()
    test_partial_success_after_some_pages_still_returns_what_it_has()
    test_genuine_zero_releases_does_not_raise()
    test_normal_multi_page_success_unaffected()

    if FAILS:
        print(f"\n{len(FAILS)} FAILURE(S): {FAILS}")
        sys.exit(1)
    print("\nALL PASSED")
