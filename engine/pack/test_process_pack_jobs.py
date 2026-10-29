"""
process_pack_jobs.py had no test file at all before this pass touching its
job-queue logic - confirmed by a repo-wide search before writing this (its
siblings cv/general/narrative/onboarding each have their own). Deliberately
narrow, same scope as engine/general/test_process_general_jobs.py's own
fail_stale_jobs() test: just fail_stale_jobs(), in isolation, against a
minimal in-memory fake client matching the real Supabase class's
select()/update() shape, not a full pipeline test.

QA Finding, 2026-10-29: fail_stale_jobs() parsed every stuck row's own
started_at with a bare datetime.fromisoformat() call, no try/except - one
malformed value on ANY one stuck 'generating' row raised straight out of
this function, which is process_pending()'s own FIRST call: every OTHER
genuinely stale SANRAL pack job stayed stuck forever, and (since the
exception aborts process_pending() entirely) no new pending pack request
got processed that cycle either, repeatedly, until a human fixed the one
bad row by hand. The identical unguarded pattern was found and fixed the
same pass in process_general_jobs.py, process_narrative_jobs.py,
process_cv_jobs.py, extract_cv_fields.py and process_onboarding_jobs.py -
same bug class as watch_deadlines.days_until()'s own malformed-date guard
(engine/compliance/test_watch_deadlines_urgency.py, 2026-10-23).

Run: python3 engine/pack/test_process_pack_jobs.py
"""
import datetime
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import process_pack_jobs as ppj  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


class FakeClient:
    """Matches the real Supabase.select()/update() call shape exactly - no
    network, no urllib. Rows live in self.rows; update() mutates in place
    and returns the matched rows (mirrors PostgREST's own return=representation
    behaviour that the real code relies on). Same pattern as
    engine/general/test_process_general_jobs.py's own FakeClient."""

    def __init__(self, rows):
        self.rows = rows

    def select(self, table, filters=None, order=None):
        return [r for r in self.rows if all(r.get(k) == v for k, v in (filters or {}).items())]

    def update(self, table, filters, body):
        matched = [r for r in self.rows if all(r.get(k) == v for k, v in (filters or {}).items())]
        for r in matched:
            r.update(body)
        return matched


def iso(dt):
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def test_fail_stale_jobs_recovers_a_stuck_sanral_job_and_survives_a_malformed_one():
    print("fail_stale_jobs(): a stuck SANRAL pack job is recovered; a malformed started_at "
          "elsewhere does not abort the sweep")
    now = datetime.datetime(2026, 10, 29, 12, 0, 0, tzinfo=datetime.timezone.utc)
    stale_started = now - datetime.timedelta(minutes=90)  # past STALE_AFTER_MINUTES=60
    fresh_started = now - datetime.timedelta(minutes=5)   # still well within the window

    rows = [
        {"id": "job-stale", "status": "generating", "engine": "sanral",
         "started_at": iso(stale_started), "company_id": "co-a", "tender_id": "t-a"},
        {"id": "job-fresh", "status": "generating", "engine": "sanral",
         "started_at": iso(fresh_started), "company_id": "co-a", "tender_id": "t-b"},
        {"id": "job-general", "status": "generating", "engine": "general",
         "started_at": iso(stale_started), "company_id": "co-a", "tender_id": "t-c"},
        {"id": "job-ready", "status": "ready", "engine": "sanral",
         "started_at": iso(stale_started), "company_id": "co-a", "tender_id": "t-d"},
        # The finding: a corrupted/hand-edited started_at on this row alone
        # used to crash the whole sweep, including job-stale above.
        {"id": "job-corrupt", "status": "generating", "engine": "sanral",
         "started_at": "not-a-real-timestamp", "company_id": "co-a", "tender_id": "t-e"},
    ]
    client = FakeClient(rows)

    alerts = []
    real_record = ppj.system_alerts.record
    ppj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        ppj.fail_stale_jobs(client, now=now)
    finally:
        ppj.system_alerts.record = real_record

    by_id = {r["id"]: r for r in rows}
    check("a job stuck in 'generating' past the threshold is marked failed",
          by_id["job-stale"]["status"] == "failed", by_id["job-stale"])
    check("its error_message is a plain, actionable sentence (no raw internals)",
          "stopped mid-job" in by_id["job-stale"].get("error_message", ""))
    check("completed_at is set on the now-failed job", bool(by_id["job-stale"].get("completed_at")))
    check("a job still well within the stale window is left untouched",
          by_id["job-fresh"]["status"] == "generating", by_id["job-fresh"])
    check("a 'general'-engine row (same shared table) is NOT touched by the 'sanral' queue's own sweep - "
          "that's process_general_jobs.py's own job",
          by_id["job-general"]["status"] == "generating", by_id["job-general"])
    check("an already-'ready' job is left untouched regardless of its started_at age",
          by_id["job-ready"]["status"] == "ready", by_id["job-ready"])
    check("a malformed started_at does not crash the sweep and is left generating, not guessed at",
          by_id["job-corrupt"]["status"] == "generating", by_id["job-corrupt"])
    check("both the real stale job and the malformed row got their own alert, each correctly severed",
          sorted((a[0][0], a[0][2]) for a in alerts) == [("pack", "error"), ("pack", "warning")], alerts)


def main():
    test_fail_stale_jobs_recovers_a_stuck_sanral_job_and_survives_a_malformed_one()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
