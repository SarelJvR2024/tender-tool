"""
Focused test for send_pack_ready_email.py (notification engine migration,
2026-10-27, item B12). No real subprocess (node) or network (Resend) call -
subprocess.run and urllib.request.urlopen are both monkeypatched, same
discipline engine/cv/test_extract_cv_fields.py already uses for its own
flaky_request()/download() fakes.

Run: python3 engine/notify/test_send_pack_ready_email.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
# Set BEFORE importing system_alerts (via send_pack_ready_email) so a
# render/send failure test never makes a real write against this
# environment's own live Supabase credentials - system_alerts.record()'s
# own documented escape hatch, not a monkeypatch of its urlopen call.
os.environ["SYSTEM_ALERTS_DISABLED"] = "1"
# Every test here except the one that specifically targets the missing-key
# path (which pops/restores this itself) is about something else entirely
# (claim/recipient/render behaviour) and must not silently depend on
# whatever this sandbox's own ambient environment happens to have set -
# setdefault so a real exported key (e.g. for live-send verification
# elsewhere) is left alone, but a run with none set is still deterministic.
os.environ.setdefault("RESEND_API_KEY", "re_test_dummy_key")
import send_pack_ready_email as pr  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


class FakeClient:
    """Matches the real Supabase.rpc()/select() call shape. rpc_responses maps fn name -> either a plain return value or a callable(args) -> value, so a test can assert on exactly what args each RPC call received."""

    def __init__(self, rpc_responses=None, table_rows=None):
        self.rpc_responses = rpc_responses or {}
        self.table_rows = table_rows or {}
        self.rpc_calls = []

    def rpc(self, fn, args=None):
        self.rpc_calls.append((fn, args))
        resp = self.rpc_responses.get(fn)
        if callable(resp):
            return resp(args)
        return resp

    def select(self, table, filters=None):
        rows = self.table_rows.get(table, [])
        if not filters:
            return rows
        return [r for r in rows if all(r.get(k) == v for k, v in filters.items())]


class FakeCompletedProcess:
    def __init__(self, returncode, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def _job():
    return {"id": "job-1", "company_id": "co-1", "tender_id": "ten-1"}


def _base_client(claimed=True, recipients=None):
    recipients = recipients if recipients is not None else [{"email": "a@example.com", "daily_digest_opt_in": True}]
    return FakeClient(
        rpc_responses={
            "claim_notification": lambda args: claimed,
            "company_notification_recipients": lambda args: recipients,
            "record_notification_sent": lambda args: None,
        },
        table_rows={
            "tenders": [{"id": "ten-1", "contract_no": "N.007-030-2026/1F", "buyer": "SANRAL", "description": "Rehab works"}],
            "companies": [{"id": "co-1", "legal_name": "Reviewer Civils (Pty) Ltd"}],
        },
    )


def test_skips_cleanly_when_already_claimed():
    client = _base_client(claimed=False)
    pr.send_pack_ready_email(client, _job(), 42, "https://tenderready.app")
    rpc_names = [c[0] for c in client.rpc_calls]
    check("claim_notification was attempted", "claim_notification" in rpc_names)
    check("no recipients lookup happened once the claim failed", "company_notification_recipients" not in rpc_names)


def test_skips_cleanly_with_no_opted_in_recipients():
    client = _base_client(recipients=[{"email": "b@example.com", "daily_digest_opt_in": False}])
    pr.send_pack_ready_email(client, _job(), 42, "https://tenderready.app")
    rpc_names = [c[0] for c in client.rpc_calls]
    check("no send was logged when nobody is opted in", "record_notification_sent" not in rpc_names)


def test_missing_api_key_does_not_claim_so_the_email_can_still_be_sent_once_one_is_added():
    """lib/notificationEngine.ts's own sendNotification() checks
    resendApiKeyConfigured() BEFORE calling claim_notification() - its own
    header comment explains why: notification_claims is a one-time-only
    token, so claiming it with no key to actually send with would
    permanently lose this exact notification, even after a key is later
    configured. send_pack_ready_email.py used to claim first and only
    discover the missing key deep inside the per-recipient send loop -
    this job never runs again for the same job id, so that claim would
    have burned the pack's one and only "ready" email forever."""
    had_key = "RESEND_API_KEY" in os.environ
    old_key = os.environ.pop("RESEND_API_KEY", None)
    try:
        client = _base_client()
        pr.send_pack_ready_email(client, _job(), 42, "https://tenderready.app")
        rpc_names = [c[0] for c in client.rpc_calls]
        check("claim_notification was never even attempted with no API key configured",
              "claim_notification" not in rpc_names, rpc_names)
        check("nothing was logged either - there was never a real send attempt",
              "record_notification_sent" not in rpc_names, rpc_names)
    finally:
        if had_key:
            os.environ["RESEND_API_KEY"] = old_key


def test_happy_path_renders_sends_and_logs(monkeypatch):
    client = _base_client()
    rendered = {"subject": "[N.007-030-2026/1F] Bid Pack Compiled & Ready for Print/Review | SANRAL", "html": "<p>hi</p>", "text": "hi"}

    def fake_run(cmd, cwd, capture_output, text, timeout):
        return FakeCompletedProcess(0, stdout=json.dumps(rendered))

    sent_bodies = []

    class FakeResp:
        def read(self):
            return json.dumps({"id": "resend-123"}).encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout):
        sent_bodies.append(json.loads(req.data.decode()))
        return FakeResp()

    monkeypatch_module(pr.subprocess, "run", fake_run)
    monkeypatch_module(pr.urllib.request, "urlopen", fake_urlopen)
    monkeypatch_module(os.environ, None, None, env={"RESEND_API_KEY": "re_test", "RESEND_FROM_BIDS": "Tender Ready Bids <bids@tenderready.app>"})

    pr.send_pack_ready_email(client, _job(), 42, "https://tenderready.app")

    check("exactly one email was sent", len(sent_bodies) == 1, str(sent_bodies))
    if sent_bodies:
        check("subject matches the rendered template exactly", sent_bodies[0]["subject"] == rendered["subject"])
        check("sent from the bids sender identity", sent_bodies[0]["from"] == "Tender Ready Bids <bids@tenderready.app>")
    log_calls = [c for c in client.rpc_calls if c[0] == "record_notification_sent"]
    check("exactly one notification_logs write", len(log_calls) == 1)
    if log_calls:
        check("logged as sent with the real Resend id", log_calls[0][1]["p_status"] == "sent" and log_calls[0][1]["p_resend_id"] == "resend-123")


def test_render_failure_is_caught_and_never_raises(monkeypatch):
    client = _base_client()

    def fake_run_fails(cmd, cwd, capture_output, text, timeout):
        return FakeCompletedProcess(1, stdout="", stderr="boom")

    monkeypatch_module(pr.subprocess, "run", fake_run_fails)

    raised = False
    try:
        pr.send_pack_ready_email(client, _job(), 42, "https://tenderready.app")
    except Exception:
        raised = True
    check("a render failure never raises into the caller - the pack job must not be failed by an email problem", raised is False)
    log_calls = [c for c in client.rpc_calls if c[0] == "record_notification_sent"]
    check("nothing was logged as sent when rendering itself failed", len(log_calls) == 0)


def monkeypatch_module(obj, attr, value, env=None):
    """Minimal manual monkeypatch (no pytest fixture available in this plain-script test harness) - every patch here is process-local and this test file is always run as its own fresh interpreter, so there's nothing to restore."""
    if env is not None:
        os.environ.update(env)
        return
    setattr(obj, attr, value)


def main():
    test_skips_cleanly_when_already_claimed()
    test_skips_cleanly_with_no_opted_in_recipients()
    test_missing_api_key_does_not_claim_so_the_email_can_still_be_sent_once_one_is_added()
    test_happy_path_renders_sends_and_logs(None)
    test_render_failure_is_caught_and_never_raises(None)

    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
