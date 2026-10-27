"""
record_heartbeat.py - CLI + payload shape only (no live Supabase needed,
same set_sink() escape hatch system_alerts.py's own tests use).

    python3 engine/notify/test_record_heartbeat.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import record_heartbeat as rh

PASS = 0
FAIL = 0


def check(label, cond):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        print(f"FAIL: {label}")


def main():
    calls = []
    rh.set_sink(lambda rpc, payload: calls.append((rpc, payload)))
    try:
        rh.start("compliance_digest")
        check("start calls the start rpc", calls[-1][0] == "record_workflow_heartbeat_start")
        check("start passes the key", calls[-1][1] == {"p_workflow_key": "compliance_digest"})

        rh.finish("compliance_digest", "success", items_processed=12)
        check("finish calls the finish rpc", calls[-1][0] == "record_workflow_heartbeat_finish")
        check("finish success payload", calls[-1][1] == {
            "p_workflow_key": "compliance_digest", "p_status": "success", "p_error": None, "p_items_processed": 12,
        })

        rh.finish("compliance_digest", "failed", error="step 3 exited 1")
        check("finish failed payload", calls[-1][1] == {
            "p_workflow_key": "compliance_digest", "p_status": "failed", "p_error": "step 3 exited 1", "p_items_processed": None,
        })

        try:
            rh.finish("x", "bogus")
            check("finish rejects a bad status", False)
        except ValueError:
            check("finish rejects a bad status", True)

        # CLI parses through to the same functions.
        calls.clear()
        rh.main(["start", "--key", "scout_alerts"])
        check("CLI start", calls == [("record_workflow_heartbeat_start", {"p_workflow_key": "scout_alerts"})])

        calls.clear()
        rh.main(["finish", "--key", "scout_alerts", "--status", "failed", "--error", "boom", "--items", "3"])
        check("CLI finish", calls == [("record_workflow_heartbeat_finish", {
            "p_workflow_key": "scout_alerts", "p_status": "failed", "p_error": "boom", "p_items_processed": 3,
        })])
    finally:
        rh.set_sink(None)

    # Never raises even with no sink and no Supabase env configured.
    os.environ.pop("NEXT_PUBLIC_SUPABASE_URL", None)
    os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)
    try:
        ok = rh.start("no_env_configured")
        check("start never raises with no env configured", ok is False)
    except Exception as e:
        check(f"start never raises with no env configured (raised {e})", False)

    print(f"\n{PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
