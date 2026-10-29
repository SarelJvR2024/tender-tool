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


def main():
    test_fail_stale_jobs_recovers_a_stuck_general_job()
    test_within_missing_closing_date_uses_real_sast_today_not_naive_utc()
    test_gather_pack_inputs_signatory_fallback()

    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
