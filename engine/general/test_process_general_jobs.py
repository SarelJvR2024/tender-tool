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
import json
import os
import sys
import tempfile
import urllib.parse

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


def test_fail_stale_jobs_recovers_a_stuck_general_job():
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
        # QA Finding, 2026-10-29: a malformed started_at (a hand-edited row, a
        # bad migration backfill) used to raise straight out of this
        # function's own for loop - with no per-row guard, this ONE bad value
        # aborted the stale-reclaim sweep for every OTHER genuinely stuck job
        # too (job-stale, below, included), same bug class as watch_deadlines.
        # days_until()'s own malformed-date guard.
        {"id": "job-corrupt", "kind": "generate_pack", "status": "generating", "engine": "general",
         "started_at": "not-a-real-timestamp", "company_id": "co-a", "tender_id": "t-e"},
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
    check("a malformed started_at does not crash the sweep and is left generating, not guessed at",
          by_id["job-corrupt"]["status"] == "generating", by_id["job-corrupt"])
    check("exactly two alerts were recorded: the one genuinely stale job (error) and the "
          "malformed-timestamp row (warning) - the malformed row did not silently cost job-stale its own alert",
          len(alerts) == 2 and sorted(a[0][0] for a in alerts) == ["general", "general"]
          and sorted(a[0][2] for a in alerts) == ["error", "warning"], alerts)
    # Standing review, 2026-11-07 (re-verification of Finding 192's own "all
    # 6 bridges swept" claim): the malformed-started_at "warning" alert right
    # here was missed by that sweep - job.get("company_id") was already in
    # scope (the "stuck in 'generating'" error alert two lines below it
    # already used it), but this twin alert, in the same function, didn't.
    malformed_alert = next(kw for (a, kw) in alerts if a[2] == "warning")
    check("the malformed-started_at alert now carries company_id too, not just the stuck-job alert",
          malformed_alert.get("context", {}).get("company_id") == "co-a", malformed_alert)


class FixedDateTime(datetime.datetime):
    """Freezes datetime.datetime.now() to a given instant, same pattern as
    engine/pack/test_pdf_merge.py / engine/cv/test_generate_cv.py's own
    FixedDateTime - needed to land squarely inside the 00:00-01:59 SAST
    window (22:00-23:59 UTC the day before)."""
    _frozen = None

    @classmethod
    def now(cls, tz=None):
        base = cls._frozen
        return base.astimezone(tz) if tz is not None else base.replace(tzinfo=None)


def test_within_missing_closing_date_uses_real_sast_today_not_naive_utc():
    print("\n_within(): a window_years rule with no tender closing date must use the real "
          "SAST calendar day, not _now()'s UTC one, during the 00:00-01:59 SAST window")
    # 00:30 SAST on 2026-10-21 == 22:30 UTC on 2026-10-20 (QA Finding, 2026-10-21: process_general_jobs.py's
    # own _now() is correctly UTC for its OTHER job - timestamping real DB rows - but _within() reused it
    # as a calendar-day fallback too, which is one day behind real SAST "today" in exactly this window).
    FixedDateTime._frozen = datetime.datetime(2026, 10, 20, 22, 30, 0, tzinfo=datetime.timezone.utc)
    real_datetime = pgj.datetime.datetime
    pgj.datetime.datetime = FixedDateTime
    try:
        rule = {"window_years": 5}
        # Real SAST today is 2026-10-21, so a 5-year window's cutoff is 2021-10-21.
        # This item is dated exactly ONE DAY before that cutoff - genuinely outside the
        # window - but lands exactly ON the buggy, one-day-early UTC cutoff (2021-10-20),
        # so the old code wrongly let it through as "recent enough".
        stale_item = {"id": "exp-stale", "completion_date": "2021-10-20"}
        check("a tender with no closing date, during the 00:00-01:59 SAST window, still excludes "
              "experience older than the real (SAST) window cutoff",
              pgj._within(stale_item, rule, None) is False)
        # One day younger - genuinely inside the real window either way - must stay included.
        fresh_item = {"id": "exp-fresh", "completion_date": "2021-10-21"}
        check("an item exactly on the REAL cutoff day is still included (fix didn't over-correct)",
              pgj._within(fresh_item, rule, None) is True)
    finally:
        pgj.datetime.datetime = real_datetime


def test_within_malformed_completion_date_alert_carries_company_id():
    print("_within(): a malformed completion_date's own alert carries the item's company_id too")
    # Finding 188 (2026-11-07): client.select()'s own "select=*" means `item`
    # always carries company_id (confirmed: gather_pack_inputs() filters
    # experience_items by company_id in the first place) - just never
    # included in this alert's own context, unlike every genuinely-stale
    # job alert elsewhere in this file.
    alerts = []
    real_record = pgj.system_alerts.record
    pgj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        result = pgj._within({"id": "exp-1", "company_id": "c-exp", "completion_date": "not-a-real-date"},
                             {"window_years": 5}, None)
    finally:
        pgj.system_alerts.record = real_record
    check("a malformed completion_date is treated as not-within, not a crash", result is False, result)
    check("exactly one alert fired", len(alerts) == 1, alerts)
    if alerts:
        check("the alert carries the experience item's own company_id",
              alerts[0][1]["context"].get("company_id") == "c-exp", alerts[0])


def test_fail_stale_jobs_could_not_mark_failed_alert_carries_company_id():
    print("fail_stale_jobs(): 'could not mark a failed general job as failed' alert carries company_id too")
    # Finding 188 (2026-11-07): same shape as process_pack_jobs.py's own
    # identical nested-except gap, fixed the same pass.
    rows = [{"id": "job-1", "company_id": "c-nested", "kind": "generate_pack", "status": "requested", "engine": "general"}]

    class RaisingOnSecondUpdate(FakeClient):
        def __init__(self, rows):
            super().__init__(rows)
            self.updates = 0

        def update(self, table, filters, body):
            self.updates += 1
            if self.updates == 1:
                return super().update(table, filters, body)
            raise RuntimeError("simulated transient Supabase failure marking the job failed")

    client = RaisingOnSecondUpdate(rows)
    alerts = []
    real_run, real_record = pgj.run_pack, pgj.system_alerts.record
    pgj.run_pack = lambda client, job, work_root, fetch: (_ for _ in ()).throw(RuntimeError("synthetic crash"))
    pgj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        pgj.process_job(client, rows[0], tempfile.mkdtemp(), fetch=None)
    finally:
        pgj.run_pack = real_run
        pgj.system_alerts.record = real_record
    check("both alerts fired (the crash itself, then failing to even mark it failed)", len(alerts) == 2, alerts)
    nested = next((kw for a, kw in alerts if "Could not mark" in a[1]), None)
    check("the nested alert carries the job's own company_id",
          nested is not None and nested["context"].get("company_id") == "c-nested", alerts)


def test_gather_pack_inputs_signatory_fallback():
    print("gather_pack_inputs(): signatory falls back to the company's own designated signatory")
    job = {"company_id": "co-a", "tender_id": "t-a"}
    tender = {"id": "t-a"}
    manifest = {"experience_evidence": {}, "roles": []}
    company = {"id": "co-a", "legal_name": "Mzansi Roads & Civils (Pty) Ltd"}

    # No tender_answers.signatory_person_id for THIS tender, but a person on
    # file has a signatory capacity - the real Mzansi/RFP165 incident,
    # 2026-10-28: "Not on file" even though a Director was on record.
    rows = [
        company,
        {"id": "p-engineer", "company_id": "co-a", "name": "A Candidate", "signatory_capacity": None,
         "id_number": "1", "created_at": "2026-01-01T00:00:00Z"},
        {"id": "p-director", "company_id": "co-a", "name": "Lindiwe Dlamini", "signatory_capacity": "Director",
         "id_number": "9001015000087", "created_at": "2026-01-02T00:00:00Z"},
    ]
    client = FakeClient(rows)
    company_r, answers, files, signatory, evidence, cvs = pgj.gather_pack_inputs(client, job, tender, manifest, "/tmp")
    check("falls back to the person with a signatory capacity on file, not left blank",
          signatory is not None and signatory["name"] == "Lindiwe Dlamini", signatory)
    check("carries that person's real capacity through, not a guessed one",
          signatory["capacity"] == "Director", signatory)
    check("carries that person's ID number through (e.g. for SBD4's representative ID field)",
          signatory["id_number"] == "9001015000087", signatory)

    # An explicit per-tender answer still wins over the fallback.
    rows2 = list(rows) + [{"field_key": "signatory_person_id", "company_id": "co-a", "tender_id": "t-a",
                           "value": "p-engineer"}]
    rows2[1] = dict(rows2[1], signatory_capacity="Candidate")  # give the explicit pick its own capacity too
    client2 = FakeClient(rows2)
    _, _, _, signatory2, _, _ = pgj.gather_pack_inputs(client2, job, tender, manifest, "/tmp")
    check("an explicit tender_answers.signatory_person_id is never overridden by the fallback",
          signatory2 is not None and signatory2["name"] == "A Candidate", signatory2)

    # Nobody at the company has a signatory capacity on file at all: stays
    # honestly missing, never fabricated.
    rows3 = [company, {"id": "p-nobody", "company_id": "co-a", "name": "Nobody", "signatory_capacity": None}]
    client3 = FakeClient(rows3)
    _, _, _, signatory3, _, _ = pgj.gather_pack_inputs(client3, job, tender, manifest, "/tmp")
    check("no person at the company has a signatory capacity on file -> stays None, not fabricated",
          signatory3 is None, signatory3)

    # A DANGLING explicit pick (the person no longer resolves at this
    # company - a stale/corrupted reference; migration 0044's own deletion
    # trigger is supposed to clean this up when a person is actually
    # deleted, but nothing guarantees it in every path) - confirmed,
    # genuinely untested until now, that `if sid:` short-circuits past the
    # company-wide fallback entirely: the signatory stays None even though
    # a real Director IS on file at this exact company. This is the "never
    # silently substitute a different person than the one explicitly
    # picked" choice, not a crash - worth knowing, not fixed here (a
    # design call, same as every other "flag, don't silently decide for
    # Sarel" case in this session), but now locked in by a real test
    # instead of being an accidental, undocumented side effect.
    rows4 = [company,
            {"id": "p-director", "company_id": "co-a", "name": "Lindiwe Dlamini", "signatory_capacity": "Director",
             "id_number": "9001015000087", "created_at": "2026-01-02T00:00:00Z"},
            {"field_key": "signatory_person_id", "company_id": "co-a", "tender_id": "t-a", "value": "p-ghost"}]
    client4 = FakeClient(rows4)
    _, answers4, _, signatory4, _, _ = pgj.gather_pack_inputs(client4, job, tender, manifest, "/tmp")
    check("answers still records the dangling pick as-is (not silently dropped)",
          answers4.get("signatory_person_id") == "p-ghost", answers4)
    check("a dangling explicit pick does NOT fall back to the company's own Director - stays None, "
          "does not crash", signatory4 is None, signatory4)


def test_poll_once_does_not_abort_the_whole_pass_when_one_jobs_claim_fails():
    print("poll_once(): a crash on one job's own claim does not skip every OTHER pending job")
    # Finding (2026-11-04): process_job()'s own claim (client.update(...))
    # sits BEFORE its try block, and process_job() itself never re-raises
    # (its own blanket except Exception always marks the job failed and
    # returns True) - so the only way a job could still raise here is that
    # claim call itself (a network blip, a 500). Before this fix, that
    # propagated straight out of poll_once()'s own for loop, aborting the
    # whole pass: every OTHER pending general-engine job was skipped that
    # cycle too, not just the one whose claim failed - same bug class as
    # Finding 123 (run_bridges.py) and Finding 126 (extract_cv_fields.py).
    rows = [
        {"id": "job-flaky", "status": "requested", "engine": "general", "kind": "generate_pack",
         "requested_at": "1", "company_id": "co-a", "tender_id": "t-a"},
        {"id": "job-ok", "status": "requested", "engine": "general", "kind": "generate_pack",
         "requested_at": "2", "company_id": "co-a", "tender_id": "t-b"},
    ]
    client = FakeClient(rows)
    attempted = []
    real_process_job = pgj.process_job

    def flaky_process_job(client, job, work_root, fetch=None):
        attempted.append(job["id"])
        if job["id"] == "job-flaky":
            raise RuntimeError("simulated transient Supabase failure while claiming job-flaky")
        return True
    pgj.process_job = flaky_process_job
    alerts = []
    real_record = pgj.system_alerts.record
    pgj.system_alerts.record = lambda *a, **kw: alerts.append((a, kw)) or "test-alert"
    try:
        n = pgj.poll_once(client, "/tmp/test_poll_once_work_root")
    finally:
        pgj.process_job = real_process_job
        pgj.system_alerts.record = real_record
    check("poll_once() returns the count of jobs it actually handled, no crash", n == 1, n)
    check("BOTH jobs were attempted - job-ok was not skipped because job-flaky's claim failed",
          sorted(attempted) == ["job-flaky", "job-ok"], attempted)
    check("the failing job's own claim failure is reported as its own alert, not silently lost",
          any(a[0][0] == "general" and a[0][2] == "error" and "job-flaky" in a[0][1] for a in alerts), alerts)


def test_supabase_select_paginates_past_postgrests_own_db_max_rows_cap():
    print("Supabase.select(): a table with more rows than PostgREST's own db-max-rows cap "
          "(Finding 252 - the same cap already fixed for app/'s .select()/.rpc() reads, "
          "QA-Edge-Case-Findings.md Findings 249-251, never checked before for this file's own "
          "Python reads over the identical REST endpoint - process_pack_jobs.py's SANRAL sibling "
          "has the same real class, same bug, same fix).")
    all_rows = [{"id": i} for i in range(2500)]
    client = pgj.Supabase("https://example.test", "k")

    def fake_req(method, path, body=None, headers=None, raw=None):
        # Same faithful PostgREST stand-in as process_pack_jobs.py's own version of
        # this test: caps at its own db-max-rows (1000) unless the client asks for
        # less via limit/offset, which real pagination past the cap relies on.
        qs = urllib.parse.parse_qs(path.split("?", 1)[1] if "?" in path else "")
        requested_limit = int(qs["limit"][0]) if "limit" in qs else 10**9
        offset = int(qs["offset"][0]) if "offset" in qs else 0
        page = all_rows[offset: offset + min(requested_limit, 1000)]
        return json.dumps(page).encode()

    client._req = fake_req
    got = client.select("tender_engine_jobs", {"status": "requested"})
    check("select() returns EVERY matching row, not just PostgREST's own first 1000-row page",
          len(got) == len(all_rows), f"got {len(got)} of {len(all_rows)}")
    check("rows come back in order, nothing dropped or duplicated across pages",
          [r["id"] for r in got] == list(range(2500)), [r["id"] for r in got[:3]] + ["..."])


def main():
    test_fail_stale_jobs_recovers_a_stuck_general_job()
    test_supabase_select_paginates_past_postgrests_own_db_max_rows_cap()
    test_within_missing_closing_date_uses_real_sast_today_not_naive_utc()
    test_within_malformed_completion_date_alert_carries_company_id()
    test_fail_stale_jobs_could_not_mark_failed_alert_carries_company_id()
    test_gather_pack_inputs_signatory_fallback()
    test_poll_once_does_not_abort_the_whole_pass_when_one_jobs_claim_fails()

    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
