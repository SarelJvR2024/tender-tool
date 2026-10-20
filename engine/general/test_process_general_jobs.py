"""
Focused test for process_general_jobs.py's fail_stale_jobs() - added this
session as part of a wider enterprise-readiness audit (Sarel, 2026-10-20:
"make sure it is designed and build to catch all ... scenarios"). This
queue shares the pack_generation_jobs table with two sibling queues
(engine/cv/process_cv_jobs.py, engine/pack/process_pack_jobs.py), both of
which already have a fail_stale_jobs() to recover a job a crashed/killed
worker left stuck in 'generating' forever - this one didn't, confirmed by
grep before this fix. No dedicated test file existed for this module before
this; this is deliberately narrow (just fail_stale_jobs(), in isolation,
against a minimal in-memory fake client matching the real Supabase class's
select()/update() shape) rather than a full pipeline test.

Run: python3 engine/general/test_process_general_jobs.py
"""
import datetime
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import process_general_jobs as pgj  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


class FakeClient:
    """Matches the real Supabase.select()/update() call shape exactly - no
    network, no urllib. Rows live in self.rows; update() mutates in place
    and returns the matched rows (mirrors PostgREST's own return=representation
    behaviour that the real code relies on)."""

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


def main():
    print("fail_stale_jobs(): a general-engine job stuck in 'generating' is recovered")
    now = datetime.datetime(2026, 10, 20, 12, 0, 0, tzinfo=datetime.timezone.utc)
    stale_started = now - datetime.timedelta(minutes=90)  # past STALE_AFTER_MINUTES=60
    fresh_started = now - datetime.timedelta(minutes=5)   # still well within the window

    rows = [
        {"id": "job-stale", "kind": "generate_pack", "status": "generating", "engine": "general",
         "started_at": iso(stale_started), "company_id": "co-a", "tender_id": "t-a"},
        {"id": "job-fresh", "kind": "generate_pack", "status": "generating", "engine": "general",
         "started_at": iso(fresh_started), "company_id": "co-a", "tender_id": "t-b"},
        {"id": "job-sanral", "kind": "generate_pack", "status": "generating", "engine": "sanral",
         "started_at": iso(stale_started), "company_id": "co-a", "tender_id": "t-c"},
        {"id": "job-ready", "kind": "generate_pack", "status": "ready", "engine": "general",
         "started_at": iso(stale_started), "company_id": "co-a", "tender_id": "t-d"},
    ]
    client = FakeClient(rows)

    alerts = []
    real_record = pgj.system_alerts.record
    pgj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        pgj.fail_stale_jobs(client, now=now)
    finally:
        pgj.system_alerts.record = real_record

    by_id = {r["id"]: r for r in rows}
    check("a job stuck in 'generating' past the threshold is marked failed",
          by_id["job-stale"]["status"] == "failed", by_id["job-stale"])
    check("its error_message is a plain, actionable sentence (no raw internals)",
          "stopped mid-job" in by_id["job-stale"].get("error_message", ""))
    check("completed_at is set on the now-failed job", bool(by_id["job-stale"].get("completed_at")))
    check("a job still well within the stale window is left untouched",
          by_id["job-fresh"]["status"] == "generating", by_id["job-fresh"])
    check("a 'sanral'-engine row (same shared table) is NOT touched by the 'general' queue's own sweep - "
          "that's process_pack_jobs.py's own job",
          by_id["job-sanral"]["status"] == "generating", by_id["job-sanral"])
    check("an already-'ready' job is left untouched regardless of its started_at age",
          by_id["job-ready"]["status"] == "ready", by_id["job-ready"])
    check("exactly one alert was recorded, for the one genuinely stale job",
          len(alerts) == 1 and alerts[0][0][0] == "general", alerts)

    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
