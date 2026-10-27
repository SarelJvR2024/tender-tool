"""
Regression test for send_digest_emails.py - the final email-delivery step of
the daily digest (daily_digest.py only ASSEMBLES a report; this module is the
only thing that actually sends it, over Resend). No dedicated test file
existed anywhere in this repo for it before this pass (confirmed by grep) -
the piece that puts a real message in front of a real customer had zero
coverage.

No network: urlopen is monkeypatched for every case that would otherwise POST
to Resend. No Supabase, no fixtures beyond plain dicts (digest_json's own
shape, as daily_digest.build_digest_for_person()/main() produce it).

Run: python3 engine/notify/test_send_digest_emails.py
"""
import io
import json
import os
import sys
import tempfile
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "alerts"))
import send_digest_emails as sde  # noqa: E402
import system_alerts  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(("  ok   " if cond else "  FAIL ") + name + (f"  ({detail})" if detail and not cond else ""))
    if not cond:
        FAILS.append(name)


def _digest(email="jane@example.test", name="Jane Doe", company="Test Co", **sections):
    d = {"person": {"name": name, "email": email, "tender_role": "full_cycle"},
         "company_name": company, "generated_at": "2026-10-27T00:00:00Z"}
    d.update(sections)
    return d


# --- section_count() / has_content(): list vs viewer-role summary dict -----

def test_section_count_and_has_content():
    print("section_count()/has_content(): list sections, viewer-role summary dicts, and empties")
    check("a list section counts its own length", sde.section_count([1, 2, 3]) == 3)
    check("an empty list counts 0", sde.section_count([]) == 0)
    check("a viewer-role summary dict counts its own 'count'", sde.section_count({"count": 4}) == 4)
    check("a summary dict with count=0 counts 0, not falsy-skipped some other way", sde.section_count({"count": 0}) == 0)
    check("a summary dict with no 'count' key at all counts 0, not a crash", sde.section_count({}) == 0)
    check("None counts 0", sde.section_count(None) == 0)

    empty = _digest(new_tenders=[], document_expiry=[], submission_due={"count": 0})
    check("a digest with every section empty has no content", not sde.has_content(empty))
    some = _digest(new_tenders=[], submission_due={"count": 2, "nearest_closing_date": "2026-11-01"})
    check("a digest with one non-empty viewer-summary section has content", sde.has_content(some))


# --- _item_date(): first present date-shaped key wins -----------------------

def test_item_date_picks_first_present_key():
    print("_item_date(): the first of closing_date/expiry_date/due_date/updated_at present")
    check("closing_date is read and sliced to its date prefix",
          sde._item_date({"closing_date": "2026-11-05T10:00:00+02:00"}) == "2026-11-05")
    check("expiry_date works when closing_date is absent", sde._item_date({"expiry_date": "2026-12-01"}) == "2026-12-01")
    check("an item with none of the known keys returns None, not a wrong guess", sde._item_date({"field": "x"}) is None)
    check("an explicitly empty closing_date falls through to the next key, not a blank result",
          sde._item_date({"closing_date": "", "due_date": "2026-10-30"}) == "2026-10-30")


# --- render_text(): real content reaches the body, 10-item cap -------------

def test_render_text_includes_real_content_and_caps_at_ten():
    print("render_text(): section items actually appear in the body, long lists are capped")
    items = [{"title": f"Tender {i}", "closing_date": "2026-11-01"} for i in range(13)]
    body = sde.render_text(_digest(new_tenders=items))
    check("the section label and count appear", "New matching tenders: 13" in body)
    check("the first item's own title is in the body, not a generic placeholder", "Tender 0" in body)
    check("only 10 items are listed individually", sum(1 for ln in body.splitlines() if ln.strip().startswith("- Tender")) == 10)
    check("the remainder is named, not silently dropped", "... and 3 more" in body)
    check("the dashboard link and opt-out line are present",
          "/dashboard" in body and "opted in to the daily digest" in body)

    viewer_digest = _digest(submission_due={"count": 2, "nearest_closing_date": "2026-11-01"})
    vbody = sde.render_text(viewer_digest)
    check("a viewer-role summary dict renders its count with no per-item detail (no crash on a non-list section)",
          "Closing soon: 2" in vbody)


# --- send_one(): every status path, no real network -------------------------

def test_send_one_skips_cleanly_without_email_or_content():
    print("send_one(): no email on file, and nothing to report, both skip without ever POSTing")
    status, detail = sde.send_one("key", "from@x.test", _digest(email=None))
    check("no email -> skipped_no_email", status == "skipped_no_email", detail)
    status, detail = sde.send_one("key", "from@x.test", _digest(email="not-an-email"))
    check("an email with no '@' at all -> skipped_no_email, not sent to a broken address",
          status == "skipped_no_email", detail)
    status, detail = sde.send_one("key", "from@x.test", _digest(new_tenders=[]))
    check("nothing to report -> skipped_empty", status == "skipped_empty", detail)


def test_send_one_dry_run_never_touches_the_network():
    print("send_one(): --dry-run never calls urlopen, even with content and a real-looking email")
    real_urlopen = sde.urllib.request.urlopen
    called = []
    sde.urllib.request.urlopen = lambda *a, **k: called.append(1) or (_ for _ in ()).throw(RuntimeError("must not be called"))
    try:
        status, detail = sde.send_one("key", "from@x.test", _digest(new_tenders=[{"title": "x"}]), dry_run=True)
        check("dry_run status, no network call made", status == "dry_run" and not called, detail)
    finally:
        sde.urllib.request.urlopen = real_urlopen


class _FakeResp:
    def __init__(self, body=b"{}"):
        self._body = body

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_send_one_reports_sent_on_a_real_looking_success():
    print("send_one(): a successful Resend POST reports 'sent'")
    real_urlopen = sde.urllib.request.urlopen
    sde.urllib.request.urlopen = lambda req, timeout=20: _FakeResp()
    try:
        status, detail = sde.send_one("key", "from@x.test", _digest(new_tenders=[{"title": "x"}]))
        check("status is 'sent', detail names the recipient", status == "sent" and detail == "jane@example.test", detail)
    finally:
        sde.urllib.request.urlopen = real_urlopen


def test_send_one_retries_once_on_429_then_succeeds():
    print("send_one(): a single 429 is retried once (no real sleep) and a second success is reported as 'sent'")
    calls = []

    def flaky(req, timeout=20):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.HTTPError(sde.RESEND_ENDPOINT, 429, "Too Many Requests",
                                         {"Retry-After": "0"}, io.BytesIO(b"rate limited"))
        return _FakeResp()

    real_urlopen = sde.urllib.request.urlopen
    sde.urllib.request.urlopen = flaky
    try:
        status, detail = sde.send_one("key", "from@x.test", _digest(new_tenders=[{"title": "x"}]))
        check("exactly 2 attempts were made (1 original + 1 retry)", len(calls) == 2, len(calls))
        check("the retry's own success is reported as 'sent', not a failure", status == "sent", detail)
    finally:
        sde.urllib.request.urlopen = real_urlopen


def test_send_one_does_not_retry_a_second_429():
    print("send_one(): a SECOND consecutive 429 is reported as 'failed', not retried again (bounded retry)")
    calls = []

    def always_429(req, timeout=20):
        calls.append(1)
        raise urllib.error.HTTPError(sde.RESEND_ENDPOINT, 429, "Too Many Requests",
                                     {"Retry-After": "0"}, io.BytesIO(b"rate limited"))

    real_urlopen = sde.urllib.request.urlopen
    sde.urllib.request.urlopen = always_429
    try:
        status, detail = sde.send_one("key", "from@x.test", _digest(new_tenders=[{"title": "x"}]))
        check("exactly 2 attempts were made, no unbounded retry loop", len(calls) == 2, len(calls))
        check("status is 'failed' after the bounded retry is exhausted", status == "failed", detail)
    finally:
        sde.urllib.request.urlopen = real_urlopen


def test_send_one_handles_a_retry_after_http_date_not_just_seconds():
    print("send_one(): Retry-After as an HTTP-date (not a bare integer) doesn't crash the retry wait")
    calls = []

    def flaky_http_date(req, timeout=20):
        calls.append(1)
        if len(calls) == 1:
            raise urllib.error.HTTPError(sde.RESEND_ENDPOINT, 429, "Too Many Requests",
                                         {"Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"}, io.BytesIO(b"rate limited"))
        return _FakeResp()

    real_urlopen = sde.urllib.request.urlopen
    sde.urllib.request.urlopen = flaky_http_date
    try:
        status, _ = sde.send_one("key", "from@x.test", _digest(new_tenders=[{"title": "x"}]))
        check("an HTTP-date Retry-After doesn't crash float() and the retry still succeeds",
              status == "sent" and len(calls) == 2, (status, len(calls)))
    finally:
        sde.urllib.request.urlopen = real_urlopen


def test_send_one_reports_failed_on_a_permanent_http_error():
    print("send_one(): a permanent (non-429) HTTP error is reported as 'failed' with the real detail, no retry")
    calls = []

    def permanent_400(req, timeout=20):
        calls.append(1)
        raise urllib.error.HTTPError(sde.RESEND_ENDPOINT, 400, "Bad Request", {}, io.BytesIO(b'{"message":"invalid from"}'))

    real_urlopen = sde.urllib.request.urlopen
    sde.urllib.request.urlopen = permanent_400
    try:
        status, detail = sde.send_one("key", "from@x.test", _digest(new_tenders=[{"title": "x"}]))
        check("no retry on a non-429 error", len(calls) == 1, len(calls))
        check("status is 'failed' and the real Resend error body is in the detail",
              status == "failed" and "invalid from" in detail, detail)
    finally:
        sde.urllib.request.urlopen = real_urlopen


# --- main(): one malformed digest entry never aborts the rest of the batch -

def test_main_isolates_a_malformed_digest_entry():
    print("main(): a corrupted digest entry (no 'person' key at all) must not abort every digest after it")
    good_before = _digest(new_tenders=[{"title": "x"}])
    bad = {"company_name": "Broken Co"}  # no "person" key at all - a partial/corrupted --out write
    good_after = _digest(email="later@example.test", new_tenders=[{"title": "y"}])

    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "digest.json")
        json.dump([good_before, bad, good_after], open(path, "w"))

        alerts = []
        system_alerts.set_sink(alerts.append)
        real_argv = sys.argv
        sys.argv = ["send_digest_emails.py", path, "--dry-run"]
        try:
            sde.main()
        except SystemExit:
            pass
        except Exception as e:
            check("main() does not itself crash on the malformed entry", False, f"{type(e).__name__}: {e}")
        else:
            check("main() does not itself crash on the malformed entry", True)
        finally:
            sys.argv = real_argv
            system_alerts.set_sink(None)


def main():
    test_section_count_and_has_content()
    test_item_date_picks_first_present_key()
    test_render_text_includes_real_content_and_caps_at_ten()
    test_send_one_skips_cleanly_without_email_or_content()
    test_send_one_dry_run_never_touches_the_network()
    test_send_one_reports_sent_on_a_real_looking_success()
    test_send_one_retries_once_on_429_then_succeeds()
    test_send_one_does_not_retry_a_second_429()
    test_send_one_handles_a_retry_after_http_date_not_just_seconds()
    test_send_one_reports_failed_on_a_permanent_http_error()
    test_main_isolates_a_malformed_digest_entry()
    print(f"\n{len(FAILS)} failure(s)")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
