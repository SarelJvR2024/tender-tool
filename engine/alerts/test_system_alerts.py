"""
System alerts end to end (Sarel, 2026-10-17: "A fail must be emailed to me
and flagged for me to review").

Part 1 (always, CI - engine/worker/fake_supabase.py, an in-memory stand-in
for Supabase REST, which also applies record_system_alert()'s one-open-row-
per-fingerprint rule):
  1. fingerprint(): ids and numbers don't split one failure into many alerts;
     a different failure is a different alert.
  2. A REAL bridge fed a deliberately malformed job, as a subprocess with the
     real env vars: process_cv_jobs.py --once with a CV job in an unknown
     format, and process_general_jobs.py --once with a job of an unknown
     kind. Each job is marked failed as before AND a system_alerts row lands
     (source, severity, the job id in context, a traceback). A second
     malformed CV job raises occurrences on the same open alert instead of a
     second row.
  3. run_bridges.py over a bridge whose pass exits non-zero: a critical
     "worker" alert with the bridge's output as detail.
  4. check_system_alerts.py as a CLI: run 1 reports every alert as new and
     writes --out; run 2 reports nothing (already reported); a new occurrence
     of a reported alert is reported once as still_occurring; a RESOLVED
     alert is never reported again, and the same failure after resolution is
     a new row, reported as new. --dry-run marks nothing.

Part 2 (ALERTS_PSQL set - a scratch Postgres with every migration replayed):
the real record_system_alert() and table (dedupe on the partial unique
index, severity only escalates, a resolved alert's recurrence is a new row),
check() over the real rows, and RLS: an owner reads and resolves (resolution
columns only, resolved_by pinned to themselves), a non-owner member sees
nothing, no client can insert or call record_system_alert().

    python3 engine/alerts/test_system_alerts.py
    ALERTS_PSQL="psql -h /tmp/sock -p 54481 -U postgres -d alertstest" python3 engine/alerts/test_system_alerts.py
"""
import json
import os
import shlex
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "engine", "worker"))
import system_alerts  # noqa: E402
import check_system_alerts  # noqa: E402
from fake_supabase import FakeSupabase  # noqa: E402

FAILS = []
CV_BRIDGE = os.path.join(ROOT, "engine", "cv", "process_cv_jobs.py")
GENERAL_BRIDGE = os.path.join(ROOT, "engine", "general", "process_general_jobs.py")
RUNNER = os.path.join(ROOT, "engine", "worker", "run_bridges.py")
CHECKER = os.path.join(HERE, "check_system_alerts.py")


def check(cond, msg):
    print(("  PASS " if cond else "  FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def env_for(fake):
    return dict(os.environ, NEXT_PUBLIC_SUPABASE_URL=fake.url, SUPABASE_SERVICE_ROLE_KEY="fake-key",
                PYTHONUNBUFFERED="1", SYSTEM_ALERTS_DISABLED="")


def run(args, fake, timeout=300):
    p = subprocess.run([sys.executable] + args, env=env_for(fake), capture_output=True, text=True,
                       cwd=ROOT, timeout=timeout)
    return p.returncode, p.stdout + p.stderr


def alerts(fake):
    return fake.rows("system_alerts")


def part1():
    print("Part 1 - real bridges + checker against the in-memory Supabase stand-in")
    fp = system_alerts.fingerprint
    check(fp("cv", "job 3f2a1b9c-0000-4000-8000-000000000001 failed after 61 minutes")
          == fp("cv", "job 9c01ffff-1111-4111-8111-111111111111 failed after 75 minutes")
          and fp("cv", "x failed") != fp("pack", "x failed") and fp("cv", "a failed") != fp("cv", "b failed"),
          "fingerprint: same failure with other ids/numbers = one alert; other source or message = another")

    fake = FakeSupabase().start()
    try:
        fake.insert("people", {"id": "p1", "company_id": "c1", "name": "Alert Test Person"})
        fake.insert("companies", {"id": "c1", "legal_name": "Alert Test Co"})
        fake.insert("generated_cvs", {"id": "cvjob-1", "company_id": "c1", "person_id": "p1", "status": "requested",
                                      "format": "not_a_real_format", "detail": "summary"})
        code, out = run([CV_BRIDGE, "--once", "--out-dir", tempfile.mkdtemp()], fake)
        job = next(r for r in fake.rows("generated_cvs") if r["id"] == "cvjob-1")
        a = [x for x in alerts(fake) if x["source"] == "cv"]
        print(f"    cv bridge exit {code}; job {job['status']}: {job.get('error_message')}")
        check(code == 0 and job["status"] == "failed", "malformed CV job: marked failed, as before")
        check(len(a) == 1 and a[0]["severity"] == "error" and "not_a_real_format" in a[0]["message"]
              and a[0]["context"].get("job_id") == "cvjob-1" and "Traceback" in (a[0]["detail"] or ""),
              f"malformed CV job: a system_alerts row (source cv, error, job id in context, traceback) - "
              f"{a[0]['message'] if a else None!r}")
        fake.insert("generated_cvs", {"id": "cvjob-2", "company_id": "c1", "person_id": "p1", "status": "requested",
                                      "format": "not_a_real_format", "detail": "summary"})
        run([CV_BRIDGE, "--once", "--out-dir", tempfile.mkdtemp()], fake)
        a = [x for x in alerts(fake) if x["source"] == "cv"]
        check(len(a) == 1 and a[0]["occurrences"] == 2 and a[0]["context"].get("job_id") == "cvjob-2",
              "a second identical failure: same open alert, occurrences 2 (no second row)")

        fake.insert("pack_generation_jobs", {"id": "genjob-1", "engine": "general", "kind": "bogus_kind",
                                             "status": "requested", "company_id": "c1", "tender_id": "t1",
                                             "requested_at": "2026-10-17T00:00:00Z"})
        code, out = run([GENERAL_BRIDGE, "--once", "--work-dir", tempfile.mkdtemp()], fake)
        gj = next(r for r in fake.rows("pack_generation_jobs") if r["id"] == "genjob-1")
        g = [x for x in alerts(fake) if x["source"] == "general"]
        print(f"    general bridge exit {code}; job {gj['status']}: {gj.get('error_message')}")
        check(gj["status"] == "failed" and len(g) == 1 and g[0]["severity"] == "error"
              and "bogus_kind" in g[0]["message"] and g[0]["context"].get("job_id") == "genjob-1",
              f"malformed general job: failed + a system_alerts row (source general) - {g[0]['message'] if g else None!r}")

        broken = os.path.join(tempfile.mkdtemp(), "broken_bridge.py")
        with open(broken, "w") as f:
            f.write("import sys\nprint('connecting to Supabase...')\nraise SystemExit('ERROR: Supabase unreachable')\n")
        code, out = run([RUNNER, "--once", "--script", broken], fake)
        w = [x for x in alerts(fake) if x["source"] == "worker"]
        check(code == 1 and len(w) == 1 and w[0]["severity"] == "critical" and "broken_bridge.py" in w[0]["message"]
              and "Supabase unreachable" in (w[0]["detail"] or ""),
              f"run_bridges.py: a bridge pass that exits non-zero -> a critical worker alert - {w[0]['message'] if w else None!r}")

        # The checker: new -> reported once; nothing new on run 2.
        out1 = os.path.join(tempfile.mkdtemp(), "alerts.json")
        code, txt = run([CHECKER, "--dry-run"], fake)
        check(code == 0 and all(not x.get("reported_at") for x in alerts(fake)), "--dry-run reports but marks nothing")
        code, txt = run([CHECKER, "--out", out1], fake)
        rep = json.load(open(out1))
        print("    checker run 1:", [(x["source"], x["severity"], x["occurrences"]) for x in rep["new"]])
        check(code == 0 and len(rep["new"]) == 3 and rep["still_occurring"] == [] and rep["open_unresolved_total"] == 3
              and {x["source"] for x in rep["new"]} == {"cv", "general", "worker"},
              "checker run 1: the 3 alerts reported as new, written to --out")
        code, txt = run([CHECKER, "--out", out1], fake)
        rep = json.load(open(out1))
        check(code == 0 and rep["new"] == [] and rep["still_occurring"] == [] and "0 new system alert(s)" in txt,
              "checker run 2: nothing new - not re-reported")
        # A reported alert happens again -> still_occurring, once.
        fake.insert("generated_cvs", {"id": "cvjob-3", "company_id": "c1", "person_id": "p1", "status": "requested",
                                      "format": "not_a_real_format", "detail": "summary"})
        run([CV_BRIDGE, "--once", "--out-dir", tempfile.mkdtemp()], fake)
        run([CHECKER, "--out", out1], fake)
        rep = json.load(open(out1))
        check(rep["new"] == [] and [(x["source"], x["occurrences"]) for x in rep["still_occurring"]] == [("cv", 3)],
              "a reported alert that keeps happening is reported once as still_occurring (3 occurrences)")
        run([CHECKER, "--out", out1], fake)
        check(json.load(open(out1))["still_occurring"] == [], "...and not again without a new occurrence")
        # Resolved in /admin -> never reported again; a recurrence is a new alert.
        with fake.lock:
            for r in fake.tables["system_alerts"]:
                if r["source"] == "cv":
                    r["resolved_at"] = "2026-10-17T19:00:00Z"
        fake.insert("generated_cvs", {"id": "cvjob-4", "company_id": "c1", "person_id": "p1", "status": "requested",
                                      "format": "not_a_real_format", "detail": "summary"})
        run([CV_BRIDGE, "--once", "--out-dir", tempfile.mkdtemp()], fake)
        cv_rows = [x for x in alerts(fake) if x["source"] == "cv"]
        rep_code, _ = run([CHECKER, "--out", out1], fake)
        rep = json.load(open(out1))
        check(len(cv_rows) == 2 and [x["id"] for x in rep["new"]] == [cv_rows[1]["id"]]
              and rep["open_unresolved_total"] == 3,
              "resolved: never reported again; the same failure afterwards is a NEW alert row, reported as new")
    finally:
        fake.stop()


class PsqlAlerts:
    """check_system_alerts' client interface over psql (Part 2)."""

    def __init__(self, psql):
        self.cmd = shlex.split(psql)

    def sql(self, q):
        r = subprocess.run(self.cmd + ["-v", "ON_ERROR_STOP=1", "-At", "-c", q], capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(r.stderr.strip())
        return r.stdout.strip()

    def open_alerts(self):
        return json.loads(self.sql("select coalesce(json_agg(t order by last_seen_at desc), '[]') from "
                                   "(select * from system_alerts where resolved_at is null) t"))

    def mark_reported(self, alert_id, occurrences, when):
        self.sql(f"update system_alerts set reported_at = '{when}', reported_occurrences = {int(occurrences)} "
                 f"where id = '{alert_id}'")

    def as_user(self, uid, q):
        r = subprocess.run(self.cmd + ["-v", "ON_ERROR_STOP=1", "-At", "-c", "set role authenticated",
                                       "-c", f"select set_config('test.uid', '{uid}', false)", "-c", q],
                           capture_output=True, text=True)
        return (r.returncode == 0), (r.stdout.strip().splitlines()[-1] if r.returncode == 0 and r.stdout.strip()
                                     else r.stderr.strip())


def part2(psql):
    print("Part 2 - the real 0042 table and record_system_alert() on a replayed scratch Postgres")
    db = PsqlAlerts(psql)
    db.sql("delete from system_alerts")

    def sink(p):
        lit = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"  # noqa: E731
        return db.sql(f"select record_system_alert({lit(p['p_source'])}, {lit(p['p_severity'])}, {lit(p['p_message'])}, "
                      f"{lit(p['p_detail'])}, {lit(json.dumps(p['p_context']))}::jsonb, {lit(p['p_fingerprint'])})")
    system_alerts.set_sink(sink)
    try:
        a1 = system_alerts.record("pack", "SANRAL pack job failed: KeyError: 'DS1' (job 11)", "warning", context={"job_id": "j11"})
        a2 = system_alerts.record("pack", "SANRAL pack job failed: KeyError: 'DS1' (job 12)", "error", context={"job_id": "j12"})
        a3 = system_alerts.record("ocr", "OCR could not run: Tesseract OCR is not installed on this worker", "error")
    finally:
        system_alerts.set_sink(None)
    row = json.loads(db.sql(f"select row_to_json(s) from system_alerts s where id = '{a1}'"))
    check(a1 == a2 and a3 != a1 and row["occurrences"] == 2 and row["severity"] == "error"
          and row["context"]["job_id"] == "j12",
          "record_system_alert(): same fingerprint -> one row, occurrences 2, severity escalated warning -> error, latest context")
    rep = check_system_alerts.check(db, log=lambda m: None)
    check(len(rep["new"]) == 2 and rep["open_unresolved_total"] == 2, "check(): both reported as new from the real table")
    rep = check_system_alerts.check(db, log=lambda m: None)
    check(rep["new"] == [] and rep["still_occurring"] == [], "check() again: nothing re-reported")

    # RLS + privileges (0042): owner-only, resolution columns only.
    owner = db.sql("insert into auth.users default values returning id").splitlines()[0]
    member = db.sql("insert into auth.users default values returning id").splitlines()[0]
    co = db.sql("insert into companies (legal_name) values ('Alerts RLS Co') returning id").splitlines()[0]
    db.sql(f"insert into company_members (company_id, user_id, role) values ('{co}', '{owner}', 'owner'), "
           f"('{co}', '{member}', 'member')")
    # Privileges exactly as the migration left them (on Supabase every new public
    # table/function starts granted to anon/authenticated - the replay stub sets
    # the same default privileges - and 0042 revokes what it must).
    db.sql("grant usage on schema public to authenticated")
    ok, n = db.as_user(member, "select count(*) from system_alerts")
    check(ok and n == "0", f"RLS: a non-owner member sees no alerts ({n})")
    ok, n = db.as_user(owner, "select count(*) from system_alerts")
    check(ok and n == "2", f"RLS: an owner sees them ({n})")
    ok, err = db.as_user(owner, f"update system_alerts set message = 'x' where id = '{a3}'")
    check(not ok and "permission denied" in err, "an owner can't change the alert itself (column privileges)")
    ok, err = db.as_user(owner, f"update system_alerts set resolved_at = now(), resolved_by = '{member}' where id = '{a3}'")
    check(not ok, "an owner can't resolve in someone else's name")
    ok, n = db.as_user(owner, f"with u as (update system_alerts set resolved_at = now(), resolved_by = '{owner}', "
                              f"resolution_note = 'Tesseract added to the image' where id = '{a3}' returning 1) "
                              "select count(*) from u")
    check(ok and n == "1", "an owner resolves an alert (resolution columns, resolved_by = self)")
    ok, n = db.as_user(member, f"with u as (update system_alerts set resolved_at = now() where id = '{a1}' "
                               "returning 1) select count(*) from u")
    check(ok and n == "0", "a non-owner's resolve updates nothing")
    ok, err = db.as_user(owner, "insert into system_alerts (source, message, fingerprint) values "
                                f"('x', 'y', '{'0' * 64}')")
    check(not ok, "no client insert")
    ok, err = db.as_user(owner, "select record_system_alert('x', 'error', 'y', null, '{}'::jsonb, "
                                f"'{'0' * 64}')")
    check(not ok and "permission denied" in err, "record_system_alert() not executable by a signed-in user")
    # A resolved alert never comes back; the same failure again is a new row, reported as new.
    rep = check_system_alerts.check(db, log=lambda m: None)
    check(rep["new"] == [] and rep["open_unresolved_total"] == 1, "resolved: not reported, not counted as open")
    system_alerts.set_sink(sink)
    try:
        a4 = system_alerts.record("ocr", "OCR could not run: Tesseract OCR is not installed on this worker", "error")
    finally:
        system_alerts.set_sink(None)
    rep = check_system_alerts.check(db, log=lambda m: None)
    check(a4 != a3 and [x["id"] for x in rep["new"]] == [a4], "the same failure after resolution: a new alert, reported as new")
    db.sql(f"delete from company_members where company_id = '{co}'; delete from companies where id = '{co}'")


if __name__ == "__main__":
    part1()
    psql = os.environ.get("ALERTS_PSQL")
    if psql:
        part2(psql)
    else:
        print("(Part 2 skipped - set ALERTS_PSQL to a scratch Postgres with the migrations replayed)")
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)
