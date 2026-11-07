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


class RaisingOnSecondPatch:
    """Claim succeeds; the crash-handling PATCH (marking the job 'failed')
    itself raises - the one path that reaches the nested except Exception as
    e2 block ("Could not mark a failed CV job as failed")."""
    def __init__(self):
        self.patches = 0

    def __call__(self, url, key, method, path, body=None):
        if method == "PATCH" and "status=eq.requested" in path:
            return [{"id": "job-1"}]  # claim succeeds
        if method == "PATCH":
            self.patches += 1
            raise RuntimeError("simulated transient Supabase failure marking the job failed")
        return []


def test_could_not_mark_a_failed_cv_job_as_failed_alert_carries_company_id():
    # Finding 188 (2026-11-07): this nested alert's own context never
    # carried company_id at all - unlike the outer "CV generation job
    # failed" alert raised just above it in the same except block, which
    # already does. Reachable for real: a transient Supabase blip hitting
    # exactly the PATCH that marks a crashed job 'failed'.
    stub = RaisingOnSecondPatch()
    original_request, original_fetch, original_record = pcj.supabase_request, pcj.fetch_job_context, pcj.system_alerts.record
    alerts = []
    pcj.supabase_request = stub
    pcj.fetch_job_context = lambda url, key, job: (_ for _ in ()).throw(RuntimeError("synthetic crash"))
    pcj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        pcj.process_job("https://x", "key", {"id": "job-1", "format": "sanral_keyperson", "detail": "full",
                                              "company_id": "c-nested", "person_id": "p1"}, "/tmp")
    finally:
        pcj.supabase_request = original_request
        pcj.fetch_job_context = original_fetch
        pcj.system_alerts.record = original_record

    check("both alerts fired (the crash itself, then failing to even mark it failed)", len(alerts) == 2, alerts)
    nested = next((kw for _, kw in alerts if "Could not mark" in _[1]), None)
    check("the nested 'could not mark as failed' alert carries the job's own company_id",
          nested is not None and nested["context"].get("company_id") == "c-nested", alerts)


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
        {"id": "stuck", "company_id": "c-stuck", "status": "generating", "claimed_at": old},
        {"id": "running", "company_id": "c-running", "status": "generating", "claimed_at": fresh},
        {"id": "corrupt", "company_id": "c-corrupt", "status": "generating", "claimed_at": "not-a-real-timestamp"},
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
    # Finding 188 (2026-11-07): the malformed-claimed_at alert's own context
    # never carried company_id, unlike the genuinely-stale one right below it
    # in the same function - the identical gap Finding 186 found in
    # extract_cv_fields.py's sibling, never swept into this file either.
    by_severity = {kw["context"].get("job_id"): kw["context"] for _, kw in alerts}
    check("the real-stale alert carries the row's own company_id",
          by_severity.get("stuck", {}).get("company_id") == "c-stuck", by_severity.get("stuck"))
    check("the malformed-claimed_at alert ALSO carries the row's own company_id",
          by_severity.get("corrupt", {}).get("company_id") == "c-corrupt", by_severity.get("corrupt"))


def test_adapt_person_row_carries_sacpcmp_date_through():
    print("adapt_person_row: a person's own confirmed SACPCMP registration date reaches "
          "generate_cv.py's profile dict, not just the number")
    # Finding 120 (2026-11-03): people.sacpcmp_date is a real column (same
    # migration as sacpcmp_number, 0001_init_schema.sql) this bridge's own
    # sibling adapters already read correctly (process_pack_jobs.adapt_person(),
    # confirmed by grep) - but this adapter only ever carried sacpcmp_number
    # through, dropping the date before it ever reached generate_cv.py's
    # build_sanral_keyperson(), regardless of that function's own display fix.
    person_row = {"name": "Jane Doe", "sacpcmp_number": "SACPCMPREG12345", "sacpcmp_date": "2018-06-01"}
    person = pcj.adapt_person_row(person_row, [])
    check("sacpcmp_number still carried through (unchanged)",
          person["qualifications"]["sacpcmp_number"] == "SACPCMPREG12345", person["qualifications"])
    check("sacpcmp_date is now carried through too (the bug this test guards)",
          person["qualifications"].get("sacpcmp_date") == "2018-06-01", person["qualifications"])


def test_adapt_person_row_carries_ecsa_and_sacpcmp_expiry_through():
    print("adapt_person_row: a person's own ECSA/SACPCMP registration EXPIRY reaches "
          "generate_cv.py's profile dict, not just the registration date")
    # Finding 121 (2026-11-03): people.ecsa_expiry/sacpcmp_expiry are real
    # columns (migration 0035) watch_deadlines.py already watches for
    # compliance reminders - same shape as Finding 120's sacpcmp_date, just
    # for the expiry side, and for both bodies this bridge's own adapter had
    # missed (sacnasp_expiry/sagc_expiry were already present here).
    person_row = {"name": "Jane Doe", "ecsa_number": "20150155", "ecsa_expiry": "2028-01-15",
                  "sacpcmp_number": "SACPCMPREG12345", "sacpcmp_expiry": "2027-09-30"}
    person = pcj.adapt_person_row(person_row, [])
    check("ecsa_expiry is now carried through (the bug this test guards)",
          person["qualifications"].get("ecsa_expiry") == "2028-01-15", person["qualifications"])
    check("sacpcmp_expiry is now carried through too",
          person["qualifications"].get("sacpcmp_expiry") == "2027-09-30", person["qualifications"])


def test_poll_once_does_not_abort_the_whole_pass_when_one_jobs_claim_fails():
    print("poll_once(): a crash on one job's own claim does not skip every OTHER pending job")
    # Finding 134 (2026-11-05): process_job()'s own claim (claim_job()) sits
    # BEFORE its try block, and process_job() itself never re-raises (its own
    # blanket except Exception always marks the job failed and returns True) -
    # so the only way a job could still raise here is that claim call itself
    # (a network blip, a 500). Before this fix, that propagated straight out
    # of poll_once()'s own for loop, aborting the whole pass: every OTHER
    # pending CV job was skipped that cycle too, not just the one whose claim
    # failed - same bug class as Finding 123 (run_bridges.py), Finding 126
    # (extract_cv_fields.py) and Finding 128's own sweep (pack/general/
    # narrative/onboarding) - missed for THIS bridge at the time.
    jobs = [{"id": "job-flaky", "format": "sanral_keyperson", "detail": "full", "company_id": "c1", "person_id": "p1"},
            {"id": "job-ok", "format": "sanral_keyperson", "detail": "full", "company_id": "c1", "person_id": "p2"}]

    def flaky_request(url, key, method, path, body=None):
        if method == "GET" and path.startswith("generated_cvs?status=eq.requested"):
            return list(jobs)
        if method == "GET" and path.startswith("generated_cvs?status=eq.generating"):
            return []
        if method == "PATCH" and "id=eq.job-flaky" in path and "status=eq.requested" in path:
            raise RuntimeError("simulated transient Supabase failure while claiming job-flaky")
        if method == "PATCH" and "id=eq.job-ok" in path and "status=eq.requested" in path:
            return [{"id": "job-ok"}]
        return []

    original_request, original_fetch = pcj.supabase_request, pcj.fetch_job_context
    pcj.supabase_request = flaky_request
    pcj.fetch_job_context = lambda url, key, job: (_ for _ in ()).throw(RuntimeError("stop before real work"))
    alerts = []
    original_record = pcj.system_alerts.record
    pcj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        n = pcj.poll_once("u", "k", "/tmp/test_poll_once_work_root")
    finally:
        pcj.supabase_request, pcj.fetch_job_context = original_request, original_fetch
        pcj.system_alerts.record = original_record
    check("poll_once() returns the count of jobs it actually handled, no crash", n == 1, n)
    check("the failing job's own claim failure is reported as its own alert, not silently lost",
          any(a[0][0] == "cv" and a[0][2] == "error" and "job-flaky" in a[0][1] for a in alerts), alerts)


test_crash_sets_completed_at()
test_fail_stale_jobs_survives_a_malformed_claimed_at()
test_could_not_mark_a_failed_cv_job_as_failed_alert_carries_company_id()
test_adapt_person_row_carries_sacpcmp_date_through()
test_adapt_person_row_carries_ecsa_and_sacpcmp_expiry_through()
test_poll_once_does_not_abort_the_whole_pass_when_one_jobs_claim_fails()

print(f"\n{len(FAILS)} failure(s)")
if FAILS:
    sys.exit(1)
