"""
Runs every async bridge script on a schedule, in one process, so nobody has
to type a command for a queued CV or pack request to get fulfilled.

What it drives: any script that follows the bridge contract below. Four are
registered by name:

    cv       engine/cv/process_cv_jobs.py           (generated_cvs)
    cv_extract engine/cv/extract_cv_fields.py       (cv_uploads mode=ai_extract ->
                                                     cv_extraction_results; needs
                                                     ANTHROPIC_API_KEY once a CV is queued)
    pack     engine/pack/process_pack_jobs.py       (pack_generation_jobs, SANRAL)
    general  engine/general/process_general_jobs.py (pack_generation_jobs, engine='general':
                                                     non-SANRAL requirement extraction + packs)
    onboarding engine/onboarding/process_onboarding_jobs.py (onboarding_uploads ->
                                                     onboarding_document_results; needs
                                                     ANTHROPIC_API_KEY once a document is queued)

pack and general poll the SAME table (pack_generation_jobs - one queue), each
claiming only its own `engine` value.

and any other one can be added with --script PATH.

The bridge contract (all a script needs for this runner to drive it):
  - `python3 <script> --once` processes whatever is queued, then exits;
  - exit code 0 = the pass ran (individual jobs may still have been marked
    'failed' in their own rows, which is the script's business), non-zero =
    the pass itself broke (missing env vars, Supabase unreachable);
  - it reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the
    environment, which this runner passes through unchanged.

Each bridge runs as its own subprocess every cycle rather than being imported.
That keeps this runner generic (it doesn't need to know the pack bridge's
internal function names, which don't exist yet), a crash or a leaked
LibreOffice process in one bridge can't take down the other, and memory is
handed back after each pass. The cost is a Python start-up per bridge per
cycle, which is well under a second.

Each bridge also has its own --loop flag for running it alone; this runner is
for the normal case of one worker serving both queues.

Failures reach Sarel, not just this log (system alerts, migration 0042,
engine/alerts/system_alerts.py): a bridge pass that exits non-zero or times
out, and a crash of this runner itself, are recorded as `critical` alerts
under source "worker" (the bridge's output tail as the detail). Each bridge
records its own job-level failures (a crashed job, a refused job as a
warning, a job stuck in 'generating') under its own source. One open alert
per distinct failure - a pass failing every 30 s counts occurrences on one
row. engine/alerts/check_system_alerts.py reports them for the e-mail.

Usage:
    python3 run_bridges.py                        # one pass over every bridge, then exit
    python3 run_bridges.py --loop                 # always-on worker (what the container runs)
    python3 run_bridges.py --loop --interval 60 --bridge cv
    python3 run_bridges.py --loop --script engine/some/other_bridge.py

Pointing it at the pack bridge once it lands: nothing to do if it lands at
engine/pack/process_pack_jobs.py and supports --once. If it lands somewhere
else, change BRIDGES["pack"] below (or pass --script <its path>). If it has
no --once flag, give it one: that's the contract.
"""
import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from poll_loop import poll_forever, DEFAULT_INTERVAL_SECONDS, system_alerts  # noqa: E402

BRIDGES = {
    "cv": "engine/cv/process_cv_jobs.py",
    # AI field extraction from uploaded CVs (0023); proposes, never writes people/projects
    "cv_extract": "engine/cv/extract_cv_fields.py",
    "pack": "engine/pack/process_pack_jobs.py",  # pack_generation_jobs, engine='sanral'
    # non-SANRAL requirement extraction + pack generation (pack_generation_jobs, engine='general')
    "general": "engine/general/process_general_jobs.py",
    # bulk onboarding document scan (0063): onboarding_uploads -> onboarding_document_results;
    # needs ANTHROPIC_API_KEY once a document is queued, same as cv_extract
    "onboarding": "engine/onboarding/process_onboarding_jobs.py",
}

# A pass that finds nothing prints exactly this kind of line. In loop mode that
# would be two log lines every 30 seconds forever, burying the ones that matter,
# so passes whose only output is these lines are not echoed.
QUIET_PREFIXES = ("No pending",)  # "No pending general engine jobs." / "No pending CV extraction requests." too

DEFAULT_BRIDGE_TIMEOUT = 30 * 60  # a whole tender pack can take a while; a hung soffice can't stall forever


class BridgeRunner:
    def __init__(self, scripts, timeout=DEFAULT_BRIDGE_TIMEOUT, extra_args=(), log=print):
        self.scripts = scripts            # list of (label, absolute path)
        self.timeout = timeout
        self.extra_args = list(extra_args)
        self.log = log
        self._missing_reported = set()

    def run_once(self):
        """One pass over every bridge. Returns how many bridges produced
        output worth showing (i.e. did something). Raises if any bridge pass
        broke, after still running the others."""
        did_something, broken = 0, []
        for label, path in self.scripts:
            if not os.path.exists(path):
                if label not in self._missing_reported:
                    self.log(f"{label}: {os.path.relpath(path, REPO_ROOT)} not present yet, skipping "
                             f"(re-checked every cycle)")
                    self._missing_reported.add(label)
                continue
            if label in self._missing_reported:
                self.log(f"{label}: {os.path.relpath(path, REPO_ROOT)} is now present, running it")
                self._missing_reported.discard(label)
            try:
                p = subprocess.run([sys.executable, path, "--once"] + self.extra_args,
                                   cwd=REPO_ROOT, capture_output=True, text=True, timeout=self.timeout)
            except subprocess.TimeoutExpired as e:
                broken.append(f"{label} timed out after {self.timeout}s")
                out = (e.stdout or b"") + (e.stderr or b"")
                out = out.decode(errors="replace") if isinstance(out, bytes) else out
                system_alerts.record("worker", f"The {label} bridge pass timed out after {self.timeout}s and was killed",
                                     "critical", detail=out[-8000:] or None,
                                     context={"bridge": label, "script": os.path.relpath(path, REPO_ROOT)})
                continue
            lines = [ln for ln in (p.stdout + p.stderr).splitlines() if ln.strip()]
            meaningful = [ln for ln in lines if not ln.startswith(QUIET_PREFIXES)]
            if meaningful:
                did_something += 1
                for ln in meaningful:
                    self.log(f"{label}: {ln}")
            if p.returncode != 0:
                broken.append(f"{label} exited {p.returncode}")
                # The pass itself broke (crash, missing env, Supabase down) -
                # nobody watches this log, so it goes to system_alerts.
                tail = "\n".join(lines[-80:])
                last = next((ln for ln in reversed(lines) if not ln.startswith("[system-alert]")), "")
                system_alerts.record("worker", f"The {label} bridge pass failed (exit {p.returncode}): {last[:300]}",
                                     "critical", detail=tail or None,
                                     context={"bridge": label, "script": os.path.relpath(path, REPO_ROOT),
                                              "exit_code": p.returncode})
        if broken:
            raise RuntimeError("; ".join(broken))
        return did_something


def resolve_bridge_names(bridge_arg):
    """Which registered bridges to run, before --script's own additions
    (resolve_scripts, below) are layered on top. --script is ADDITIVE
    ("and any other one can be added with --script PATH" - this file's own
    module docstring) - it must never be the reason the default set shrinks
    to nothing. --bridge still narrows to just the named bridge(s) when
    given. QA-Edge-Case-Findings.md, 2026-10-19."""
    return bridge_arg or sorted(BRIDGES)


def resolve_scripts(bridge_names, extra_scripts):
    scripts = [(name, os.path.join(REPO_ROOT, BRIDGES[name])) for name in bridge_names]
    for s in extra_scripts:
        path = s if os.path.isabs(s) else os.path.join(REPO_ROOT, s)
        scripts.append((os.path.basename(s), path))
    return scripts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="one pass over every bridge, then exit (the default)")
    mode.add_argument("--loop", "--daemon", dest="loop", action="store_true", help="keep polling until stopped")
    ap.add_argument("--interval", type=int,
                    default=int(os.environ.get("BRIDGE_POLL_INTERVAL", DEFAULT_INTERVAL_SECONDS)),
                    help=f"seconds between passes (default {DEFAULT_INTERVAL_SECONDS}, or $BRIDGE_POLL_INTERVAL)")
    ap.add_argument("--max-cycles", type=int, default=None, help="--loop only: stop after N passes (tests)")
    ap.add_argument("--bridge", action="append", choices=sorted(BRIDGES),
                    help="which registered bridge(s) to run; repeatable (default: all)")
    ap.add_argument("--script", action="append", default=[],
                    help="path to any other bridge script that supports --once; repeatable")
    ap.add_argument("--timeout", type=int, default=DEFAULT_BRIDGE_TIMEOUT,
                    help="seconds one bridge pass may take before it is killed")
    args = ap.parse_args(argv)
    if args.interval <= 0:
        ap.error("--interval must be a positive number of seconds")

    names = resolve_bridge_names(args.bridge)
    runner = BridgeRunner(resolve_scripts(names, args.script), timeout=args.timeout)

    if not args.loop:
        try:
            runner.run_once()
        except RuntimeError as e:
            print(f"bridge pass failed: {e}")
            return 1
        return 0

    poll_forever(runner.run_once, interval=args.interval, max_cycles=args.max_cycles, name="run_bridges",
                 unit="bridge pass(es) with activity")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # the worker itself crashed: the one failure nobody would otherwise see
        system_alerts.record("worker", f"run_bridges.py crashed: {type(e).__name__}: {e}", "critical", exc=e)
        raise
