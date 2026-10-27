"""
Workflow heartbeats: "did this GitHub Actions workflow actually run, and did
it succeed" (Notification Command Center brief, Phase 1, 2026-10-27). Wired
as the FIRST and LAST steps of each of the 9 notification-sending workflows
(see .github/workflows/*.yml) - never inside the business-logic scripts
themselves, so adding this instrumentation can never touch tested send
logic.

    python3 engine/notify/record_heartbeat.py start --key compliance_digest
    python3 engine/notify/record_heartbeat.py finish --key compliance_digest --status success
    python3 engine/notify/record_heartbeat.py finish --key compliance_digest --status failed --error "step X exited 1"

Same shape as engine/alerts/system_alerts.py (zero dependencies beyond the
stdlib, so no `pip install` step is needed before this runs; service-role
key from the environment; 10s timeout; never raises - a heartbeat that
can't be recorded is a problem with the heartbeat table, not a reason to
fail the actual send job). Calls record_workflow_heartbeat_start /
record_workflow_heartbeat_finish (migration 0099) directly via PostgREST's
RPC endpoint, exactly like system_alerts.record() calls record_system_alert.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request

TIMEOUT = 10
_sink = None


def set_sink(fn):
    """Tests: route the (rpc_name, payload) pair to fn(...) instead of a real HTTP call. set_sink(None) restores it."""
    global _sink
    _sink = fn


def _call(rpc_name, payload, url=None, key=None):
    """POST to one of the two heartbeat RPCs. Never raises - prints and returns False on any failure, same rule as system_alerts.record()."""
    if _sink is not None:
        try:
            _sink(rpc_name, payload)
            return True
        except Exception as e:
            print(f"[heartbeat] test sink failed: {e}", file=sys.stderr)
            return False
    url = url or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("[heartbeat] not recorded: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set", file=sys.stderr)
        return False
    req = urllib.request.Request(
        f"{url.rstrip('/')}/rest/v1/rpc/{rpc_name}", method="POST", data=json.dumps(payload).encode(),
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT):
            pass
        return True
    except urllib.error.HTTPError as e:
        print(f"[heartbeat] not recorded: {e.code} {e.read().decode(errors='replace')[:200]}", file=sys.stderr)
    except Exception as e:
        print(f"[heartbeat] not recorded: {type(e).__name__}: {e}", file=sys.stderr)
    return False


def start(workflow_key):
    print(f"[heartbeat] {workflow_key}: running")
    return _call("record_workflow_heartbeat_start", {"p_workflow_key": workflow_key})


def finish(workflow_key, status, error=None, items_processed=None):
    if status not in ("success", "failed"):
        raise ValueError("status must be success or failed")
    print(f"[heartbeat] {workflow_key}: {status}" + (f" ({error})" if error else ""))
    return _call("record_workflow_heartbeat_finish", {
        "p_workflow_key": workflow_key, "p_status": status,
        "p_error": (error or None), "p_items_processed": items_processed,
    })


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)

    p_start = sub.add_parser("start")
    p_start.add_argument("--key", required=True)

    p_finish = sub.add_parser("finish")
    p_finish.add_argument("--key", required=True)
    p_finish.add_argument("--status", required=True, choices=["success", "failed"])
    p_finish.add_argument("--error", default=None)
    p_finish.add_argument("--items", type=int, default=None)

    args = parser.parse_args(argv)
    if args.action == "start":
        start(args.key)
    else:
        finish(args.key, args.status, args.error, args.items)
    # Never fails the calling job - a heartbeat write is diagnostic, not a
    # gate (same reasoning system_alerts.record() never raises).
    return 0


if __name__ == "__main__":
    sys.exit(main())
