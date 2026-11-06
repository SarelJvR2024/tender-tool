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
import shutil
import sys
import tempfile

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

    def upload(self, bucket, path, local, content_type):
        # Not exercised for its own sake by any test here - just needs to
        # accept the call without touching the network, same reason this
        # fake has no real select()/update() network either.
        pass


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


def test_adapt_person_carries_sacnasp_and_sagc_through():
    print("adapt_person(): a person's own SACNASP/SAGC registration (0040) must reach the "
          "SANRAL pack's qualifications dict, same as ECSA/SACPCMP already do")
    # Finding (2026-11-03): process_cv_jobs.py's own adapt_person_row() (the standalone-CV path)
    # already read sacnasp_category/number/expiry and sagc_category/number/expiry - this
    # SANRAL-pack adapter never did, so a geologist's/surveyor's real registration (exactly what
    # SANRAL C3.1.11 asks for, per 0050's own held_registrations comment) never reached a
    # generated SANRAL pack's Form B2.1 at all, even though generate_cv.py's own
    # build_sanral_keyperson() has always had display code ready for it.
    row = {"name": "Jane Doe", "id_number": "123", "sacnasp_category": "Pr.Sci.Nat",
           "sacnasp_number": "SACNASP999", "sacnasp_expiry": "2027-06-30",
           "sagc_category": None, "sagc_number": None, "sagc_expiry": None}
    person = ppj.adapt_person(row, [])
    q = person["qualifications"]
    check("sacnasp_category reaches the qualifications dict", q.get("sacnasp_category") == "Pr.Sci.Nat", q)
    check("sacnasp_number reaches the qualifications dict", q.get("sacnasp_number") == "SACNASP999", q)
    check("sacnasp_expiry reaches the qualifications dict", q.get("sacnasp_expiry") == "2027-06-30", q)
    check("sagc_* keys are present (as None) rather than absent", "sagc_number" in q, q)


def test_process_pending_does_not_abort_the_whole_pass_when_one_jobs_claim_fails():
    print("process_pending(): a crash on one job's own claim does not skip every OTHER pending job")
    # Finding (2026-11-04): process_job()'s own claim (client.update(...))
    # sits BEFORE its try block, and process_job() itself never re-raises
    # (its own blanket except Exception always marks the job failed and
    # returns) - so the only way a job could still raise here is that claim
    # call itself (a network blip, a 500). Before this fix, that propagated
    # straight out of process_pending()'s own for loop, aborting the whole
    # pass: every OTHER pending pack job was skipped that cycle too, not
    # just the one whose claim failed - same bug class as Finding 123
    # (run_bridges.py) and Finding 126 (extract_cv_fields.py).
    rows = [
        {"id": "job-flaky", "status": "requested", "engine": "sanral", "requested_at": "1",
         "company_id": "co-a", "tender_id": "t-a"},
        {"id": "job-ok", "status": "requested", "engine": "sanral", "requested_at": "2",
         "company_id": "co-a", "tender_id": "t-b"},
    ]
    client = FakeClient(rows)
    attempted = []
    real_process_job = ppj.process_job

    def flaky_process_job(client, job, work_root, keep=False):
        attempted.append(job["id"])
        if job["id"] == "job-flaky":
            raise RuntimeError("simulated transient Supabase failure while claiming job-flaky")
        return None
    ppj.process_job = flaky_process_job
    alerts = []
    real_record = ppj.system_alerts.record
    ppj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        n = ppj.process_pending(client, "/tmp/test_process_pending_work_root")
    finally:
        ppj.process_job = real_process_job
        ppj.system_alerts.record = real_record
    check("process_pending() returns the total job count, no crash", n == 2, n)
    check("BOTH jobs were attempted - job-ok was not skipped because job-flaky's claim failed",
          attempted == ["job-flaky", "job-ok"], attempted)
    check("the failing job's own claim failure is reported as its own alert, not silently lost",
          any(a[0][0] == "pack" and a[0][2] == "error" and "job-flaky" in a[0][1] for a in alerts), alerts)


def test_supabase_rest_rpc_posts_to_rpc_endpoint_and_parses_the_response():
    print("SupabaseRest.rpc(): posts to /rest/v1/rpc/<fn> with the args as the body and parses "
          "the JSON response - send_pack_ready_email() calls company_notification_recipients/"
          "claim_notification/record_notification_sent through exactly this, and this class had "
          "no rpc() at all before this pass (confirmed: it's the one method process_cv_jobs.py's "
          "own send_pack_ready_email() caller needs that process_general_jobs.py's Supabase class "
          "already had and this one, its SANRAL sibling, never did).")
    client = ppj.SupabaseRest("https://example.test", "k")
    calls = []

    def fake_req(method, path, body=None, headers=None, raw=None):
        calls.append((method, path, body, headers))
        return b'[{"ok": true}]'
    client._req = fake_req
    result = client.rpc("some_function", {"p_a": 1})
    check("exactly one request was made", len(calls) == 1, calls)
    method, path, body, _headers = calls[0]
    check("POSTs", method == "POST", method)
    check("to the right rpc path", path == "/rest/v1/rpc/some_function", path)
    check("the args dict is sent as the body, unmodified", body == {"p_a": 1}, body)
    check("the JSON response is parsed back into Python", result == [{"ok": True}], result)

    calls.clear()
    client.rpc("no_args_function")
    check("args=None sends an empty dict, not null/omitted", calls[0][2] == {}, calls[0])


def test_process_job_sends_the_pack_ready_email_on_success():
    print("process_job(): on a successful SANRAL pack build, send_pack_ready_email() is now "
          "called with (client, job, page_count, APP_URL) - the Finding this pass fixed: this "
          "bridge shares pack_generation_jobs with process_general_jobs.py (engine='sanral' vs "
          "'general'), and the 'general' side has fired this exact email on every ready pack "
          "since 2026-10-27 (notification-engine item B12) while this, its sibling, never did.")
    work_root = tempfile.mkdtemp(prefix="test_pack_ready_email_work_root_")
    job = {"id": "job-1", "status": "requested", "engine": "sanral",
           "company_id": "co-a", "tender_id": "t-a"}
    client = FakeClient([dict(job)])

    def fake_gather(client, job, work):
        return {}

    def fake_build_submission_pack(work_dir, **kwargs):
        os.makedirs(work_dir, exist_ok=True)
        pdf_path = os.path.join(work_dir, "submission_pack.pdf")
        fin_path = os.path.join(work_dir, "financial.pdf")
        open(pdf_path, "wb").close()
        open(fin_path, "wb").close()
        return pdf_path, {
            "page_count": 42, "sections": ["s1"], "omitted": [],
            "financial": {"page_count": 5},
            "outputs": {"pdf": pdf_path, "financial_pdf": fin_path},
        }

    sent = []
    real_gather, real_build, real_verify, real_send = (
        ppj.gather, ppj.build_submission_pack, ppj.verify_pack, ppj.send_pack_ready_email)
    ppj.gather = fake_gather
    ppj.build_submission_pack = fake_build_submission_pack
    ppj.verify_pack = lambda pdf, manifest: []
    ppj.send_pack_ready_email = lambda client, job, page_count, app_url: sent.append(
        (job, page_count, app_url))
    try:
        manifest = ppj.process_job(client, job, work_root, keep=True)
    finally:
        ppj.gather, ppj.build_submission_pack, ppj.verify_pack, ppj.send_pack_ready_email = (
            real_gather, real_build, real_verify, real_send)
        shutil.rmtree(work_root, ignore_errors=True)

    check("process_job() returns the real manifest on success", manifest is not None, manifest)
    check("the job row was marked ready", client.rows[0]["status"] == "ready", client.rows[0])
    check("send_pack_ready_email() was called exactly once", len(sent) == 1, sent)
    if sent:
        sent_job, sent_page_count, sent_app_url = sent[0]
        check("...with the real job dict (same id)", sent_job["id"] == "job-1", sent_job)
        check("...with the real page_count from the manifest", sent_page_count == 42, sent_page_count)
        check("...with APP_URL", sent_app_url == ppj.APP_URL, sent_app_url)


def main():
    test_fail_stale_jobs_recovers_a_stuck_sanral_job_and_survives_a_malformed_one()
    test_adapt_person_carries_sacnasp_and_sagc_through()
    test_process_pending_does_not_abort_the_whole_pass_when_one_jobs_claim_fails()
    test_supabase_rest_rpc_posts_to_rpc_endpoint_and_parses_the_response()
    test_process_job_sends_the_pack_ready_email_on_success()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
