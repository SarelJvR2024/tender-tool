"""
engine/cv/process_cv_jobs.py had no test file at all before this pass.

Covers one real bug found by the standing solution-architect review
(2026-10-28): process_job()'s own main exception handler marked a crashed
CV job 'failed' without ever setting completed_at - unlike every other
failure path in this file (fail_stale_jobs()) and every sibling
process_*_jobs.py bridge (pack/general/narrative/onboarding), which all set
their own completion timestamp on failure too. Two real, reachable
consequences this left behind: (1) app/supabase/migrations/0101's
platform_admin_engine_telemetry() RPC counts a CV as "failed in the last
24h" only when completed_at >= now() - 24h - a null completed_at never
matches, so a real crash (the common failure path) never appeared on the
admin Telemetry page, only the rare worker-died-mid-job stale-timeout case
did; (2) app/lib/tenderActivity.ts's own tender activity feed only shows a
CV ready/failed event when `cv.completed_at` is set - so a genuinely failed
CV request silently never appeared in the tender's own activity feed either.

Run: python3 engine/cv/test_process_cv_jobs.py
"""
import datetime
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import process_cv_jobs as pcj  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


class StubSupabase:
    """Captures every call; GET for the claim-check returns a truthy row so
    claim_job() succeeds, letting process_job() reach its own try block."""
    def __init__(self):
        self.calls = []

    def __call__(self, url, key, method, path, body=None):
        self.calls.append((method, path, body))
        if method == "PATCH" and path.startswith("generated_cvs") and "status=eq.requested" in path:
            return [{"id": "job-1"}]  # claim succeeds
        return []


def test_crash_sets_completed_at():
    stub = StubSupabase()
    original_request = pcj.supabase_request
    original_fetch = pcj.fetch_job_context
    pcj.supabase_request = stub
    # Force the real failure path: any exception inside process_job()'s own
    # try block, same as a bad profile field or a LibreOffice crash would.
    pcj.fetch_job_context = lambda url, key, job: (_ for _ in ()).throw(RuntimeError("synthetic crash"))
    try:
        result = pcj.process_job("https://x", "key", {"id": "job-1", "format": "sanral_keyperson", "detail": "full",
                                                        "company_id": "c1", "person_id": "p1"}, "/tmp")
    finally:
        pcj.supabase_request = original_request
        pcj.fetch_job_context = original_fetch

    check("process_job() returns True even on a handled crash", result is True)
    failed_patches = [c for c in stub.calls if c[0] == "PATCH" and c[1] == "generated_cvs?id=eq.job-1"]
    check("exactly one failure PATCH sent", len(failed_patches) == 1, f"got {len(failed_patches)}")
    if failed_patches:
        body = failed_patches[0][2]
        check("failure PATCH sets status='failed'", body.get("status") == "failed")
        check("failure PATCH sets completed_at (the bug this test guards)", body.get("completed_at") is not None,
              f"body={body}")


class FakeQueue:
    """Minimal GET/PATCH stand-in scoped to fail_stale_jobs()'s own exact
    call shapes (a plain status=eq.generating GET, a PATCH keyed on
    id=eq.<id>&status=eq.generating) - no general filter parsing needed."""
    def __init__(self, rows):
        self.rows = rows

    def __call__(self, url, key, method, path, body=None):
        if method == "GET":
            return [dict(r) for r in self.rows if r["status"] == "generating"]
        if method == "PATCH":
            job_id = path.split("id=eq.")[1].split("&")[0]
            for r in self.rows:
                if r["id"] == job_id and r["status"] == "generating":
                    r.update(body)
            return []
        raise ValueError(f"FakeQueue does not support {method}")


def test_fail_stale_jobs_survives_a_malformed_claimed_at():
    # QA Finding, 2026-10-29: a malformed claimed_at on ANY one stuck row
    # used to raise straight out of this function's own for loop, with no
    # per-row guard - one bad value aborted the stale-reclaim sweep for
    # every OTHER genuinely stuck CV job too (same bug class as
    # watch_deadlines.days_until()'s own malformed-date guard).
    now = datetime.datetime(2026, 10, 29, 12, 0, tzinfo=datetime.timezone.utc)
    old = (now - datetime.timedelta(minutes=90)).isoformat()   # past STALE_AFTER_MINUTES=60
    fresh = (now - datetime.timedelta(minutes=5)).isoformat()
    rows = [
        {"id": "stuck", "status": "generating", "claimed_at": old},
        {"id": "running", "status": "generating", "claimed_at": fresh},
        {"id": "corrupt", "status": "generating", "claimed_at": "not-a-real-timestamp"},
    ]
    queue = FakeQueue(rows)
    alerts = []
    original_request, original_record = pcj.supabase_request, pcj.system_alerts.record
    pcj.supabase_request = queue
    pcj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        pcj.fail_stale_jobs("https://x", "key", now=now)
    finally:
        pcj.supabase_request = original_request
        pcj.system_alerts.record = original_record

    by_id = {r["id"]: r for r in rows}
    check("a job stuck 'generating' past the threshold is marked failed",
          by_id["stuck"]["status"] == "failed", by_id["stuck"])
    check("a job still within the window is left untouched",
          by_id["running"]["status"] == "generating", by_id["running"])
    check("a malformed claimed_at does not crash the sweep and is left generating, not guessed at",
          by_id["corrupt"]["status"] == "generating", by_id["corrupt"])
    check("both the real stale job and the malformed row got their own alert, each correctly severed",
          sorted((a[0][0], a[0][2]) for a in alerts) == [("cv", "error"), ("cv", "warning")], alerts)


test_crash_sets_completed_at()
test_fail_stale_jobs_survives_a_malformed_claimed_at()

print(f"\n{len(FAILS)} failure(s)")
if FAILS:
    sys.exit(1)
