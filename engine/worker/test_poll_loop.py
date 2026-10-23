"""
Smoke test for the bridge polling loop. No live Supabase needed: the CV
bridge talks to engine/worker/fake_supabase.py, a local in-memory stand-in
for the handful of REST/Storage calls process_cv_jobs.py makes.

What it proves:
  1. poll_forever() really loops: polls, sleeps for the interval, polls
     again, and a job that only appears DURING the sleep is picked up on the
     next cycle. A failing poll is counted and the loop carries on.
  2. `process_cv_jobs.py --loop` does the same end to end, as a real
     subprocess with real sleeps and real generate_cv.py/LibreOffice output:
     job 1 is ready, then job 2 is inserted while the worker sleeps, and the
     worker builds it on its next cycle without being restarted.
  3. The claim is atomic: a row another worker already moved to
     'generating' is skipped, not built twice.
  4. run_bridges.py drives the CV bridge, skips the not-yet-landed pack
     bridge with a log line, survives a bridge that exits non-zero, and stops
     cleanly on SIGTERM.
  5. --script is additive: giving it without --bridge still runs every
     registered bridge (QA-Edge-Case-Findings.md, 2026-10-19 - it used to
     silently run ONLY the --script path and skip cv/cv_extract/pack/
     general/onboarding entirely, exactly the module's own documented
     Usage example `--loop --script engine/some/other_bridge.py`).

Usage: python3 engine/worker/test_poll_loop.py   (exit 0 = all passed)
"""
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(REPO_ROOT, "engine", "cv"))

from fake_supabase import FakeSupabase  # noqa: E402
from poll_loop import poll_forever  # noqa: E402
import run_bridges  # noqa: E402

CV_BRIDGE = os.path.join(REPO_ROOT, "engine", "cv", "process_cv_jobs.py")
RUNNER = os.path.join(HERE, "run_bridges.py")


def seed(fake):
    fake.insert("people", {"id": "p1", "company_id": "c1", "name": "Test Person", "role": "Contracts Engineer",
                           "ecsa_level": "Professional Engineer", "ecsa_number": "20150155",
                           "highest_description": "MEng", "highest_institution": "US",
                           "highest_graduated": "2015-03-05"})
    fake.insert("projects", {"person_id": "p1", "client_and_number": "ACSA", "value_rm": 150,
                             "position_held": "CE", "contact_name": "K M", "contact_phone": "0",
                             "start_date": "2018-01-01", "end_date": "2020-01-01"})
    fake.insert("companies", {"id": "c1", "legal_name": "Test Co"})


def job(job_id, fmt="sanral_keyperson", detail="summary", status="requested"):
    return {"id": job_id, "company_id": "c1", "person_id": "p1", "status": status,
            "format": fmt, "detail": detail}


def env_for(fake):
    return dict(os.environ, NEXT_PUBLIC_SUPABASE_URL=fake.url, SUPABASE_SERVICE_ROLE_KEY="fake-key",
                PYTHONUNBUFFERED="1")


def wait_for(pred, timeout, what):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if pred():
            return
        time.sleep(0.1)
    raise AssertionError(f"timed out after {timeout}s waiting for {what}")


def status_of(fake, job_id):
    return next(r for r in fake.rows("generated_cvs") if r["id"] == job_id)["status"]


# ---------------------------------------------------------------------------

def test_poll_forever_unit():
    queue = ["job-A"]
    seen, sleeps, cycle_of = [], [], {}
    state = {"cycle": 0, "fail_next": False}

    def poll_once():
        state["cycle"] += 1
        if state["fail_next"]:
            state["fail_next"] = False
            raise ConnectionError("simulated Supabase blip")
        handled = 0
        while queue:
            j = queue.pop(0)
            seen.append(j)
            cycle_of[j] = state["cycle"]
            handled += 1
        return handled

    def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == 1:
            queue.append("job-B")          # arrives while the loop is asleep
        elif len(sleeps) == 2:
            state["fail_next"] = True      # cycle 3 hits a network error
        elif len(sleeps) == 3:
            queue.append("job-C")          # must still be picked up after the error

    logs = []
    stats = poll_forever(poll_once, interval=45, max_cycles=4, sleep=fake_sleep,
                         log=logs.append, install_signal_handlers=False)
    assert seen == ["job-A", "job-B", "job-C"], seen
    assert cycle_of == {"job-A": 1, "job-B": 2, "job-C": 4}, cycle_of
    assert sleeps == [45, 45, 45], sleeps                 # slept between every cycle, not after the last
    assert stats == {"cycles": 4, "jobs": 3, "errors": 1, "stopped_by": "max_cycles"}, stats
    assert any("simulated Supabase blip" in ln for ln in logs), logs
    print("PASS poll_forever: job-A cycle 1, sleep 45s, job-B (arrived during sleep) cycle 2, "
          "cycle 3 error survived, job-C cycle 4")


def test_cv_bridge_loop_end_to_end():
    fake = FakeSupabase().start()
    try:
        seed(fake)
        fake.insert("generated_cvs", job("j1"))
        out = tempfile.mkdtemp(prefix="loop_e2e_")
        interval = 3
        p = subprocess.Popen([sys.executable, CV_BRIDGE, "--loop", "--interval", str(interval),
                              "--max-cycles", "3", "--out-dir", out],
                             env=env_for(fake), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        lines = []
        reader = threading.Thread(target=lambda: lines.extend(iter(p.stdout.readline, "")), daemon=True)
        reader.start()

        wait_for(lambda: status_of(fake, "j1") == "ready", 120, "j1 ready")
        t_j1 = time.time()
        gets_before_j2 = sum(1 for m, path in fake.request_log
                             if m == "GET" and path.startswith("/rest/v1/generated_cvs?status=eq.requested"))
        fake.insert("generated_cvs", job("j2", fmt="world_bank", detail="detailed"))   # appears mid-sleep

        wait_for(lambda: status_of(fake, "j2") == "ready", 120, "j2 ready")
        t_j2 = time.time()
        p.wait(timeout=60)
        reader.join(timeout=5)

        queue_polls = [path for m, path in fake.request_log
                       if m == "GET" and path.startswith("/rest/v1/generated_cvs?status=eq.requested")]
        assert p.returncode == 0, (p.returncode, lines)
        assert gets_before_j2 == 1, f"j2 must not exist before the first poll finished ({gets_before_j2})"
        assert len(queue_polls) == 3, queue_polls                      # 3 cycles, 3 queue polls
        ready = [ln for ln in lines if ln.startswith("[ready]")]
        assert len(ready) == 2 and "j1" in ready[0] and "j2" in ready[1], lines
        assert not any(ln.startswith("No pending") for ln in lines), "loop mode should not log empty polls"
        assert any("stopped (max_cycles) after 3 cycle(s), 2 job(s), 0 failed" in ln for ln in lines), lines
        stored = sorted(k for k in fake.storage)
        assert any(k.endswith("_j1.docx") for k in stored) and any(k.endswith("_j2.docx") for k in stored), stored
        print(f"PASS process_cv_jobs.py --loop: j1 ready, j2 inserted during the {interval}s sleep and "
              f"ready {t_j2 - t_j1:.1f}s later on cycle 2, 3 queue polls, clean exit. Uploaded: {len(stored)} files")
    finally:
        fake.stop()


def test_claim_is_atomic():
    import process_cv_jobs
    fake = FakeSupabase().start()
    try:
        seed(fake)
        # The worker read this row while it was 'requested', but another worker
        # claimed it before this one's PATCH landed.
        fake.insert("generated_cvs", job("j9", status="generating"))
        out = tempfile.mkdtemp(prefix="claim_")
        handled = process_cv_jobs.process_job(fake.url, "fake-key", job("j9"), out)
        assert handled is False
        assert status_of(fake, "j9") == "generating"
        assert not fake.storage, fake.storage
        print("PASS atomic claim: a row already 'generating' is skipped, nothing built or uploaded")
    finally:
        fake.stop()


def test_runner_drives_bridges_and_stops_on_sigterm():
    fake = FakeSupabase().start()
    try:
        seed(fake)
        fake.insert("generated_cvs", job("r1"))
        broken = os.path.join(tempfile.mkdtemp(prefix="broken_bridge_"), "broken_bridge.py")
        with open(broken, "w") as f:
            f.write("import sys\nprint('cannot reach queue')\nsys.exit(2)\n")

        # --bridge onboarding (not cv): since --script is additive (2026-10-19 fix,
        # resolve_bridge_names below) a bare --script with no --bridge now also runs
        # every registered bridge, including the real "cv" one - which would race
        # p_cv's own dedicated --bridge cv cycle for the SAME job r1 against the
        # same fake instance. Caught directly: before this line was added, this test
        # failed intermittently (p's own concurrent cv-bridge pass sometimes claimed
        # r1 first, so p_cv's pass found nothing and never logged "cv: [ready] r1",
        # even though status_of(fake, "r1") still read "ready" - r1 WAS built, just
        # not by the process this assertion checks). Scoping p to a bridge that
        # never touches generated_cvs removes the race entirely.
        p = subprocess.Popen([sys.executable, RUNNER, "--loop", "--interval", "60",
                             "--bridge", "onboarding", "--script", broken],
                             env=env_for(fake), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        # The pack/general/cv_extract bridges have all landed since this test was written, so the
        # "bridge not present yet" path is exercised with a deliberately missing --script instead.
        p_cv = subprocess.Popen([sys.executable, RUNNER, "--loop", "--interval", "2", "--max-cycles", "2",
                                 "--bridge", "cv", "--script", "engine/pack/not_landed_yet.py"],
                                env=env_for(fake), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        out_cv, _ = p_cv.communicate(timeout=180)
        assert p_cv.returncode == 0, out_cv
        assert status_of(fake, "r1") == "ready", out_cv
        assert "not_landed_yet.py: engine/pack/not_landed_yet.py not present yet, skipping" in out_cv, out_cv
        assert out_cv.count("not present yet") == 1, "missing bridge should be reported once, not every cycle"
        assert "cv: [ready] r1" in out_cv, out_cv
        assert "stopped (max_cycles) after 2 cycle(s)" in out_cv, out_cv

        time.sleep(2)                       # broken bridge's first pass has run; loop is now asleep (60s)
        t0 = time.time()
        p.send_signal(signal.SIGTERM)
        out_broken, _ = p.communicate(timeout=15)
        took = time.time() - t0
        assert "broken_bridge.py: cannot reach queue" in out_broken, out_broken
        assert "failed, will retry next cycle" in out_broken and "exited 2" in out_broken, out_broken
        assert "stopped (signal)" in out_broken, out_broken
        assert took < 5, f"SIGTERM during a 60s sleep should stop promptly, took {took:.1f}s"
        print("PASS run_bridges.py: CV bridge fulfilled r1, missing pack bridge skipped (logged once), "
              f"a bridge exiting 2 was logged and the loop survived, SIGTERM mid-sleep stopped it in {took:.1f}s")
    finally:
        fake.stop()


def test_script_flag_is_additive():
    # The real bug, reproduced at the unit level (fast, no subprocess): the
    # old `args.bridge or ([] if args.script else sorted(BRIDGES))` made
    # --script without --bridge resolve to names=[] - NONE of the 5
    # registered bridges ran, only the --script path. --script must only
    # ever ADD scripts, never remove the default set.
    assert run_bridges.resolve_bridge_names(None) == sorted(run_bridges.BRIDGES), \
        "no --bridge/--script at all: every registered bridge runs"
    names_with_script_only = run_bridges.resolve_bridge_names(None)
    assert names_with_script_only == sorted(run_bridges.BRIDGES), \
        "giving --script alone (bridge_arg still None) must not shrink the default set"
    scripts = run_bridges.resolve_scripts(names_with_script_only, ["/tmp/some_custom_bridge.py"])
    labels = [label for label, _ in scripts]
    assert set(sorted(run_bridges.BRIDGES)) <= set(labels), \
        f"every registered bridge must still be in the resolved script list, got {labels}"
    assert "some_custom_bridge.py" in labels, "the --script addition must still be included"

    # --bridge still narrows to just the named bridge(s) when explicitly given.
    assert run_bridges.resolve_bridge_names(["cv"]) == ["cv"], \
        "--bridge cv must narrow to only cv, same as before this fix"
    print("PASS run_bridges.py: --script is additive, --bridge still narrows when given")


def test_timeout_kills_the_whole_process_group():
    # A real bridge that shells out to soffice/LibreOffice (the docx -> pdf
    # step every pack bridge needs) and then hangs leaves that grandchild
    # process running forever if the runner's own timeout only kills the
    # bridge script's own PID - confirmed directly before this fix:
    # subprocess.run's own timeout=... kill (and even adding
    # start_new_session=True to it, with nothing then using the group it
    # creates) only ever reaps the immediate child. This fixture script
    # stands in for that shape: it spawns its own grandchild ("sleep 300"),
    # writes that PID to a file so the test can check on it, then hangs
    # itself well past the runner's own --timeout.
    tmp = tempfile.mkdtemp(prefix="bridge_timeout_")
    pidfile = os.path.join(tmp, "grandchild.pid")
    hanger = os.path.join(tmp, "hangs_with_a_grandchild.py")
    with open(hanger, "w") as f:
        f.write(
            "import subprocess, sys, time\n"
            "p = subprocess.Popen(['sleep', '300'])\n"
            "open(sys.argv[2], 'w').write(str(p.pid))\n"  # argv: [script, '--once', pidfile]
            "time.sleep(300)\n"
        )
    runner = run_bridges.BridgeRunner([("hanger", hanger)], timeout=2, extra_args=[pidfile])
    try:
        runner.run_once()
        raise AssertionError("a hung bridge pass must raise (it's reported as broken)")
    except RuntimeError as e:
        assert "hanger timed out after 2s" in str(e), str(e)

    wait_for(lambda: os.path.exists(pidfile), 5, "the fixture's grandchild PID to be written")
    grandchild_pid = int(open(pidfile).read())

    def grandchild_is_gone():
        try:
            os.kill(grandchild_pid, 0)
            return False
        except ProcessLookupError:
            return True
    wait_for(grandchild_is_gone, 5, f"the leaked grandchild (pid {grandchild_pid}) to actually be killed, "
                                    "not just the bridge script's own PID")
    print(f"PASS run_bridges.py: a bridge pass timing out kills its whole process group - "
          f"grandchild pid {grandchild_pid} (its own 'sleep 300', standing in for a hung soffice) is dead too, "
          f"not leaked")


if __name__ == "__main__":
    test_poll_forever_unit()
    test_claim_is_atomic()
    test_cv_bridge_loop_end_to_end()
    test_runner_drives_bridges_and_stops_on_sigterm()
    test_script_flag_is_additive()
    test_timeout_kills_the_whole_process_group()
    print("All bridge-loop smoke tests passed.")
