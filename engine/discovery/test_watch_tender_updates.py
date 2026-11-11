"""
`watch_tender_updates.py` had zero test coverage of any kind before this file
- confirmed by `ls test_*.py` in this directory (every other discovery module
with real logic has one; this 600+-line module, the one that tells an
actively-pursuing company about addenda/closing-date/briefing changes, did
not).

Standing review, 2026-11-07s: read `check_tender()`'s two source branches
side by side - SANRAL (`tender.get("source") == "sanral"`) and eTenders OCDS
(`tender.get("ocid")`) - and found they are NOT symmetric on failure. The
SANRAL branch, when the buyer's page can't be read, calls
`system_alerts.record(..., "error", ...)` - a real alert `/admin` shows and
Sarel sees. The OCDS branch, when the tender's release can't be found in any
of the day-windows `OcdsDays.find()` tries (the walk-back window is exhausted,
or the feed's own re-dating/pagination means today's windows simply don't
carry it), does NOT call `system_alerts.record()` at all - it only writes
`last_error` into `tender_watch_state`, a column nothing else in this
codebase ever reads (confirmed: `grep -rn "last_error"` across `app/` and
`engine/` turns up only this file writing it, plus one unrelated
`workflowRegistry.ts` field of the same name for a completely different
subsystem). A company actively pursuing an eTenders tender whose release
drops out of every window this watch tries would silently stop getting ANY
addendum/closing-date/briefing alert for it, forever (nothing raises, so it's
never in `run()`'s own `failed` list either) - and Sarel would never know,
unlike the exact same consequence for a SANRAL tender one branch below.

This test reproduces that gap directly: a pursued eTenders tender whose
`fetch_ocds_day` NEVER returns its ocid, in any window `OcdsDays.find()`
tries. Before the fix: `tender_watch_state.last_error` is set (so the DB
"knows"), but zero `system_alerts.record()` calls happen - red. After the
fix: exactly one alert is recorded, naming the tender, same severity ("error")
and shape as the SANRAL branch's own call just below it in the same function.

Run: python3 test_watch_tender_updates.py
"""
import datetime
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "engine", "alerts"))
import system_alerts  # noqa: E402
import watch_tender_updates as watch  # noqa: E402

FAILS = []


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


class FakeClient:
    """An in-memory stand-in for company_profiles.RestClient's own
    select/update/upsert/insert/rpc shape (see its own docstring) - enough of
    it for watch_tender_updates.py's own calls, nothing more."""

    def __init__(self):
        self.tables = {}

    def select(self, table, filters=None, order=None):
        rows = self.tables.get(table, [])
        if not filters:
            return [dict(r) for r in rows]
        out = []
        for r in rows:
            ok = True
            for k, v in filters.items():
                if isinstance(v, (list, tuple)):
                    if r.get(k) not in v:
                        ok = False
                        break
                elif r.get(k) != v:
                    ok = False
                    break
            if ok:
                out.append(dict(r))
        return out

    def update(self, table, filters, body):
        rows = self.tables.setdefault(table, [])
        updated = []
        for r in rows:
            if all(r.get(k) == v for k, v in (filters or {}).items()):
                r.update(body)
                updated.append(dict(r))
        return updated

    def upsert(self, table, rows, on_conflict):
        keys = on_conflict.split(",")
        store = self.tables.setdefault(table, [])
        out = []
        for row in rows:
            match = None
            for r in store:
                if all(r.get(k) == row.get(k) for k in keys):
                    match = r
                    break
            if match is not None:
                match.update(row)
                out.append(dict(match))
            else:
                new = dict(row)
                new.setdefault("id", f"{table}-{len(store) + 1}")
                store.append(new)
                out.append(dict(new))
        return out

    def insert(self, table, row):
        store = self.tables.setdefault(table, [])
        new = dict(row)
        new.setdefault("id", f"{table}-{len(store) + 1}")
        store.append(new)
        return dict(new)

    def rpc(self, fn, args=None):
        return []


def make_client():
    c = FakeClient()
    c.tables["tender_packs"] = [{"company_id": "c1", "tender_id": "t1", "pipeline_stage": "bidding"}]
    c.tables["tenders"] = [{"id": "t1", "ocid": "ocds-test-1", "status": None,
                           "closing_date": "2099-01-01T11:00:00+02:00", "contract_no": "T1",
                           "description": "Test tender", "document_urls": []}]
    c.tables["tender_watch_state"] = []
    c.tables["tender_watched_documents"] = []
    c.tables["tender_update_notifications"] = []
    c.tables["companies"] = [{"id": "c1", "legal_name": "Test Co"}]
    c.tables["company_members"] = []
    c.tables["discovered_opportunities"] = []
    c.tables["tender_tasks"] = []
    return c


def run_watch(fetch_ocds_day):
    client = make_client()
    alerts = []
    system_alerts.set_sink(lambda payload: alerts.append(payload))
    work_dir = tempfile.mkdtemp(prefix="watch-test-")
    try:
        today = datetime.date(2026, 11, 7)
        report = watch.run(client, today=today, fetch_ocds_day=fetch_ocds_day,
                           fetch_sanral=None, fetch_doc=None, work_dir=work_dir, log=lambda *a, **k: None)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        system_alerts.set_sink(None)
    return client, report, alerts


def test_ocds_release_not_found_is_alerted():
    # The OCDS feed never has this tender's ocid, in any window the search
    # tries (same real-world shape as the release simply dropping out of
    # every day-window checked: a walk-back exhausted, or a re-dating this
    # watch's own windows don't cover).
    client, report, alerts = run_watch(fetch_ocds_day=lambda day: [])

    state = client.select("tender_watch_state", {"tender_id": "t1"})
    check(len(state) == 1 and state[0].get("last_error") and "not found" in state[0]["last_error"],
          f"tender_watch_state.last_error is set when the release can't be found ({state})")
    check(report == [], "no updates reported (nothing new to tell anyone) - consistent before and after the fix")

    ocds_alerts = [a for a in alerts if a["p_source"] == "tender_updates" and "ocds" in a["p_message"].lower()
                  and ("not found" in a["p_message"].lower() or "could not be found" in a["p_message"].lower())]
    check(len(ocds_alerts) == 1,
          f"a pursued eTenders tender whose release can't be found gets a system_alerts.record() call, "
          f"the same way the SANRAL branch already does on its own failure (got {len(alerts)} alert(s) total, "
          f"{len(ocds_alerts)} matching) - THIS IS THE FIX THIS TEST EXISTS FOR")
    if ocds_alerts:
        check(ocds_alerts[0]["p_severity"] == "error", f"same severity as the SANRAL branch's own call ({ocds_alerts[0]['p_severity']})")
        check(ocds_alerts[0]["p_context"].get("tender_id") == "t1", "the alert names which tender")


def test_sanral_failure_still_alerted_unchanged():
    """The SANRAL branch's own existing behaviour - untouched by this fix,
    checked here so a future change to this function can't silently remove
    it while "fixing" the OCDS side."""
    client = make_client()
    client.tables["tenders"][0] = {"id": "t1", "source": "sanral", "slug": "r-test-1", "status": None,
                                   "closing_date": "2099-01-01T11:00:00+02:00", "contract_no": "T1",
                                   "description": "Test SANRAL tender", "document_urls": []}
    alerts = []
    system_alerts.set_sink(lambda payload: alerts.append(payload))
    work_dir = tempfile.mkdtemp(prefix="watch-test-")

    def fetch_sanral_fails(slug):
        raise RuntimeError("404")

    try:
        today = datetime.date(2026, 11, 7)
        watch.run(client, today=today, fetch_ocds_day=lambda day: [], fetch_sanral=fetch_sanral_fails,
                 fetch_doc=None, work_dir=work_dir, log=lambda *a, **k: None)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        system_alerts.set_sink(None)

    sanral_alerts = [a for a in alerts if "SANRAL" in a["p_message"]]
    check(len(sanral_alerts) == 1, f"the SANRAL failure path still alerts, unchanged ({len(alerts)} total)")


def test_transient_day_fetch_failure_does_not_poison_other_pursued_tenders():
    """Finding 410, 2026-11-11: `OcdsDays.releases()` used to cache a day's
    FAILED fetch as `[]` - the identical value a day that was genuinely read
    and genuinely had nothing on it produces. `today` is always every
    pursued eTenders tender's own first candidate day (`find()`'s own
    RECENT_DAYS window) - so that cache entry is shared, for the whole run,
    across every tender this watch checks. Two pursued eTenders tenders, t1
    and t2, both with their one true release sitting on `today` (the only
    day either can be found on). `fetch_ocds_day` raises on its first call
    (today's fetch, made while checking t1 - always first, by `tender_packs`
    insertion order) and succeeds on every call after that - a real,
    one-off, transient read blip, not a persistently broken feed.

    Before the fix: t1 fails to find its release this run regardless (it was
    genuinely unlucky enough to hit the live failure) - unavoidable and not
    what this test checks. t2, checked right after, reuses `today`'s cached
    `[]` from t1's failure without ever calling `fetch_ocds_day` again, so it
    ALSO wrongly reports "release not found", even though a fresh fetch
    (which a real retry moments later would make) finds it immediately -
    red. After the fix: the failed fetch is not cached, so t2's own lookup
    retries `today` fresh, finds its real release, and is never wrongly
    reported as missing - green.

    Run: python3 test_watch_tender_updates.py
    """
    client = make_client()
    client.tables["tender_packs"].append({"company_id": "c1", "tender_id": "t2", "pipeline_stage": "bidding"})
    client.tables["tenders"].append({"id": "t2", "ocid": "ocds-test-2", "status": None,
                                     "closing_date": "2099-01-01T11:00:00+02:00", "contract_no": "T2",
                                     "description": "Test tender 2", "document_urls": []})

    today = datetime.date(2026, 11, 7)
    calls = {"n": 0}

    def fetch_ocds_day(day):
        if day != today:
            return []
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("transient network blip")
        return [{"ocid": "ocds-test-1", "tender": {"documents": []}},
                {"ocid": "ocds-test-2", "tender": {"documents": []}}]

    alerts = []
    system_alerts.set_sink(lambda payload: alerts.append(payload))
    work_dir = tempfile.mkdtemp(prefix="watch-test-")
    try:
        watch.run(client, today=today, fetch_ocds_day=fetch_ocds_day, fetch_sanral=None, fetch_doc=None,
                 work_dir=work_dir, log=lambda *a, **k: None)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        system_alerts.set_sink(None)

    not_found_alerts = [a for a in alerts if a["p_source"] == "tender_updates" and "not found" in a["p_message"].lower()]
    reported_missing = {a["p_context"].get("tender_id") for a in not_found_alerts}
    check("t1" in reported_missing, "t1 (the tender actually hit by the transient failure) still gets its own "
                                    f"'not found' alert, unchanged ({reported_missing})")
    check("t2" not in reported_missing,
          f"t2's own release - genuinely findable with a fresh fetch - must not be wrongly reported as 'not found' "
          f"just because t1's transient failure poisoned today's cache first (tenders reported missing: "
          f"{reported_missing}) - THIS IS THE FIX THIS TEST EXISTS FOR")

    t2_state = client.select("tender_watch_state", {"tender_id": "t2"})
    check(len(t2_state) == 1 and not t2_state[0].get("last_error") and t2_state[0].get("last_found_at"),
          f"t2's own watch state shows its release genuinely found this run, not a false 'not found' ({t2_state})")
    check(calls["n"] == 2, f"today's feed was fetched exactly twice - once that failed (checking t1), once that "
                          f"succeeded (checking t2) - a failed fetch must never be cached as a genuine empty day "
                          f"(calls={calls['n']})")


def main():
    print("watch_tender_updates.py - OCDS-vs-SANRAL failure-alerting symmetry")
    test_ocds_release_not_found_is_alerted()
    test_sanral_failure_still_alerted_unchanged()
    test_transient_day_fetch_failure_does_not_poison_other_pursued_tenders()
    print()
    if FAILS:
        print(f"{len(FAILS)} FAILED:")
        for f in FAILS:
            print(f"  - {f}")
        sys.exit(1)
    print("ALL PASSED")


if __name__ == "__main__":
    main()
