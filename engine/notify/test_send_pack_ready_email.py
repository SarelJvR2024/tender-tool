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


def test_skips_cleanly_when_already_claimed(monkeypatch):
    """claim_notification() now runs AFTER the recipients lookup/render
    (2026-10-30 fix, see test_render_failure_never_wastes_the_one_time_claim
    below) - so an already-claimed job still does that work first, then
    discovers the claim fails and sends nothing. Render must be mocked here
    or this test would really shell out to node."""
    client = _base_client(claimed=False)

    def fake_run(cmd, cwd, capture_output, text, timeout):
        return FakeCompletedProcess(0, stdout=json.dumps({"subject": "s", "html": "<p>h</p>", "text": "t"}))

    monkeypatch_module(pr.subprocess, "run", fake_run)
    pr.send_pack_ready_email(client, _job(), 42, "https://tenderready.app")
    rpc_names = [c[0] for c in client.rpc_calls]
    check("claim_notification was attempted", "claim_notification" in rpc_names)
    check("nothing was sent/logged once the claim came back already-taken", "record_notification_sent" not in rpc_names)


def test_skips_cleanly_with_no_valid_email_recipients():
    client = _base_client(recipients=[{"email": "", "daily_digest_opt_in": True}])
    pr.send_pack_ready_email(client, _job(), 42, "https://tenderready.app")
    rpc_names = [c[0] for c in client.rpc_calls]
    check("no send was logged when nobody has a usable email", "record_notification_sent" not in rpc_names)


def test_sends_regardless_of_daily_digest_opt_in(monkeypatch):
    """Standing-review finding, 2026-11-07: this used to filter recipients
    on daily_digest_opt_in - but that flag is the unrelated "new tenders
    discovered" digest opt-in (migration 0073; Notifications.tsx's own
    toggle is literally labelled "daily digest", default off), not a
    general "do I want email from this company" switch. Same reasoning as
    lib/notificationRecipients.ts's own criticalBidRecipients() (2026-10-30),
    which deliberately does NOT filter on it for corrigenda/returnables/
    closing-deadline alerts - a pack with its own tight courier/print
    deadline is exactly as time-critical as those. A company member who
    never opted into the digest must still get told their own pack is
    ready."""
    client = _base_client(recipients=[
        {"email": "never-opted-into-digest@example.com", "daily_digest_opt_in": False},
    ])
    rendered = {"subject": "s", "html": "<p>h</p>", "text": "t"}

    def fake_run(cmd, cwd, capture_output, text, timeout):
        return FakeCompletedProcess(0, stdout=json.dumps(rendered))

    sent_to = []

    class FakeResp:
        def read(self):
            return json.dumps({"id": "resend-1"}).encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout):
        sent_to.append(json.loads(req.data.decode())["to"][0])
        return FakeResp()

    monkeypatch_module(pr.subprocess, "run", fake_run)
    monkeypatch_module(pr.urllib.request, "urlopen", fake_urlopen)
    pr.send_pack_ready_email(client, _job(), 42, "https://tenderready.app")

    check("the pack-ready email was sent even though daily_digest_opt_in is False",
          sent_to == ["never-opted-into-digest@example.com"], sent_to)


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
    rpc_names = [c[0] for c in client.rpc_calls]
    check("claim_notification was NEVER called - a render failure must not burn the one-time claim "
          "(this job never runs again for the same job id, so claiming before a render failure would "
          "have lost this pack's one and only 'ready' email forever)",
          "claim_notification" not in rpc_names, rpc_names)


def test_render_failure_never_wastes_the_one_time_claim():
    """Regression test for the 2026-10-30 standing-review finding: this
    function used to call claim_notification() BEFORE the recipients
    lookup, the tender/company select AND _render() - every one of which
    can raise (a network blip, a bad render-script exit, an empty lookup).
    Since no cron/retry ever re-invokes this function for the same job id,
    any failure after the old claim point permanently burned the claim with
    nothing ever sent - the exact bug class the missing-API-key check
    above was already written to avoid, just not closed for these other
    failure modes. Fixed by moving the claim to immediately before the
    first real send, after render has already succeeded - this test
    asserts the claim is reached at all once render DOES succeed (the
    happy path above already proves the actual send still happens)."""
    client = _base_client()
    rendered = {"subject": "s", "html": "<p>h</p>", "text": "t"}

    def fake_run(cmd, cwd, capture_output, text, timeout):
        return FakeCompletedProcess(0, stdout=json.dumps(rendered))

    def fake_urlopen(req, timeout):
        class FakeResp:
            def read(self):
                return json.dumps({"id": "resend-999"}).encode()

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        return FakeResp()

    monkeypatch_module(pr.subprocess, "run", fake_run)
    monkeypatch_module(pr.urllib.request, "urlopen", fake_urlopen)
    pr.send_pack_ready_email(client, _job(), 42, "https://tenderready.app")

    call_order = [c[0] for c in client.rpc_calls]
    claim_idx = call_order.index("claim_notification") if "claim_notification" in call_order else -1
    recipients_idx = call_order.index("company_notification_recipients") if "company_notification_recipients" in call_order else -1
    check("claim_notification was called", claim_idx != -1, call_order)
    check("the recipients lookup (and therefore render too, in the real flow) happened BEFORE the claim",
          recipients_idx != -1 and recipients_idx < claim_idx, call_order)


def test_one_recipients_record_notification_sent_failure_does_not_lose_the_rest():
    """QA pass, 2026-11-05: record_notification_sent() is a real network RPC
    call with no guard of its own, inside a for loop with no per-item
    isolation - a transient failure on it for the FIRST recipient (not the
    Resend send itself, which _send_via_resend() already never lets raise)
    used to abort the whole loop via the outer except, silently losing every
    OTHER recipient's email too. Since claim_notification() is a one-time
    token and this job never runs again for the same job id, that
    permanently lost the rest of the company's "pack ready" email - the
    exact bug class this file's own claim-timing fixes (2026-10-28,
    2026-10-30) already exist to avoid, just not closed for a per-recipient
    failure after the claim already succeeded."""
    client = _base_client(recipients=[
        {"email": "a@example.com", "daily_digest_opt_in": True},
        {"email": "b@example.com", "daily_digest_opt_in": True},
    ])

    def flaky_record(args):
        if args["p_recipient_email"] == "a@example.com":
            raise RuntimeError("simulated transient Supabase blip")
        return None
    client.rpc_responses["record_notification_sent"] = flaky_record

    rendered = {"subject": "s", "html": "<p>h</p>", "text": "t"}

    def fake_run(cmd, cwd, capture_output, text, timeout):
        return FakeCompletedProcess(0, stdout=json.dumps(rendered))

    sent_to = []

    class FakeResp:
        def read(self):
            return json.dumps({"id": "resend-1"}).encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout):
        sent_to.append(json.loads(req.data.decode())["to"][0])
        return FakeResp()

    monkeypatch_module(pr.subprocess, "run", fake_run)
    monkeypatch_module(pr.urllib.request, "urlopen", fake_urlopen)

    raised = False
    try:
        pr.send_pack_ready_email(client, _job(), 42, "https://tenderready.app")
    except Exception:
        raised = True
    check("a per-recipient record_notification_sent failure never raises into the caller", raised is False)
    check("BOTH recipients still got a real Resend send attempt, not just the one before the failure",
          sent_to == ["a@example.com", "b@example.com"], sent_to)
    log_calls = [c[1]["p_recipient_email"] for c in client.rpc_calls if c[0] == "record_notification_sent"]
    check("record_notification_sent was attempted for both recipients (the second one succeeding)",
          log_calls == ["a@example.com", "b@example.com"], log_calls)


def test_send_via_resend_from_address_matches_the_real_ops_fallback_the_docstring_claims():
    """Standing-review finding: _send_via_resend()'s own docstring claims
    parity with app/lib/resendEmail.ts's sendTransactionalEmail() - "same
    sender-profile fallback chain (RESEND_FROM_BIDS -> RESEND_FROM_ADDRESS ->
    a literal default)" - but the real TS function (resolveFromAddress(),
    called for the "ops" profile every Tier-1 sender uses) was changed by
    commit 80d4b6c (2026-10-24, BEFORE this file was even created on
    2026-10-27) to resolve each sender profile's OWN env var independently,
    with NO cross-profile fallback to RESEND_FROM_ADDRESS at all - an unset
    RESEND_FROM_BIDS falls straight to this file's own hardcoded
    "Tender Ready Bids <bids@tenderready.app>" default, never to Tier 0's
    address. This docstring/implementation never matched that real
    behaviour, not even on day one. Live-verified against the real
    sendTransactionalEmail() via `cd app && npx vitest run` with a
    temporary Resend-mocking spec (RESEND_FROM_BIDS unset,
    RESEND_FROM_ADDRESS="Tier0 <team@tenderready.app>"): TS sent from
    "Tender Ready Bids <bids@tenderready.app>", never touching
    RESEND_FROM_ADDRESS for the ops/bids profile."""
    old_bids = os.environ.pop("RESEND_FROM_BIDS", None)
    old_addr = os.environ.get("RESEND_FROM_ADDRESS")
    os.environ["RESEND_FROM_ADDRESS"] = "Tier0 <team@tenderready.app>"
    os.environ["RESEND_API_KEY"] = "re_test"
    captured = {}

    class FakeResp:
        def read(self):
            return json.dumps({"id": "resend-x"}).encode()

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def fake_urlopen(req, timeout=30):
        captured["from"] = json.loads(req.data.decode())["from"]
        return FakeResp()

    try:
        monkeypatch_module(pr.urllib.request, "urlopen", fake_urlopen)
        pr._send_via_resend("x@example.com", "s", "<p>h</p>", "t")
        check(
            "with RESEND_FROM_BIDS unset and RESEND_FROM_ADDRESS set, "
            "_send_via_resend() sends from the same hardcoded bids default "
            "the real TS ops profile falls back to (never RESEND_FROM_ADDRESS)",
            captured.get("from") == "Tender Ready Bids <bids@tenderready.app>",
            captured.get("from"),
        )
    finally:
        if old_bids is not None:
            os.environ["RESEND_FROM_BIDS"] = old_bids
        if old_addr is not None:
            os.environ["RESEND_FROM_ADDRESS"] = old_addr
        else:
            os.environ.pop("RESEND_FROM_ADDRESS", None)


def monkeypatch_module(obj, attr, value, env=None):
    """Minimal manual monkeypatch (no pytest fixture available in this plain-script test harness) - every patch here is process-local and this test file is always run as its own fresh interpreter, so there's nothing to restore."""
    if env is not None:
        os.environ.update(env)
        return
    setattr(obj, attr, value)


def main():
    test_skips_cleanly_when_already_claimed(None)
    test_skips_cleanly_with_no_valid_email_recipients()
    test_sends_regardless_of_daily_digest_opt_in(None)
    test_missing_api_key_does_not_claim_so_the_email_can_still_be_sent_once_one_is_added()
    test_happy_path_renders_sends_and_logs(None)
    test_render_failure_is_caught_and_never_raises(None)
    test_render_failure_never_wastes_the_one_time_claim()
    test_one_recipients_record_notification_sent_failure_does_not_lose_the_rest()
    test_send_via_resend_from_address_matches_the_real_ops_fallback_the_docstring_claims()

    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
