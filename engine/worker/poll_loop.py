"""
The one polling loop shared by every async bridge script (engine/cv/
process_cv_jobs.py today, engine/pack/process_pack_jobs.py once it lands).

Why it exists: the web app (Next.js on Vercel) cannot run Python or
LibreOffice, so document generation is fulfilled out-of-band by bridge
scripts that read 'requested' rows from Supabase. Each bridge has a one-shot
mode ("process whatever is queued, then exit"). Before this module, keeping a
bridge running meant either a person typing the command each time or a
hand-rolled `while True: ...; time.sleep(30)` inside each script. That
original loop in process_cv_jobs.py had no error handling: one failed HTTP
call (a Supabase blip, a DNS hiccup) raised out of the loop and killed the
process, which is the wrong behaviour for something meant to run unattended
for months. This module is the loop, written once:

  - poll, sleep `interval` seconds, repeat;
  - an exception inside one poll is logged and the loop carries on (counted
    in the returned stats), it never kills the worker;
  - SIGTERM / SIGINT (what Railway, Render, Fly, Docker and systemd send on a
    redeploy or stop) finish the current poll, then exit cleanly instead of
    dying halfway through uploading a document;
  - `max_cycles` / `max_runtime` bound the loop (tests, and any host that
    wants a run to end on its own);
  - `sleep` is injectable so tests can prove the loop really sleeps between
    polls without waiting in real time.

Usage from a bridge script:

    from poll_loop import poll_forever
    poll_forever(lambda: poll_once(url, key, out_dir), interval=30)

`poll_once` must return the number of jobs it handled (0 when the queue was
empty). That number is only used for logging and the returned stats.
"""
import signal
import threading
import time

DEFAULT_INTERVAL_SECONDS = 30


def _ts():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def poll_forever(poll_once, interval=DEFAULT_INTERVAL_SECONDS, max_cycles=None,
                 max_runtime=None, sleep=None, log=print, stop_event=None,
                 install_signal_handlers=True, name="bridge", unit="job(s)"):
    """Call poll_once() every `interval` seconds until stopped.

    Returns {"cycles": n, "jobs": total handled, "errors": failed polls,
    "stopped_by": "max_cycles" | "max_runtime" | "signal"}.
    """
    if interval <= 0:
        raise ValueError("interval must be > 0 seconds")
    stop_event = stop_event or threading.Event()
    if sleep is None:
        # Event.wait returns early the moment a stop signal arrives, so a
        # SIGTERM during a 60s sleep doesn't hold a redeploy up for 60s.
        sleep = stop_event.wait

    if install_signal_handlers and threading.current_thread() is threading.main_thread():
        def _stop(signum, _frame):
            log(f"[{_ts()}] {name}: received signal {signum}, stopping after the current poll")
            stop_event.set()
        signal.signal(signal.SIGTERM, _stop)
        signal.signal(signal.SIGINT, _stop)

    started = time.monotonic()
    stats = {"cycles": 0, "jobs": 0, "errors": 0, "stopped_by": None}
    log(f"[{_ts()}] {name}: polling every {interval}s"
        + (f", at most {max_cycles} cycles" if max_cycles else "")
        + (f", at most {max_runtime}s" if max_runtime else ""))

    while True:
        stats["cycles"] += 1
        try:
            handled = poll_once() or 0
            stats["jobs"] += handled
            if handled:
                log(f"[{_ts()}] {name}: cycle {stats['cycles']} handled {handled} {unit}")
        except Exception as e:  # never let one bad poll kill an unattended worker
            stats["errors"] += 1
            log(f"[{_ts()}] {name}: cycle {stats['cycles']} failed, will retry next cycle: "
                f"{type(e).__name__}: {e}")

        if stop_event.is_set():
            stats["stopped_by"] = "signal"
            break
        if max_cycles is not None and stats["cycles"] >= max_cycles:
            stats["stopped_by"] = "max_cycles"
            break
        if max_runtime is not None and time.monotonic() - started + interval > max_runtime:
            stats["stopped_by"] = "max_runtime"
            break

        sleep(interval)
        if stop_event.is_set():
            stats["stopped_by"] = "signal"
            break

    log(f"[{_ts()}] {name}: stopped ({stats['stopped_by']}) after {stats['cycles']} cycle(s), "
        f"{stats['jobs']} {unit}, {stats['errors']} failed poll(s)")
    return stats
